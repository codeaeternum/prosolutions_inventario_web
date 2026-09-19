-- Garantía con vigencia real.
ALTER TABLE "RepairOrder"
  ADD COLUMN "warrantyUntil" TIMESTAMP(3),
  ADD COLUMN "warrantyCount" INTEGER NOT NULL DEFAULT 0;
