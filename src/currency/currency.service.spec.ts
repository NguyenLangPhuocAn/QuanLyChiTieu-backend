import { Prisma } from '@prisma/client';
import { CurrencyService } from './currency.service';

const createPrismaMock = () => ({
  exchange_rates: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
});

describe('CurrencyService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses a fresh database exchange-rate cache before calling the external API', async () => {
    const prisma = createPrismaMock();
    prisma.exchange_rates.findMany.mockResolvedValue([
      {
        base_currency: 'USD',
        target_currency: 'VND',
        rate: new Prisma.Decimal('25000'),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        fetched_at: new Date(),
      },
    ]);
    global.fetch = jest.fn();
    const service = new CurrencyService(prisma as never);

    await expect(
      service.convertAmount(10, 'USD', 'VND'),
    ).resolves.toMatchObject({
      amount: 250000,
      rate: 25000,
      fromCurrency: 'USD',
      toCurrency: 'VND',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('persists fetched exchange rates into the database cache', async () => {
    const prisma = createPrismaMock();
    prisma.exchange_rates.findMany.mockResolvedValue([]);
    prisma.exchange_rates.upsert.mockResolvedValue({});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        result: 'success',
        rates: {
          USD: 1,
          VND: 25000,
          EUR: 0.9,
        },
      }),
    });
    const service = new CurrencyService(prisma as never);

    await expect(service.convertAmount(2, 'USD', 'VND')).resolves.toMatchObject(
      {
        amount: 50000,
        rate: 25000,
      },
    );
    expect(prisma.exchange_rates.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          base_currency_target_currency_source: {
            base_currency: 'USD',
            target_currency: 'VND',
            source: 'ExchangeRate-API Open Access',
          },
        },
      }),
    );
  });
});
