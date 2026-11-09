-- Perf: índices compuestos para los hot paths multi-tenant (tenant + fecha,
-- aging FIFO de crédito, feed de actividad, panel de staff, demanda de
-- refacciones, cuentas por pagar por proveedor) y columnas espejo
-- normalizadas de teléfono que quitan el barrido por fila de
-- linkCustomerByPhone (User.phoneNormalized) y el regexp_replace por
-- consulta de la ficha 360 (RepairOrder.customerPhoneNormalized /
-- customerPhoneAltNormalized).
--
-- La normalización replica EXACTAMENTE lib/utils.ts `normalizePhone`:
-- solo dígitos y, cuando hay más de 10, los últimos 10 (RIGHT con n mayor
-- que la longitud devuelve la cadena completa, igual que slice(-10) sobre
-- cadenas cortas). NULLIF(...,'') deja NULL en vez de cadena vacía para que
-- teléfonos sin dígitos no empaten entre sí.
--
-- IF NOT EXISTS / backfill acotado a IS NULL: idempotente y segura ante
-- reintentos. CREATE INDEX normal (no CONCURRENTLY): migrate deploy corre
-- en transacción y las tablas son chicas/medianas hoy.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT;
ALTER TABLE "RepairOrder" ADD COLUMN "customerPhoneNormalized" TEXT;
ALTER TABLE "RepairOrder" ADD COLUMN "customerPhoneAltNormalized" TEXT;

-- Backfill de los espejos normalizados.
UPDATE "User"
SET "phoneNormalized" = NULLIF(RIGHT(regexp_replace("phone", '[^0-9]', '', 'g'), 10), '')
WHERE "phone" IS NOT NULL AND "phoneNormalized" IS NULL;

UPDATE "RepairOrder"
SET "customerPhoneNormalized" = NULLIF(RIGHT(regexp_replace("customerPhone", '[^0-9]', '', 'g'), 10), '')
WHERE "customerPhoneNormalized" IS NULL;

UPDATE "RepairOrder"
SET "customerPhoneAltNormalized" = NULLIF(RIGHT(regexp_replace("customerPhoneAlt", '[^0-9]', '', 'g'), 10), '')
WHERE "customerPhoneAlt" IS NOT NULL AND "customerPhoneAltNormalized" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InventoryMovement_businessId_createdAt_idx" ON "InventoryMovement"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryMovement_businessId_productId_createdAt_idx" ON "InventoryMovement"("businessId", "productId", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditMovement_businessId_userId_createdAt_idx" ON "CreditMovement"("businessId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RepairEvent_businessId_createdAt_idx" ON "RepairEvent"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "CashMovement_businessId_createdAt_idx" ON "CashMovement"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "User_businessId_role_idx" ON "User"("businessId", "role");
CREATE INDEX IF NOT EXISTS "User_businessId_phoneNormalized_idx" ON "User"("businessId", "phoneNormalized");
CREATE INDEX IF NOT EXISTS "RepairPart_businessId_status_idx" ON "RepairPart"("businessId", "status");
CREATE INDEX IF NOT EXISTS "SupplierPayment_businessId_supplierId_idx" ON "SupplierPayment"("businessId", "supplierId");
CREATE INDEX IF NOT EXISTS "RepairOrder_businessId_customerPhoneNormalized_idx" ON "RepairOrder"("businessId", "customerPhoneNormalized");
CREATE INDEX IF NOT EXISTS "RepairOrder_businessId_customerPhoneAltNormalized_idx" ON "RepairOrder"("businessId", "customerPhoneAltNormalized");
