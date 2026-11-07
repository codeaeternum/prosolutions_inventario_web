-- Token público de rastreo por orden (auditoría: folio + 4 dígitos del
-- teléfono era enumerable). El default temporal rellena las filas existentes
-- y luego se elimina: los valores nuevos los genera el cliente Prisma (cuid()).
ALTER TABLE "RepairOrder" ADD COLUMN "trackingToken" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "RepairOrder" ALTER COLUMN "trackingToken" DROP DEFAULT;
CREATE UNIQUE INDEX "RepairOrder_trackingToken_key" ON "RepairOrder"("trackingToken");
