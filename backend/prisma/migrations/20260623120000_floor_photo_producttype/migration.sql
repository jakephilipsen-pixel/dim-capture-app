-- Floor camera flow (feature/floor-camera-flow): operator-selected carton class
-- and an optional carton photo path on each captured dim. Both nullable, so the
-- migration is additive and every existing Dim row stays valid.
ALTER TABLE "Dim" ADD COLUMN "productType" TEXT;
ALTER TABLE "Dim" ADD COLUMN "photoPath" TEXT;
