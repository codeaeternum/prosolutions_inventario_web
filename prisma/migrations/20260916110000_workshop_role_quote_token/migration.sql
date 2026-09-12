ALTER TYPE "UserRole" ADD VALUE 'WORKSHOP';
ALTER TABLE "RepairOrder" ADD COLUMN "quoteToken" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "RepairOrder" ALTER COLUMN "quoteToken" DROP DEFAULT;
CREATE UNIQUE INDEX "RepairOrder_quoteToken_key" ON "RepairOrder"("quoteToken");
ALTER TABLE "MarketplaceRequest" ADD COLUMN "saleId" TEXT;
CREATE UNIQUE INDEX "MarketplaceRequest_saleId_key" ON "MarketplaceRequest"("saleId");
ALTER TABLE "MarketplaceRequest" ADD CONSTRAINT "MarketplaceRequest_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
