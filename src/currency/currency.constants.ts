export const SUPPORTED_CURRENCIES = ['VND', 'USD', 'EUR', 'JPY'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'VND';

export const EXCHANGE_RATE_PROVIDER = {
  name: 'ExchangeRate-API Open Access',
  docsUrl: 'https://www.exchangerate-api.com/docs/free',
  attributionUrl: 'https://www.exchangerate-api.com',
};
