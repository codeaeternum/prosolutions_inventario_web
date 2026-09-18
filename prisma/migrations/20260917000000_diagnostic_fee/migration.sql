-- Cargo de diagnóstico/revisión: lo único que se cobra al entregar una orden
-- cerrada sin reparación (NOT_AUTHORIZED / NOT_REPAIRED).

ALTER TABLE "RepairOrder" ADD COLUMN "diagnosticFeeCents" INTEGER;
