-- Documentos de venta vivos: ventas suspendidas, cotizaciones y apartados
-- multi-producto de mostrador. Aditivo: los documentos existentes siguen
-- en COMPLETED/VOIDED con kind RETAIL/WORKSHOP.
ALTER TYPE "SaleStatus" ADD VALUE 'DRAFT';
ALTER TYPE "SaleStatus" ADD VALUE 'OPEN';
ALTER TYPE "SaleKind" ADD VALUE 'LAYAWAY';
ALTER TYPE "SaleKind" ADD VALUE 'QUOTE';

ALTER TABLE "Sale" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "note" TEXT;

CREATE INDEX "Sale_businessId_status_idx2" ON "Sale"("businessId", "status", "kind");
