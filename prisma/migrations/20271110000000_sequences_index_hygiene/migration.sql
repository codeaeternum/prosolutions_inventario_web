-- Folios de compras y conteos por BusinessCounter + higiene de índices.
--
-- 1) Purchase.number e InventoryCount.number dejan el patrón MAX(number)+1
--    y pasan al mismo esquema que ventas/órdenes: nextPurchaseNumber() /
--    nextCountNumber() (src/lib/domain/tenant-sequence.ts) reservan el folio
--    con INSERT … ON CONFLICT … DO UPDATE sobre BusinessCounter dentro de
--    la tx serializable — lock de fila en vez de serializar lecturas de
--    toda la tabla del tenant, y el incremento se revierte con el rollback
--    (no se queman folios). @@unique([businessId, number]) sigue siendo la
--    red de seguridad.
--
-- 2) Índices eliminados ( DROP INDEX IF EXISTS ):
--    a) Standalone [businessId] redundantes — otro índice o único con
--       businessId como columna IZQUIERDA ya los cubre. PriceHistory
--       CONSERVA el suyo: no tiene otro índice con prefijo businessId.
--    b) Standalone de baja selectividad ([status] / [createdAt]) que las
--       consultas siempre prefijan con tenant u otra FK; el barrido global
--       de expiración de reservas usa (expiresAt), no (status).
--
-- 3) Índices nuevos ( CREATE INDEX IF NOT EXISTS ):
--    - Sale(businessId, status, createdAt): la bandeja del mostrador
--      (listDocuments, /api/sales, /api/pedidos) filtra businessId+status
--      ordenando por fecha — evita barrer las COMPLETED del tenant.
--    - Notification(businessId, audience, createdAt): GET /api/notifications
--      y el marcado de leídas filtran tenant+audiencia ordenando por fecha.
--
-- IF NOT EXISTS / ON CONFLICT / backfill con COALESCE: idempotente ante
-- reintentos (un retry tras fallo recalcula MAX+1 sobre las filas ya
-- existentes — nunca retrocede el contador por debajo del MAX real).
-- Sin CONCURRENTLY: migrate deploy corre en transacción y las tablas son
-- chicas/medianas hoy.

-- ==================== FOLIOS: BusinessCounter ====================

ALTER TABLE "BusinessCounter" ADD COLUMN IF NOT EXISTS "nextPurchaseNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BusinessCounter" ADD COLUMN IF NOT EXISTS "nextCountNumber" INTEGER NOT NULL DEFAULT 1;

-- Backfill: cada negocio continúa desde su MAX(number)+1; los negocios sin
-- compras/conteos quedan en 1 vía COALESCE y los que no tengan fila en
-- BusinessCounter la obtienen aquí (el INSERT cubre altas fuera del
-- backfill original de tenant_order_numbers).
INSERT INTO "BusinessCounter" ("businessId", "nextPurchaseNumber")
SELECT b."id", COALESCE(m.max_number, 0) + 1
FROM "Business" b
LEFT JOIN (
    SELECT "businessId", MAX("number") AS max_number
    FROM "Purchase"
    GROUP BY "businessId"
) m ON m."businessId" = b."id"
ON CONFLICT ("businessId") DO UPDATE SET "nextPurchaseNumber" = EXCLUDED."nextPurchaseNumber";

INSERT INTO "BusinessCounter" ("businessId", "nextCountNumber")
SELECT b."id", COALESCE(m.max_number, 0) + 1
FROM "Business" b
LEFT JOIN (
    SELECT "businessId", MAX("number") AS max_number
    FROM "InventoryCount"
    GROUP BY "businessId"
) m ON m."businessId" = b."id"
ON CONFLICT ("businessId") DO UPDATE SET "nextCountNumber" = EXCLUDED."nextCountNumber";

-- ==================== ÍNDICES NUEVOS ====================

CREATE INDEX IF NOT EXISTS "Sale_businessId_status_createdAt_idx" ON "Sale"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_businessId_audience_createdAt_idx" ON "Notification"("businessId", "audience", "createdAt");

-- ==================== STANDALONE [businessId] REDUNDANTES ====================

-- Cubierto por el único (businessId, barcode) y por (businessId, isActive).
DROP INDEX IF EXISTS "Product_businessId_idx";
-- Cubierto por (businessId, status).
DROP INDEX IF EXISTS "Reservation_businessId_idx";
-- Cubierto por (businessId, createdAt) y (businessId, userId, createdAt).
DROP INDEX IF EXISTS "CreditMovement_businessId_idx";
-- Cubierto por el único (businessId, number), (businessId, createdAt) y el
-- nuevo (businessId, status, createdAt).
DROP INDEX IF EXISTS "Sale_businessId_idx";
-- Cubierto por el único (businessId, number).
DROP INDEX IF EXISTS "RepairOrder_businessId_idx";
-- Tabla "WorkshopBranch" (@@map): cubierto por el único (businessId, name).
DROP INDEX IF EXISTS "Branch_businessId_idx";
-- Cubierto por el único (businessId, name).
DROP INDEX IF EXISTS "Supplier_businessId_idx";
-- Cubierto por el único (businessId, brand, model).
DROP INDEX IF EXISTS "DeviceModel_businessId_idx";
-- Cubierto por el único (businessId, key).
DROP INDEX IF EXISTS "SystemSettings_businessId_idx";
-- Cubierto por (businessId, status).
DROP INDEX IF EXISTS "RepairPart_businessId_idx";
-- Cubierto por (businessId, createdAt) y (businessId, productId, createdAt).
DROP INDEX IF EXISTS "InventoryMovement_businessId_idx";

-- ==================== STANDALONE DE BAJA SELECTIVIDAD ====================

-- Las consultas filtran businessId (cubre (businessId, status)) o barren
-- expiradas globalmente por fecha (cubre (expiresAt)).
DROP INDEX IF EXISTS "Reservation_status_idx";
-- Bandeja entrante: businessId(+status); dedupe/alta: requestedById.
DROP INDEX IF EXISTS "MarketplaceRequest_status_idx";
-- Consultas por orderId o businessId+status — ya cubiertas.
DROP INDEX IF EXISTS "RepairPart_status_idx";
-- Consultas por businessId(+userId)+createdAt o solo userId — ya cubiertas.
DROP INDEX IF EXISTS "CreditMovement_createdAt_idx";
-- Consultas por businessId/branchId/productId/etc. + fecha — ya cubiertas.
DROP INDEX IF EXISTS "InventoryMovement_createdAt_idx";
