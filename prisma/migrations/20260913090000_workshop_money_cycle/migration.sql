-- Ciclo del dinero y operación avanzada del taller

ALTER TYPE "RepairStatus" ADD VALUE 'NOT_REPAIRED';
ALTER TYPE "RepairStatus" ADD VALUE 'NOT_AUTHORIZED';
ALTER TYPE "RepairStatus" ADD VALUE 'EXTERNAL_LAB';
ALTER TYPE "RepairStatus" ADD VALUE 'WARRANTY';

ALTER TABLE "RepairOrder"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "location" TEXT,
  ADD COLUMN "aesthetics" TEXT,
  ADD COLUMN "functionalConditions" TEXT;

ALTER TABLE "RepairEvent" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Payment"
  ADD COLUMN "repairOrderId" TEXT,
  ADD COLUMN "purpose" TEXT;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_repairOrderId_fkey"
  FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Payment_repairOrderId_idx" ON "Payment"("repairOrderId");

CREATE TABLE "WorkshopService" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "equipmentType" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkshopService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkshopService_isActive_name_idx" ON "WorkshopService"("isActive", "name");
