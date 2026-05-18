export const SUPPORTED_CURRENCIES = [
  'VND',
  'USD',
  'EUR',
  'JPY',
  'KRW',
  'CNY',
  'THB',
  'SGD',
  'AUD',
  'GBP',
  'CAD',
  'CHF',
  'HKD',
  'TWD',
  'MYR',
  'IDR',
  'PHP',
  'INR',
  'NZD',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'BRL',
  'ZAR',
  'TRY',
  'PLN',
  'CZK',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'VND';

export const EXCHANGE_RATE_PROVIDER = {
  name: 'ExchangeRate-API Open Access',
  docsUrl: 'https://www.exchangerate-api.com/docs/free',
  attributionUrl: 'https://www.exchangerate-api.com',
};
