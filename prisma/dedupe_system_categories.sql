-- Deduplicate active system categories that were created by older seed/repair scripts.
-- Keep the lowest id for each system name/type pair, move references to it, then soft-delete the duplicate rows.

START TRANSACTION;

CREATE TEMPORARY TABLE category_dedupe_map AS
SELECT duplicate_category.id AS duplicate_id,
       canonical_category.canonical_id
FROM categories duplicate_category
JOIN (
  SELECT name, type, MIN(id) AS canonical_id
  FROM categories
  WHERE is_system = 1
    AND COALESCE(is_active, 1) = 1
  GROUP BY name, type
  HAVING COUNT(*) > 1
) canonical_category
  ON canonical_category.name = duplicate_category.name
 AND canonical_category.type = duplicate_category.type
WHERE duplicate_category.is_system = 1
  AND COALESCE(duplicate_category.is_active, 1) = 1
  AND duplicate_category.id <> canonical_category.canonical_id;

UPDATE transactions t
JOIN category_dedupe_map m ON m.duplicate_id = t.category_id
SET t.category_id = m.canonical_id;

UPDATE budgets b
JOIN category_dedupe_map m ON m.duplicate_id = b.category_id
SET b.category_id = m.canonical_id;

UPDATE categories duplicate_category
JOIN category_dedupe_map m ON m.duplicate_id = duplicate_category.id
SET duplicate_category.is_active = 0,
    duplicate_category.deleted_at = NOW();

DROP TEMPORARY TABLE category_dedupe_map;

COMMIT;
