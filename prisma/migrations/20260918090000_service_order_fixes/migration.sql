-- RepairOrder: servicio elegido del catálogo + marca de cierre sin reparación
ALTER TABLE "RepairOrder" ADD COLUMN "serviceName" TEXT;
ALTER TABLE "RepairOrder" ADD COLUMN "closedWithoutRepair" BOOLEAN NOT NULL DEFAULT false;

-- DeviceModel: scope por tenant (NULL = catálogo global de plataforma)
ALTER TABLE "DeviceModel" ADD COLUMN "businessId" TEXT;
ALTER TABLE "DeviceModel" ADD CONSTRAINT "DeviceModel_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dedup por tenant (businessId NOT NULL). El unique anterior (brand, model)
-- se sustituye: con NULL no deduplicaría las filas globales.
ALTER TABLE "DeviceModel" DROP CONSTRAINT IF EXISTS "DeviceModel_brand_model_key";
DROP INDEX IF EXISTS "DeviceModel_brand_model_key";
CREATE UNIQUE INDEX "DeviceModel_businessId_brand_model_key"
  ON "DeviceModel"("businessId", "brand", "model");
-- Dedup de filas globales (businessId IS NULL): Postgres trata NULL != NULL,
-- así que va aparte como índice parcial.
CREATE UNIQUE INDEX "DeviceModel_global_brand_model_key"
  ON "DeviceModel"("brand", "model") WHERE "businessId" IS NULL;

CREATE INDEX "DeviceModel_businessId_idx" ON "DeviceModel"("businessId");
