import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { payment_order_status, Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVnpayOrderDto } from './dto/create-vnpay-order.dto';

type VnpayParams = Record<string, string>;

type ProcessResult = {
  valid: boolean;
  orderFound: boolean;
  amountMatches: boolean;
  alreadyConfirmed: boolean;
  success: boolean;
  status: payment_order_status | 'INVALID';
  orderCode: string | null;
};

@Injectable()
export class VnpayService {
  constructor(private readonly prisma: PrismaService) {}

  private config() {
    const tmnCode = process.env.VNPAY_TMN_CODE?.trim();
    const hashSecret = process.env.VNPAY_HASH_SECRET?.trim();
    const returnUrl = process.env.VNPAY_RETURN_URL?.trim();
    if (!tmnCode || !hashSecret || !returnUrl) {
      throw new ServiceUnavailableException(
        'VNPay chưa được cấu hình VNPAY_TMN_CODE, VNPAY_HASH_SECRET và VNPAY_RETURN_URL',
      );
    }

    const configuredPrice = process.env.VNPAY_PREMIUM_PRICE_VND?.trim();
    const price = configuredPrice ? Number(configuredPrice) : 49_000;
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new ServiceUnavailableException(
        'VNPAY_PREMIUM_PRICE_VND phải là số nguyên VND lớn hơn 0',
      );
    }

