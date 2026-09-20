-- Staff: puesto visible + PIN de cambio rápido de usuario (estilo POS)
ALTER TABLE "User"
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "quickPin" TEXT;

-- Recepción: firma del cliente y token para subir evidencias por QR
ALTER TABLE "RepairOrder"
  ADD COLUMN "signatureData" TEXT,
  ADD COLUMN "uploadToken" TEXT;

UPDATE "RepairOrder" SET "uploadToken" = gen_random_uuid()::text WHERE "uploadToken" IS NULL;
ALTER TABLE "RepairOrder" ALTER COLUMN "uploadToken" SET NOT NULL;
CREATE UNIQUE INDEX "RepairOrder_uploadToken_key" ON "RepairOrder"("uploadToken");

-- Refacciones con flujo de autorización
CREATE TYPE "PartStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');
ALTER TABLE "RepairPart"
  ADD COLUMN "status" "PartStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "decidedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decisionNote" TEXT;
CREATE INDEX "RepairPart_status_idx" ON "RepairPart"("status");

-- Catálogo de servicios: el precio puede depender del dispositivo
ALTER TABLE "WorkshopService" ALTER COLUMN "priceCents" DROP NOT NULL;

-- Gastos/salidas de caja con autorización
CREATE TYPE "CashRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE IF NOT EXISTS "CashRequest" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "concept" TEXT NOT NULL,
  "status" "CashRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" TEXT NOT NULL,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "cashMovementId" TEXT,
  "businessId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE RESTRICT,
  CONSTRAINT "CashRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CashRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "CashRequest_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL,
  CONSTRAINT "CashRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CashRequest_cashMovementId_key" ON "CashRequest"("cashMovementId");
CREATE INDEX IF NOT EXISTS "CashRequest_branchId_status_idx" ON "CashRequest"("branchId", "status");
CREATE INDEX IF NOT EXISTS "CashRequest_businessId_idx" ON "CashRequest"("businessId");

-- Evidencias fotográficas por orden de reparación
CREATE TABLE IF NOT EXISTS "RepairPhoto" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "label" TEXT,
  "uploadedById" TEXT,
  "businessId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepairPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RepairPhoto_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "RepairPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "RepairPhoto_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RepairPhoto_orderId_idx" ON "RepairPhoto"("orderId");
CREATE INDEX IF NOT EXISTS "RepairPhoto_businessId_idx" ON "RepairPhoto"("businessId");

-- Catálogo de modelos de equipo para autocomplete (marca, modelo, código)
CREATE TABLE "DeviceModel" (
  "id" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "code" TEXT,
  "type" TEXT NOT NULL DEFAULT 'SMARTPHONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeviceModel_brand_model_key" ON "DeviceModel"("brand", "model");
CREATE INDEX "DeviceModel_brand_idx" ON "DeviceModel"("brand");
