-- Folio de taller POR NEGOCIO (no global): RepairOrder.number era una
-- secuencia GLOBAL multi-tenant (SERIAL + único global). Las órdenes de
-- otros tenants y las espejos de delegación consumían números → huecos
-- garantizados en los folios de cada negocio, y el número revelaba el
-- volumen total de la plataforma al comparar saltos entre tenants.
--
-- El consecutivo vive ahora en BusinessCounter: nextOrderNumber()
-- (src/lib/domain/tenant-sequence.ts) lo incrementa atómicamente con
-- INSERT … ON CONFLICT … DO UPDATE dentro de la tx serializable, y el
-- único compuesto (businessId, number) es la red de seguridad.
--
-- Las órdenes históricas conservan su number (ya únicos globales, así que
-- no pueden violar el único por negocio); la consecutividad per-tenant
-- aplica desde esta migración.

-- La columna deja de ser SERIAL: se quita el default nextval. La secuencia
-- "RepairOrder_number_seq" se conserva viva y huérfana (herramientas de
-- importación histórica la consultan con setval) pero ya nada la usa.
ALTER TABLE "RepairOrder" ALTER COLUMN "number" DROP DEFAULT;
DROP INDEX "RepairOrder_number_key";
CREATE UNIQUE INDEX "RepairOrder_businessId_number_key" ON "RepairOrder"("businessId", "number");

CREATE TABLE "BusinessCounter" (
    "businessId" TEXT NOT NULL,
    "nextOrderNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BusinessCounter_pkey" PRIMARY KEY ("businessId"),
    CONSTRAINT "BusinessCounter_businessId_fkey" FOREIGN KEY ("businessId")
        REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill: cada negocio con órdenes continúa desde su MAX(number)+1; los
-- negocios sin órdenes (activos o inactivos — todos se cubren para que el
-- contador exista aunque el alta de negocio no lo cree explícito) quedan
-- en 1 vía el COALESCE: su primer folio será OT-…001.
INSERT INTO "BusinessCounter" ("businessId", "nextOrderNumber")
SELECT b."id", COALESCE(m.max_number, 0) + 1
FROM "Business" b
LEFT JOIN (
    SELECT "businessId", MAX("number") AS max_number
    FROM "RepairOrder"
    GROUP BY "businessId"
) m ON m."businessId" = b."id";