    return {
      tmnCode,
      hashSecret,
      returnUrl,
      price,
      paymentUrl:
        process.env.VNPAY_PAYMENT_URL?.trim() ||
        'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      mobileDeepLink:
        process.env.VNPAY_MOBILE_DEEP_LINK?.trim() ||
        'quanlychitieu://payment-result',
    };
  }

  private encode(value: string) {
    return encodeURIComponent(value).replace(/%20/g, '+');
  }

  private serialize(params: VnpayParams) {
    return Object.keys(params)
      .filter((key) => params[key] !== '')
      .sort()
      .map((key) => `${this.encode(key)}=${this.encode(params[key])}`)
      .join('&');
  }

  private sign(params: VnpayParams, secret: string) {
    return createHmac('sha512', secret)
      .update(this.serialize(params), 'utf8')
      .digest('hex');
  }

  private verify(params: VnpayParams, secret: string) {
    const received = params.vnp_SecureHash?.toLowerCase() ?? '';
    if (!/^[a-f0-9]{128}$/.test(received)) return false;

    const unsigned = { ...params };
    delete unsigned.vnp_SecureHash;
    delete unsigned.vnp_SecureHashType;
    const expected = this.sign(unsigned, secret);
    return timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  }

  private vnpayDate(date: Date) {
    const utc7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const part = (value: number) => String(value).padStart(2, '0');
    return [
      utc7.getUTCFullYear(),
      part(utc7.getUTCMonth() + 1),
      part(utc7.getUTCDate()),
      part(utc7.getUTCHours()),
      part(utc7.getUTCMinutes()),
      part(utc7.getUTCSeconds()),
    ].join('');
  }

  private clientIp(value?: string) {
    const first = value?.split(',')[0]?.trim() || '127.0.0.1';
    return first.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
  }

  private publicOrder<
    T extends {
      amount: Prisma.Decimal;
      raw_response?: string | null;
      payment_url?: string | null;
    },
  >(order: T) {
    const safe = { ...order };
    delete safe.raw_response;
    return { ...safe, amount: Number(order.amount) };
  }

  getPremiumPlan() {
    const config = this.config();
    return {
      code: 'PREMIUM_LIFETIME',
      name: 'Premium trọn đời',
      amount: config.price,
      currency: 'VND',
      provider: 'VNPAY',
      environment: config.paymentUrl.includes('sandbox.')
        ? 'SANDBOX'
        : 'PRODUCTION',
    };
  }

  async createOrder(
    userId: number,
    dto: CreateVnpayOrderDto,
    ipAddress?: string,
  ) {
    const config = this.config();
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('Người dùng không tồn tại');
    if (user.role === 'PREMIUM' || user.role === 'ADMIN') {
      throw new BadRequestException('Tài khoản đã có quyền Premium');
    }

    const now = new Date();
    await this.prisma.payment_orders.updateMany({
      where: { user_id: userId, status: 'PENDING', expires_at: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    const active = await this.prisma.payment_orders.findFirst({
      where: { user_id: userId, status: 'PENDING', expires_at: { gt: now } },
      orderBy: { created_at: 'desc' },
    });
    if (active?.payment_url) return this.publicOrder(active);

    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const orderCode = `PREM${this.vnpayDate(now)}${randomBytes(4).toString('hex')}`;
    const order = await this.prisma.payment_orders.create({
      data: {
        user_id: userId,
        order_code: orderCode,
        plan_code: 'PREMIUM_LIFETIME',
        amount: new Prisma.Decimal(config.price),
        currency: 'VND',
        expires_at: expiresAt,
      },
    });

    const params: VnpayParams = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: config.tmnCode,
      vnp_Amount: String(config.price * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: orderCode,
      vnp_OrderInfo: `Thanh toan goi Premium ${orderCode}`,
      vnp_OrderType: 'other',
      vnp_Locale: dto.locale ?? 'vn',
      vnp_ReturnUrl: config.returnUrl,
      vnp_IpAddr: this.clientIp(ipAddress),
      vnp_CreateDate: this.vnpayDate(now),
      vnp_ExpireDate: this.vnpayDate(expiresAt),
      ...(dto.bank_code ? { vnp_BankCode: dto.bank_code } : {}),
    };
    const query = this.serialize(params);
    const paymentUrl = `${config.paymentUrl}?${query}&vnp_SecureHash=${this.sign(params, config.hashSecret)}`;
    const saved = await this.prisma.payment_orders.update({
      where: { id: order.id },
      data: { payment_url: paymentUrl },
    });
    return this.publicOrder(saved);
  }

  private responseData(params: VnpayParams) {
    return {
      vnp_transaction_no: params.vnp_TransactionNo || null,
      vnp_bank_code: params.vnp_BankCode || null,
      vnp_bank_tran_no: params.vnp_BankTranNo || null,
      vnp_card_type: params.vnp_CardType || null,
      vnp_response_code: params.vnp_ResponseCode || null,
      vnp_transaction_status: params.vnp_TransactionStatus || null,
      raw_response: JSON.stringify(params),
    };
  }

  async processResponse(params: VnpayParams): Promise<ProcessResult> {
    const config = this.config();
    const orderCode = params.vnp_TxnRef || null;
    if (
      !this.verify(params, config.hashSecret) ||
      params.vnp_TmnCode !== config.tmnCode
    ) {
      return {
        valid: false,
        orderFound: false,
        amountMatches: false,
        alreadyConfirmed: false,
        success: false,
        status: 'INVALID',
        orderCode,
      };
    }

    const order = orderCode
      ? await this.prisma.payment_orders.findUnique({
          where: { order_code: orderCode },
        })
      : null;
    if (!order) {
      return {
        valid: true,
        orderFound: false,
        amountMatches: false,
        alreadyConfirmed: false,
        success: false,
        status: 'INVALID',
        orderCode,
      };
    }

    const expectedAmount = new Prisma.Decimal(order.amount).mul(100).toFixed(0);
    if (params.vnp_Amount !== expectedAmount) {
      return {
        valid: true,
        orderFound: true,
        amountMatches: false,
        alreadyConfirmed: order.status === 'PAID',
        success: false,
        status: order.status,
        orderCode,
      };
    }

    const isSuccess =
      params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
    if (!isSuccess) {
      const status: payment_order_status =
        params.vnp_ResponseCode === '24' ? 'CANCELLED' : 'FAILED';
      if (order.status !== 'PAID') {
        await this.prisma.payment_orders.update({
          where: { id: order.id },
          data: { status, ...this.responseData(params) },
        });
      }
      return {
        valid: true,
        orderFound: true,
        amountMatches: true,
        alreadyConfirmed: order.status === 'PAID',
        success: false,
        status: order.status === 'PAID' ? 'PAID' : status,
        orderCode,
      };
    }

    let alreadyConfirmed = order.status === 'PAID';
    if (!alreadyConfirmed) {
      alreadyConfirmed = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.payment_orders.updateMany({
          where: { id: order.id, status: { not: 'PAID' } },
          data: {
            status: 'PAID',
            paid_at: new Date(),
            ...this.responseData(params),
          },
        });
        if (claimed.count === 0) return true;
        await tx.users.updateMany({
          where: { id: order.user_id, role: 'BASIC' },
          data: { role: 'PREMIUM' },
        });
        await tx.admin_logs.create({
          data: {
            admin_id: order.user_id,
            action: `Thanh toán VNPay thành công ${order.order_code}; nâng cấp Premium`,
          },
        });
        return false;
      });
    }

    return {
      valid: true,
      orderFound: true,
      amountMatches: true,
      alreadyConfirmed,
      success: true,
      status: 'PAID',
      orderCode,
    };
  }

  ipnResponse(result: ProcessResult) {
    if (!result.valid) return { RspCode: '97', Message: 'Invalid Checksum' };
    if (!result.orderFound)
      return { RspCode: '01', Message: 'Order not found' };
    if (!result.amountMatches)
      return { RspCode: '04', Message: 'Invalid Amount' };
    if (result.alreadyConfirmed)
      return { RspCode: '02', Message: 'Order already confirmed' };
    return { RspCode: '00', Message: 'Confirm Success' };
  }

  returnHtml(result: ProcessResult) {
    const config = this.config();
    const status = result.success ? 'paid' : result.status.toLowerCase();
    const title = result.success
      ? 'Thanh toán thành công'
      : 'Thanh toán chưa thành công';
    const detail = result.success
      ? 'Tài khoản của bạn đã được nâng cấp Premium.'
      : 'Giao dịch không được xác nhận. Tài khoản chưa bị nâng cấp.';
    const deepLink = `${config.mobileDeepLink}?status=${encodeURIComponent(status)}&order=${encodeURIComponent(result.orderCode ?? '')}`;
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#fff3e8;color:#4c2a18;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:420px;margin:20px;padding:28px;border:1px solid #e8b680;border-radius:22px;background:#fff;text-align:center}a{display:inline-block;margin-top:18px;padding:12px 18px;border-radius:14px;background:#c76708;color:#fff;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>${title}</h1><p>${detail}</p><a href="${deepLink}">Quay lại ứng dụng</a></main><script>setTimeout(function(){location.href=${JSON.stringify(deepLink)}},1200)</script></body></html>`;
  }

  async findOne(userId: number, orderCode: string) {
    let order = await this.prisma.payment_orders.findFirst({
      where: { user_id: userId, order_code: orderCode },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn thanh toán');
    if (order.status === 'PENDING' && order.expires_at <= new Date()) {
      order = await this.prisma.payment_orders.update({
        where: { id: order.id },
        data: { status: 'EXPIRED' },
      });
    }
    return this.publicOrder(order);
  }

  async findAll(userId: number) {
    await this.prisma.payment_orders.updateMany({
      where: {
        user_id: userId,
        status: 'PENDING',
        expires_at: { lte: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    const orders = await this.prisma.payment_orders.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
    return orders.map((order) => this.publicOrder(order));
  }
}
