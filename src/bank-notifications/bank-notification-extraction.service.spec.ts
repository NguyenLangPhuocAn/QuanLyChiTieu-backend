import {
  HttpException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { GeminiClient } from '../chatbot/gemini.client';
import { FeatureFlagsService } from '../features/feature-flags.service';
import { BankNotificationExtractionService } from './bank-notification-extraction.service';
import {
  bankNotificationDescription,
  prepareBankNotificationText,
  readVisibleMoney,
} from './bank-notification-text';

const input = {
  text: 'TK 87654321(VND) + 752,790. So du 14,533,072 VND. GD: TESTREF1234567890',
  consent: true,
};
const valid = {
  type: 'INCOME',
  amount: 752790,
  currency: 'VND',
  note: 'Nhận tiền',
  confidence: 0.95,
  evidence: '(VND) + 752,790',
};
describe('bank notification text extraction', () => {
  it('does not expose balances placed on the next OCR line', () => {
    const prepared = prepareBankNotificationText(
      'Nhận +125.000 VND\nSố dư\n15.000.000 VND',
    );
    expect(prepared.money.map((value) => value.amount)).toEqual([125000]);
    expect(prepared.text).not.toContain('15.000.000');
    expect(
      prepareBankNotificationText('Nhận tiền\nSố dư\n+15.000.000 VND').money,
    ).toEqual([]);
  });
  it('keeps the signed VCB transaction while removing balance, time and machine reference', () => {
    const prepared = prepareBankNotificationText(
      'Thông báo VCB\nSố dư TK VCB 1234567890 +5,000 VND lúc 03-11-2026 13:48:16. Số dư 131,687 VND. Ref TRAN MINH AN CHUYEN KHOAN-031126-13:48:16 PCxk087163#SP#020097041611031348162026',
    );
    expect(prepared.money).toMatchObject([
      { amount: 5000, currency: 'VND', direction: 'INCOME' },
    ]);
    expect(prepared.text).not.toMatch(/131,687|1234567890|13:48:16|PCxk087163/);
    expect(bankNotificationDescription(prepared.text)).toBe(
      'TRAN MINH AN CHUYEN KHOAN',
    );
    expect(prepareBankNotificationText(prepared.text).money).toMatchObject([
      { amount: 5000, direction: 'INCOME' },
    ]);
  });
  it('keeps the ACB ONE signed change before its balance and reference', () => {
    const prepared = prepareBankNotificationText(
      'Thông báo thay đổi số dư tài khoản\nACB: TK 23664527(VND) + 752,790 lúc 07:22 20/10/2026. Số dư 14,533,072. GD: HSP41313637408790 102015437352 GD 6293MCOBQ2CNHBHZ 201026-07:22:40',
    );
    expect(prepared.money).toMatchObject([
      { amount: 752790, currency: 'VND', direction: 'INCOME' },
    ]);
    expect(prepared.text).not.toMatch(/23664527|14,533,072|07:22:40|HSP413/);
    expect(prepareBankNotificationText(prepared.text).money).toMatchObject([
      { amount: 752790, currency: 'VND', direction: 'INCOME' },
    ]);
  });
  it('still removes a VCB balance without a signed change', () => {
    const prepared = prepareBankNotificationText(
      'Số dư TK VCB 1234567890 131,687 VND. Ref SO DU CUOI NGAY',
    );
    expect(prepared.money).toEqual([]);
    expect(prepared.text).not.toContain('131,687');
  });
  it('keeps a signed VCB debit as an expense', () => {
    const prepared = prepareBankNotificationText(
      'Số dư TK VCB 1234567890 -7,000 VND. Số dư 124,687 VND. Nội dung: THANH TOAN CA PHE',
    );
    expect(prepared.money).toMatchObject([
      { amount: 7000, currency: 'VND', direction: 'EXPENSE' },
    ]);
    expect(bankNotificationDescription(prepared.text)).toBe(
      'THANH TOAN CA PHE',
    );
  });
  let respond: jest.Mock;
  let flags: { isBankNotificationAiEnabled: jest.Mock };
  let service: BankNotificationExtractionService;
  beforeEach(() => {
    respond = jest.fn().mockResolvedValue({ message: JSON.stringify(valid) });
    flags = { isBankNotificationAiEnabled: jest.fn(() => true) };
    service = new BankNotificationExtractionService(
      flags as unknown as FeatureFlagsService,
      { respond } as unknown as GeminiClient,
    );
  });
  it('does not invoke AI while disabled or without explicit consent', async () => {
    flags.isBankNotificationAiEnabled.mockReturnValue(false);
    await expect(service.extract(7, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    flags.isBankNotificationAiEnabled.mockReturnValue(true);
    await expect(
      service.extract(7, { ...input, consent: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(respond).not.toHaveBeenCalled();
  });
  it('redacts account, reference and balance before calling the model; only returns a preview', async () => {
    const result = await service.extract(7, input);
    const request = JSON.stringify(respond.mock.calls);
    expect(request).not.toContain('87654321');
    expect(request).not.toContain('14,533,072');
    expect(request).not.toContain('TESTREF1234567890');
    expect(request).toContain('752,790');
    expect(result).toMatchObject({
      status: 'READY',
      type: 'INCOME',
      amount: 752790,
      currency: 'VND',
      requires_confirmation: true,
      visibility_verified: false,
    });
    expect(result).not.toHaveProperty('wallet_id');
    expect(result).not.toHaveProperty('transaction_id');
  });
  it('accepts ACB evidence with normalized currency placement when one signed amount is visible', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({ ...valid, evidence: '+752,790 VND' }),
    });
    expect(
      await service.extract(7, {
        text: 'Thông báo thay đổi số dư tài khoản. ACB: TK 23664527(VND) + 752,790 lúc 07:22 20/10/2026. Số dư 14,533,072. GD: HSP41313637408790',
        consent: true,
      }),
    ).toMatchObject({ status: 'READY', type: 'INCOME', amount: 752790 });
  });
  it('extracts the VCB income and uses only Ref as the note', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({
        ...valid,
        amount: 5000,
        evidence: '+5,000 VND',
        note: 'Số dư 131,687 VND lúc 13:48:16',
      }),
    });
    const result = await service.extract(7, {
      text: 'Số dư TK VCB 1234567890 +5,000 VND lúc 03-11-2026 13:48:16. Số dư 131,687 VND. Ref TRAN MINH AN CHUYEN KHOAN-031126-13:48:16 PCxk087163',
      consent: true,
    });
    expect(result).toMatchObject({
      status: 'READY',
      type: 'INCOME',
      amount: 5000,
      note: 'TRAN MINH AN CHUYEN KHOAN',
    });
    expect(JSON.stringify(respond.mock.calls)).not.toMatch(/131,687|13:48:16/);
  });
  it.each(['Số dư: 14.533.072 VND', 'Giao dịch +100.000 VND và -20.000 VND'])(
    'lets AI inspect safe ambiguous input, then rejects unsupported answers: %s',
    async (text) => {
      expect(await service.extract(7, { text, consent: true })).toMatchObject({
        status: 'REVIEW',
        amount: null,
      });
      expect(respond).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    'Mã OTP 123456 cho giao dịch 500.000 VND',
    'PASSWORD 123456',
    'Ma xac thuc: 987654',
    'x'.repeat(801),
  ])('refuses sensitive or oversized input: %s', async (text) => {
    await expect(
      service.extract(7, { text, consent: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(respond).not.toHaveBeenCalled();
  });
  it.each([
    { ...valid, amount: 14533072 }, // remaining balance
    { ...valid, amount: 12345 }, // hallucinated money
    { ...valid, type: 'EXPENSE' }, // reversed direction
    { ...valid, evidence: 'made up +752,790 VND' },
    { ...valid, confidence: '0.99' },
    { ...valid, confidence: 1.1 },
    { ...valid, confidence: 0.5 },
    { ...valid, currency: 'USD' },
    { ...valid, evidence: '' },
  ])('rejects inconsistent model result %j', async (result) => {
    respond.mockResolvedValue({ message: JSON.stringify(result) });
    expect(await service.extract(7, input)).toMatchObject({
      status: 'REVIEW',
      amount: null,
      requires_confirmation: true,
    });
  });
  it('does not invent direction for an unsigned amount with no evidence', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({
        ...valid,
        amount: 30000,
        evidence: '30.000 VND',
      }),
    });
    expect(
      await service.extract(7, { text: 'Thông báo 30.000 VND', consent: true }),
    ).toMatchObject({ status: 'REVIEW', amount: null });
  });
  it.each(['not JSON', '[]', 'null'])(
    'returns a review for malformed output %s',
    async (message) => {
      respond.mockResolvedValue({ message });
      expect(await service.extract(7, input)).toMatchObject({
        status: 'REVIEW',
        amount: null,
      });
    },
  );
  it('preserves USD decimals while masking bare long references', () => {
    const result = prepareBankNotificationText(
      'Account 123456789: credit +12.50 USD. Balance 800.00 USD. Code ABC123456789XYZ',
    );
    expect(result.text).not.toMatch(/123456789|800\.00|ABC123456789XYZ/);
    expect(result.money).toMatchObject([{ amount: 12.5, currency: 'USD' }]);
  });
  it.each([
    'Ghi nợ. SDTK: 14.533.072 VND',
    'Ghi nợ. SD: 14.533.072 VND',
    'Ghi nợ. Số dư tài khoản là 14.533.072 VND',
    'Ghi nợ. Số dư khả dụng: 14.533.072 VND',
    'Ghi nợ. Available balance: 14.533.072 VND',
  ])(
    'never returns a balance-only message as a transaction: %s',
    async (text) => {
      expect(await service.extract(7, { text, consent: true })).toMatchObject({
        status: 'REVIEW',
        amount: null,
      });
      expect(respond).toHaveBeenCalledTimes(1);
    },
  );
  it('does not discard transaction money because the banner title mentions balance changes', () => {
    const result = prepareBankNotificationText(
      'Thông báo thay đổi số dư tài khoản. TK 87654321(VND) + 752,790. Số dư khả dụng 14.533.072 VND. GD: ABC123456789',
    );
    expect(result.money).toMatchObject([
      { amount: 752790, currency: 'VND', direction: 'INCOME' },
    ]);
    expect(result.text).not.toContain('14.533.072');
  });
  it('preserves the debit sign immediately after a masked account', () => {
    const result = prepareBankNotificationText(
      'TK 1234 -125.000 VND. SDTK: 14.533.072 VND',
    );
    expect(result.money).toMatchObject([
      { amount: 125000, currency: 'VND', direction: 'EXPENSE' },
    ]);
    expect(result.text).not.toContain('1234');
  });
  it.each([
    'Ghi có 12.5 VND',
    'Ghi có 1,00,00 USD',
    'Ghi có 12.50.25 USD',
    'Ghi có 1.000,000 VND',
  ])(
    'does not turn malformed monetary punctuation into a different amount: %s',
    async (text) => {
      expect(readVisibleMoney(text)).toEqual([]);
      expect(await service.extract(7, { text, consent: true })).toMatchObject({
        status: 'REVIEW',
        amount: null,
      });
      expect(respond).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ['Ghi có 1,234.50 USD', 1234.5],
    ['Ghi có 1.234,50 USD', 1234.5],
    ['Ghi có 12,50 USD', 12.5],
  ])('preserves valid decimal money: %s', (text, amount) => {
    expect(readVisibleMoney(String(text))).toMatchObject([
      { amount, currency: 'USD' },
    ]);
  });
  it('treats unsafe model-generated notes as review, not an input failure', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({ ...valid, note: 'Mã OTP 123456' }),
    });
    expect(await service.extract(7, input)).toMatchObject({
      status: 'REVIEW',
      amount: null,
    });
  });
  it('lets AI select the transaction among a principal and a fee', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({
        ...valid,
        type: 'EXPENSE',
        amount: 100000,
        evidence: 'Ghi nợ -100.000 VND',
        note: 'CF',
      }),
    });
    expect(
      await service.extract(7, {
        text: 'Ghi nợ -100.000 VND; phí -5.000 VND. Số dư 900.000 VND',
        consent: true,
      }),
    ).toMatchObject({
      status: 'READY',
      type: 'EXPENSE',
      amount: 100000,
      note: '',
    });
    expect((respond.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      responseMimeType: 'application/json',
      maxOutputTokens: 600,
      timeoutMs: 12000,
      responseJsonSchema: { type: 'object' },
    });
  });
  it('accepts AI interpretation of an unfamiliar direction label instead of a direction keyword regex', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({
        ...valid,
        amount: 125000,
        evidence: 'CR 125.000 VND',
      }),
    });
    expect(
      await service.extract(7, {
        text: 'CR 125.000 VND. Balance 500.000 VND',
        consent: true,
      }),
    ).toMatchObject({ status: 'READY', type: 'INCOME', amount: 125000 });
  });
  it('checks the sign in the exact evidence even if the same amount also appears unsigned', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({
        ...valid,
        amount: 10000,
        type: 'EXPENSE',
        evidence: 'Nhận +10.000 VND',
      }),
    });
    expect(
      await service.extract(7, {
        text: 'Nhận +10.000 VND. Phí 10.000 VND',
        consent: true,
      }),
    ).toMatchObject({ status: 'REVIEW', amount: null });
  });
  it('does not synthesize fields when AI returns an uncertain or non-transaction answer', async () => {
    respond.mockResolvedValue({
      message: JSON.stringify({
        type: null,
        amount: null,
        currency: null,
        note: '',
        evidence: '',
        confidence: 0,
      }),
    });
    expect(await service.extract(7, input)).toMatchObject({
      status: 'REVIEW',
      type: null,
      amount: null,
    });
    expect(respond).toHaveBeenCalledTimes(1);
  });
  it('limits costs per account and allows another account to use its own allowance', async () => {
    for (let attempt = 0; attempt < 3; attempt++)
      await service.extract(7, input);
    await expect(service.extract(7, input)).rejects.toMatchObject({
      status: 429,
    });
    await expect(service.extract(8, input)).resolves.toHaveProperty(
      'status',
      'READY',
    );
    expect(respond).toHaveBeenCalledTimes(4);
  });
  it('rejects concurrent upstream calls but releases the lock after an upstream error', async () => {
    let fail!: (error: Error) => void;
    respond.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    const pending = service.extract(7, input);
    await expect(service.extract(7, input)).rejects.toBeInstanceOf(
      HttpException,
    );
    fail(new Error('upstream unavailable'));
    await expect(pending).rejects.toThrow('upstream unavailable');
    await expect(service.extract(7, input)).resolves.toHaveProperty(
      'status',
      'READY',
    );
  });
});
