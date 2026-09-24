import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VnpayService } from './vnpay.service';

const encode = (value: string) =>
  encodeURIComponent(value).replace(/%20/g, '+');
const sign = (params: Record<string, string>, secret: string) => {
  const data = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
  return createHmac('sha512', secret).update(data, 'utf8').digest('hex');
};

describe('VnpayService', () => {
  const originalEnv = {
    tmnCode: process.env.VNPAY_TMN_CODE,
    hashSecret: process.env.VNPAY_HASH_SECRET,
    returnUrl: process.env.VNPAY_RETURN_URL,
    price: process.env.VNPAY_PREMIUM_PRICE_VND,
  };

  beforeEach(() => {
    process.env.VNPAY_TMN_CODE = 'TESTCODE';
    process.env.VNPAY_HASH_SECRET = 'sandbox-secret';
    process.env.VNPAY_RETURN_URL =
      'http://localhost:3000/payments/vnpay/return';
    process.env.VNPAY_PREMIUM_PRICE_VND = '49000';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    const restore = (name: string, value?: string) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('VNPAY_TMN_CODE', originalEnv.tmnCode);
    restore('VNPAY_HASH_SECRET', originalEnv.hashSecret);
    restore('VNPAY_RETURN_URL', originalEnv.returnUrl);
    restore('VNPAY_PREMIUM_PRICE_VND', originalEnv.price);
  });

  it('creates a signed sandbox URL with a server-controlled amount', async () => {
    const created = {
      id: 8,
      user_id: 7,
      order_code: 'PREM_ORDER',
      provider: 'VNPAY',
      plan_code: 'PREMIUM_LIFETIME',
      amount: new Prisma.Decimal(49000),
      currency: 'VND',
      status: 'PENDING',
      payment_url: null,
      raw_response: null,
      expires_at: new Date(Date.now() + 900_000),
    };
    const prisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, role: 'BASIC' }),
      },
      payment_orders: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            ...created,
            ...args.data,
          })),
        update: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) => ({
            ...created,
            ...args.data,
          })),
      },
    } as unknown as PrismaService;
    const service = new VnpayService(prisma);

    const result = await service.createOrder(7, { locale: 'vn' }, '127.0.0.1');
    const url = new URL(result.payment_url ?? '');

    expect(url.origin + url.pathname).toBe(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    );
    expect(url.searchParams.get('vnp_Amount')).toBe('4900000');
    expect(url.searchParams.get('vnp_TmnCode')).toBe('TESTCODE');
    expect(url.searchParams.get('vnp_SecureHash')).toMatch(/^[a-f0-9]{128}$/);
    expect(result).not.toHaveProperty('raw_response');
  });

  it('rejects an invalid callback checksum without reading an order', async () => {
    const findUnique = jest.fn();
    const prisma = {
      payment_orders: { findUnique },
    } as unknown as PrismaService;
    const service = new VnpayService(prisma);

    const result = await service.processResponse({
      vnp_TmnCode: 'TESTCODE',
      vnp_TxnRef: 'PREM_ORDER',
      vnp_Amount: '4900000',
      vnp_SecureHash: '0'.repeat(128),
    });

    expect(result.valid).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
    expect(service.ipnResponse(result)).toEqual({
      RspCode: '97',
      Message: 'Invalid Checksum',
    });
  });

  it('upgrades BASIC exactly after a valid successful response', async () => {
    const order = {
      id: 8,
      user_id: 7,
      order_code: 'PREM_ORDER',
      amount: new Prisma.Decimal(49000),
      status: 'PENDING',
    };
    let capturedOrderUpdate: unknown;
    const tx = {
      payment_orders: {
        updateMany: jest.fn((args: unknown) => {
          capturedOrderUpdate = args;
          return Promise.resolve({ count: 1 });
        }),
      },
      users: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      admin_logs: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const prisma = {
      payment_orders: { findUnique: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const params: Record<string, string> = {
      vnp_TmnCode: 'TESTCODE',
      vnp_TxnRef: 'PREM_ORDER',
      vnp_Amount: '4900000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '12345678',
    };
    params.vnp_SecureHash = sign(params, 'sandbox-secret');
    const service = new VnpayService(prisma);

    const result = await service.processResponse(params);

    expect(result.success).toBe(true);
    const updateCall = capturedOrderUpdate as
      | { where: unknown; data: { status?: string } }
      | undefined;
    expect(updateCall?.where).toEqual({ id: 8, status: { not: 'PAID' } });
    expect(updateCall?.data.status).toBe('PAID');
    expect(tx.users.updateMany).toHaveBeenCalledWith({
      where: { id: 7, role: 'BASIC' },
      data: { role: 'PREMIUM' },
    });
    expect(service.ipnResponse(result)).toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
  });

  it('does not upgrade when VNPay signs a different amount', async () => {
    const transaction = jest.fn();
    const prisma = {
      payment_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: 8,
          user_id: 7,
          order_code: 'PREM_ORDER',
          amount: new Prisma.Decimal(49000),
          status: 'PENDING',
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const params: Record<string, string> = {
      vnp_TmnCode: 'TESTCODE',
      vnp_TxnRef: 'PREM_ORDER',
      vnp_Amount: '10000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '12345679',
    };
    params.vnp_SecureHash = sign(params, 'sandbox-secret');
    const service = new VnpayService(prisma);

    const result = await service.processResponse(params);

    expect(result.amountMatches).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(service.ipnResponse(result)).toEqual({
      RspCode: '04',
      Message: 'Invalid Amount',
    });
  });

  it('treats a replayed successful callback as already confirmed', async () => {
    const transaction = jest.fn();
    const prisma = {
      payment_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: 8,
          user_id: 7,
          order_code: 'PREM_ORDER',
          amount: new Prisma.Decimal(49000),
          status: 'PAID',
        }),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const params: Record<string, string> = {
      vnp_TmnCode: 'TESTCODE',
      vnp_TxnRef: 'PREM_ORDER',
      vnp_Amount: '4900000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '12345678',
    };
    params.vnp_SecureHash = sign(params, 'sandbox-secret');
    const service = new VnpayService(prisma);

    const result = await service.processResponse(params);

    expect(result.success).toBe(true);
    expect(result.alreadyConfirmed).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
    expect(service.ipnResponse(result)).toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });
  });
});
