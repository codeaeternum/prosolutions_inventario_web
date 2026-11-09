-- Folio de venta POR NEGOCIO (no global): Sale.number era una secuencia GLOBAL
-- multi-tenant (SERIAL + único global). Las ventas, cotizaciones y apartados de
-- otros tenants consumían números → huecos garantizados en los folios V-* de
-- cada negocio, y el número revelaba el volumen total de la plataforma al
-- comparar saltos entre tenants.
--
-- El consecutivo vive ahora en BusinessCounter.nextSaleNumber: nextSaleNumber()
-- (src/lib/domain/tenant-sequence.ts) lo incrementa atómicamente con
-- INSERT … ON CONFLICT … DO UPDATE dentro de la tx serializable, y el
-- único compuesto (businessId, number) es la red de seguridad.
--
-- Las ventas históricas conservan su number (ya únicos globales, así que no
-- pueden violar el único por negocio); la consecutividad per-tenant aplica
-- desde esta migración.

ALTER TABLE "Sale" ALTER COLUMN "number" DROP DEFAULT;
DROP INDEX "Sale_number_key";
CREATE UNIQUE INDEX "Sale_businessId_number_key" ON "Sale"("businessId", "number");

ALTER TABLE "BusinessCounter" ADD COLUMN "nextSaleNumber" INTEGER NOT NULL DEFAULT 1;

-- Backfill: cada negocio con ventas continúa desde su MAX(number)+1; los
-- negocios sin ventas quedan en 1 vía el COALESCE.
INSERT INTO "BusinessCounter" ("businessId", "nextSaleNumber")
SELECT b."id", COALESCE(m.max_number, 0) + 1
FROM "Business" b
LEFT JOIN (
    SELECT "businessId", MAX("number") AS max_number
    FROM "Sale"
    GROUP BY "businessId"
) m ON m."businessId" = b."id"
ON CONFLICT ("businessId") DO UPDATE SET "nextSaleNumber" = EXCLUDED."nextSaleNumber";
