-- RepairOrder.customerId: liga la orden al User cliente (empalme por
-- teléfono normalizado para datos históricos; nuevas órdenes lo estampan).
ALTER TABLE "RepairOrder" ADD COLUMN "customerId" TEXT;
CREATE INDEX "RepairOrder_customerId_idx" ON "RepairOrder"("customerId");
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: último/10 dígitos del teléfono (mismo criterio que normalizePhone).
-- Solo clientes del mismo negocio; si el teléfono se repite toma uno cualquiera.
UPDATE "RepairOrder" ro
SET "customerId" = m.id
FROM (
  SELECT DISTINCT ON (u."businessId", p) u.id, u."businessId",
         RIGHT(regexp_replace(u.phone, '[^0-9]', '', 'g'), 10) AS p
  FROM "User" u
  WHERE u.phone IS NOT NULL AND u.role = 'CUSTOMER'
  ORDER BY u."businessId", p, u."createdAt"
) m
WHERE m."businessId" = ro."businessId"
  AND ro."customerId" IS NULL
  AND RIGHT(regexp_replace(ro."customerPhone", '[^0-9]', '', 'g'), 10) = m.p;

-- Solicitudes de refacción del directorio (dato de plataforma, sin tenant).
CREATE TYPE "PartRequestStatus" AS ENUM ('OPEN', 'CONTACTED', 'CLOSED');
CREATE TABLE "PartRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "phone" TEXT NOT NULL,
    "status" "PartRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartRequest_status_createdAt_idx" ON "PartRequest"("status", "createdAt");

-- Telemetría del directorio para el panel de plataforma.
CREATE TABLE "DirectoryEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "businessId" TEXT,
    "query" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DirectoryEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DirectoryEvent_kind_createdAt_idx" ON "DirectoryEvent"("kind", "createdAt");
CREATE INDEX "DirectoryEvent_businessId_idx" ON "DirectoryEvent"("businessId");
ALTER TABLE "DirectoryEvent" ADD CONSTRAINT "DirectoryEvent_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
