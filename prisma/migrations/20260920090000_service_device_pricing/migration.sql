-- Precio de servicio por dispositivo: una fila por (servicio, modelo exacto)
-- o por (servicio, tipo de equipo). El precio específico gana sobre
-- WorkshopService.priceCents al recibir el equipo.
CREATE TABLE "WorkshopServicePrice" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "deviceModelId" TEXT,
  "equipmentType" TEXT,
  "priceCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkshopServicePrice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkshopServicePrice" ADD CONSTRAINT "WorkshopServicePrice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "WorkshopService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopServicePrice" ADD CONSTRAINT "WorkshopServicePrice_deviceModelId_fkey" FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "WorkshopServicePrice_serviceId_idx" ON "WorkshopServicePrice"("serviceId");
CREATE INDEX "WorkshopServicePrice_deviceModelId_idx" ON "WorkshopServicePrice"("deviceModelId");

-- Dedup por alcance: NULL != NULL en Postgres, así que van dos índices
-- únicos parciales (mismo patrón que las filas globales de DeviceModel).
CREATE UNIQUE INDEX "WorkshopServicePrice_service_model_key"
  ON "WorkshopServicePrice"("serviceId", "deviceModelId")
  WHERE "deviceModelId" IS NOT NULL;
CREATE UNIQUE INDEX "WorkshopServicePrice_service_equipment_key"
  ON "WorkshopServicePrice"("serviceId", "equipmentType")
  WHERE "deviceModelId" IS NULL AND "equipmentType" IS NOT NULL;

-- Una fila siempre lleva un alcance y nunca ambos.
ALTER TABLE "WorkshopServicePrice" ADD CONSTRAINT "WorkshopServicePrice_scope_check"
  CHECK (("deviceModelId" IS NULL) <> ("equipmentType" IS NULL));
