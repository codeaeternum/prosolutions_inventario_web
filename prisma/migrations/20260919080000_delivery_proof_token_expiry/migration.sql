-- Entrega con evidencia y vigencia de tokens/cotización.
ALTER TABLE "RepairOrder"
  ADD COLUMN "deliveredToDoc" TEXT,
  ADD COLUMN "deliverySignatureData" TEXT,
  ADD COLUMN "deliveredById" TEXT,
  ADD COLUMN "quoteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "quoteTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "uploadTokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "RepairOrder"
  ADD CONSTRAINT "RepairOrder_deliveredById_fkey"
  FOREIGN KEY ("deliveredById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RepairOrder_deliveredById_idx" ON "RepairOrder"("deliveredById");
