UPDATE transactions t
LEFT JOIN wallets w ON w.id = t.wallet_id
LEFT JOIN users u ON u.id = w.user_id
SET
  t.currency = COALESCE(t.currency, w.currency, 'VND'),
  t.converted_amount = COALESCE(t.converted_amount, ABS(t.amount)),
  t.converted_currency = COALESCE(t.converted_currency, u.currency_default, w.currency, 'VND'),
  t.exchange_rate_used = COALESCE(
    t.exchange_rate_used,
    CASE
      WHEN COALESCE(w.currency, 'VND') = COALESCE(u.currency_default, w.currency, 'VND') THEN 1
      ELSE NULL
    END
  )
WHERE t.currency IS NULL
   OR t.converted_amount IS NULL
   OR t.converted_currency IS NULL
   OR t.exchange_rate_used IS NULL;
