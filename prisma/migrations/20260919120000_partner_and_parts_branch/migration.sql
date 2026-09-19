-- Órdenes captadas por talleres asociados + refacción desde sucursal-almacén
-- + conteo de denominaciones al cerrar caja.
ALTER TABLE "RepairOrder"
  ADD COLUMN "originBusinessId" TEXT,
  ADD COLUMN "originBusinessName" TEXT,
  ADD COLUMN "originContact" TEXT,
  ADD COLUMN "partnerPriceCents" INTEGER;

ALTER TABLE "RepairPart"
  ADD COLUMN "sourceBranchId" TEXT;

ALTER TABLE "CashRegister"
  ADD COLUMN "denominations" JSONB;

ALTER TABLE "RepairOrder"
  ADD CONSTRAINT "RepairOrder_originBusinessId_fkey"
  FOREIGN KEY ("originBusinessId") REFERENCES "Business"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RepairPart"
  ADD CONSTRAINT "RepairPart_sourceBranchId_fkey"
  FOREIGN KEY ("sourceBranchId") REFERENCES "WorkshopBranch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RepairOrder_originBusinessId_idx" ON "RepairOrder"("originBusinessId");
CREATE INDEX "RepairPart_sourceBranchId_idx" ON "RepairPart"("sourceBranchId");
