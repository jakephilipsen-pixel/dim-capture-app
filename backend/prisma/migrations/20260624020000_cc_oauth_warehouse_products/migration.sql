-- Module 16 (cc-oauth-write): re-point to CartonCloud warehouse-products + add
-- the name-poison "blocked" state.
--   - Sku.code: the SKU code (references.code), for code-based search.
--   - Sku.barcode: now nullable — the barcode lives on a UoM and not every
--     product/UoM has one. The existing UNIQUE index is preserved (Postgres
--     allows multiple NULLs in a unique index).
--   - Dim.syncBlockedReason: set when CC refuses a dims write because a sibling
--     UoM name is invalid; excludes the dim from the retry set until re-capture.
-- All additive / nullable, so every existing row stays valid.
ALTER TABLE "Sku" ADD COLUMN "code" TEXT;
ALTER TABLE "Sku" ALTER COLUMN "barcode" DROP NOT NULL;
ALTER TABLE "Dim" ADD COLUMN "syncBlockedReason" TEXT;
