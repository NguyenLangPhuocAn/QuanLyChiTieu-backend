-- Safe, backward-compatible receipt detail storage.
-- Existing transactions keep NULL and continue to behave exactly as before.
ALTER TABLE transactions
  ADD COLUMN receipt_items JSON NULL AFTER receipt_image;
