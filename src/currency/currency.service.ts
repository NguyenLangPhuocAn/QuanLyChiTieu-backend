import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_CURRENCY,
  EXCHANGE_RATE_PROVIDER,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from './currency.constants';
import { PrismaService } from '../prisma/prisma.service';

type RateCacheEntry = {
  expiresAt: number;
  rates: Record<string, number>;
  lastUpdatedAt?: string;
  nextUpdateAt?: string;
};

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly rateCache = new Map<string, RateCacheEntry>();
  private readonly cacheTtlMs = 60 * 60 * 1000;
  private readonly apiBaseUrl =
    process.env.EXCHANGE_RATE_API_BASE_URL?.trim() ||
    'https://open.er-api.com/v6/latest';

  constructor(private prisma: PrismaService) {}

  normalizeCurrency(value?: string | null): SupportedCurrency {
    const normalized = value?.trim().toUpperCase() as
      | SupportedCurrency
      | undefined;

    if (normalized && this.isSupportedCurrency(normalized)) {
      return normalized;
    }

    return DEFAULT_CURRENCY;
  }

  assertSupportedCurrency(value?: string | null) {
    const normalized = value?.trim().toUpperCase();

    if (!normalized || !this.isSupportedCurrency(normalized)) {
      throw new BadRequestException(
        `Tiền tệ không hợp lệ. Chỉ hỗ trợ: ${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }

    return normalized;
  }

  getProviderMeta() {
    return EXCHANGE_RATE_PROVIDER;
  }

  async convertAmount(
    amount: Prisma.Decimal | number | string | null | undefined,
    fromCurrency?: string | null,
    toCurrency?: string | null,
  ) {
    const numericAmount = this.toNumber(amount);
    const from = this.normalizeCurrency(fromCurrency);
    const to = this.normalizeCurrency(toCurrency);

    if (from === to || numericAmount === 0) {
      return {
        amount: this.roundAmount(numericAmount, to),
        rate: 1,
        fromCurrency: from,
        toCurrency: to,
      };
    }

    const rates = await this.getLatestRates(from, to);
    const rate = rates[to];

    if (!rate || !Number.isFinite(rate)) {
      throw new ServiceUnavailableException(
        `Chưa lấy được tỷ giá từ ${from} sang ${to}`,
      );
    }

    return {
      amount: this.roundAmount(numericAmount * rate, to),
      rate,
      fromCurrency: from,
      toCurrency: to,
    };
  }

  async convertDecimal(
    amount: Prisma.Decimal | number | string | null | undefined,
    fromCurrency?: string | null,
    toCurrency?: string | null,
  ) {
    const converted = await this.convertAmount(
      amount,
      fromCurrency,
      toCurrency,
    );

    return new Prisma.Decimal(converted.amount.toFixed(2));
  }

  private isSupportedCurrency(value: string): value is SupportedCurrency {
    return SUPPORTED_CURRENCIES.includes(value as SupportedCurrency);
  }

  private toNumber(value: Prisma.Decimal | number | string | null | undefined) {
    if (value instanceof Prisma.Decimal) {
      return value.toNumber();
    }

    return Number(value ?? 0);
  }

  private roundAmount(value: number, currency: SupportedCurrency) {
    const fractionDigits = currency === 'JPY' ? 0 : 2;
    return Number(value.toFixed(fractionDigits));
  }

  private async getLatestRates(
    baseCurrency: SupportedCurrency,
    requiredTarget: SupportedCurrency,
  ) {
    const now = Date.now();
    const cached = this.rateCache.get(baseCurrency);

    if (
      cached &&
      cached.expiresAt > now &&
      cached.rates[requiredTarget] !== undefined
    ) {
      return cached.rates;
    }

    const cachedDbRates = await this.getCachedDbRates(
      baseCurrency,
      requiredTarget,
    );

    if (cachedDbRates) {
      return cachedDbRates;
    }

    try {
      const response = await fetch(
        `${this.apiBaseUrl}/${encodeURIComponent(baseCurrency)}`,
      );

      if (!response.ok) {
        throw new Error('Không cập nhật được tỷ giá. Vui lòng thử lại sau.');
      }

      const payload = (await response.json()) as {
        result?: string;
        rates?: Record<string, number>;
        time_last_update_utc?: string;
        time_next_update_utc?: string;
      };

      if (payload.result !== 'success' || !payload.rates) {
        throw new Error('Không cập nhật được tỷ giá. Vui lòng thử lại sau.');
      }

      const filteredRates = Object.fromEntries(
        Object.entries(payload.rates).filter(([code, rate]) => {
          return (
            this.isSupportedCurrency(code) &&
            typeof rate === 'number' &&
            Number.isFinite(rate)
          );
        }),
      );

      filteredRates[baseCurrency] = 1;

      this.rateCache.set(baseCurrency, {
        rates: filteredRates,
        expiresAt: now + this.cacheTtlMs,
        lastUpdatedAt: payload.time_last_update_utc,
        nextUpdateAt: payload.time_next_update_utc,
      });
      await this.persistRates(baseCurrency, filteredRates);

      return filteredRates;
    } catch (error) {
      if (cached) {
        this.logger.warn(
          `Dùng cache cũ cho tỷ giá ${baseCurrency} do fetch thất bại: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        return cached.rates;
      }

      const staleDbRates = await this.getCachedDbRates(
        baseCurrency,
        requiredTarget,
        true,
      );

      if (staleDbRates) {
        this.logger.warn(
          `Dung cache DB cu cho ty gia ${baseCurrency} do fetch that bai: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
        return staleDbRates;
      }

      throw new ServiceUnavailableException(
        'Không thể lấy tỷ giá quy đổi lúc này',
      );
    }
  }

  private async getCachedDbRates(
    baseCurrency: SupportedCurrency,
    requiredTarget: SupportedCurrency,
    allowExpired = false,
  ) {
    const nowDate = new Date();
    const rows = await this.prisma.exchange_rates.findMany({
      where: {
        base_currency: baseCurrency,
        source: EXCHANGE_RATE_PROVIDER.name,
        ...(allowExpired ? {} : { expires_at: { gt: nowDate } }),
      },
    });
    const usableRows = allowExpired
      ? rows
      : rows.filter((row) => row.expires_at > nowDate);
    const hasRequiredTarget = usableRows.some(
      (row) => row.target_currency === requiredTarget,
    );

    if (!hasRequiredTarget) {
      return null;
    }

    const rates = Object.fromEntries(
      usableRows
        .filter((row) => this.isSupportedCurrency(row.target_currency))
        .map((row) => [row.target_currency, Number(row.rate)]),
    );
    rates[baseCurrency] = 1;

    const expiresAt = allowExpired
      ? Date.now() + 5 * 60 * 1000
      : Math.min(
          ...usableRows.map((row) => row.expires_at.getTime()),
          Date.now() + this.cacheTtlMs,
        );

    this.rateCache.set(baseCurrency, {
      rates,
      expiresAt,
    });

    return rates;
  }

  private async persistRates(
    baseCurrency: SupportedCurrency,
    rates: Record<string, number>,
  ) {
    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + this.cacheTtlMs);

    await Promise.all(
      Object.entries(rates)
        .filter(
          ([targetCurrency, rate]) =>
            this.isSupportedCurrency(targetCurrency) &&
            typeof rate === 'number' &&
            Number.isFinite(rate),
        )
        .map(([targetCurrency, rate]) =>
          this.prisma.exchange_rates.upsert({
            where: {
              base_currency_target_currency_source: {
                base_currency: baseCurrency,
                target_currency: targetCurrency,
                source: EXCHANGE_RATE_PROVIDER.name,
              },
            },
            update: {
              rate: new Prisma.Decimal(String(rate)),
              fetched_at: fetchedAt,
              expires_at: expiresAt,
            },
            create: {
              base_currency: baseCurrency,
              target_currency: targetCurrency,
              source: EXCHANGE_RATE_PROVIDER.name,
              rate: new Prisma.Decimal(String(rate)),
              fetched_at: fetchedAt,
              expires_at: expiresAt,
            },
          }),
        ),
    );
  }
}
