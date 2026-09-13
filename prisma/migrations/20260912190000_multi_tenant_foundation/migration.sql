-- Multi-tenant foundation: every tenant row belongs to a Business.
-- Default business is seeded from the existing public-profile settings so
-- single-tenant installs keep working unchanged.

CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'electronics-repair',
    "phone" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE INDEX "Business_isActive_idx" ON "Business"("isActive");

INSERT INTO "Business" ("id", "name", "slug", "phone", "address", "logoUrl", "updatedAt")
SELECT 'biz-default',
       COALESCE((SELECT "value" FROM "SystemSettings" WHERE "key" = 'ticket_business_name'), 'ProSolutions'),
       COALESCE((SELECT "value" FROM "SystemSettings" WHERE "key" = 'business_slug'), 'prosolutions'),
       (SELECT "value" FROM "SystemSettings" WHERE "key" = 'public_phone'),
       (SELECT "value" FROM "SystemSettings" WHERE "key" = 'public_address'),
       (SELECT "value" FROM "SystemSettings" WHERE "key" = 'public_logo'),
       CURRENT_TIMESTAMP;

ALTER TABLE "InventoryMovement" ADD COLUMN "businessId" TEXT;
UPDATE "InventoryMovement" SET "businessId" = 'biz-default';
ALTER TABLE "InventoryMovement" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InventoryMovement_businessId_idx" ON "InventoryMovement"("businessId");

ALTER TABLE "User" ADD COLUMN "businessId" TEXT;
UPDATE "User" SET "businessId" = 'biz-default';
ALTER TABLE "User" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_businessId_idx" ON "User"("businessId");

ALTER TABLE "Brand" ADD COLUMN "businessId" TEXT;
UPDATE "Brand" SET "businessId" = 'biz-default';
ALTER TABLE "Brand" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Brand_businessId_idx" ON "Brand"("businessId");

ALTER TABLE "Model" ADD COLUMN "businessId" TEXT;
UPDATE "Model" SET "businessId" = 'biz-default';
ALTER TABLE "Model" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Model" ADD CONSTRAINT "Model_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Model_businessId_idx" ON "Model"("businessId");

ALTER TABLE "Category" ADD COLUMN "businessId" TEXT;
UPDATE "Category" SET "businessId" = 'biz-default';
ALTER TABLE "Category" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");

ALTER TABLE "Product" ADD COLUMN "businessId" TEXT;
UPDATE "Product" SET "businessId" = 'biz-default';
ALTER TABLE "Product" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Product_businessId_idx" ON "Product"("businessId");

ALTER TABLE "PriceHistory" ADD COLUMN "businessId" TEXT;
UPDATE "PriceHistory" SET "businessId" = 'biz-default';
ALTER TABLE "PriceHistory" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PriceHistory_businessId_idx" ON "PriceHistory"("businessId");

ALTER TABLE "ProductModel" ADD COLUMN "businessId" TEXT;
UPDATE "ProductModel" SET "businessId" = 'biz-default';
ALTER TABLE "ProductModel" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "ProductModel" ADD CONSTRAINT "ProductModel_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ProductModel_businessId_idx" ON "ProductModel"("businessId");

ALTER TABLE "Reservation" ADD COLUMN "businessId" TEXT;
UPDATE "Reservation" SET "businessId" = 'biz-default';
ALTER TABLE "Reservation" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Reservation_businessId_idx" ON "Reservation"("businessId");

ALTER TABLE "CreditMovement" ADD COLUMN "businessId" TEXT;
UPDATE "CreditMovement" SET "businessId" = 'biz-default';
ALTER TABLE "CreditMovement" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CreditMovement_businessId_idx" ON "CreditMovement"("businessId");

ALTER TABLE "Settings" ADD COLUMN "businessId" TEXT;
UPDATE "Settings" SET "businessId" = 'biz-default';
ALTER TABLE "Settings" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Settings_businessId_idx" ON "Settings"("businessId");

ALTER TABLE "PushSubscription" ADD COLUMN "businessId" TEXT;
UPDATE "PushSubscription" SET "businessId" = 'biz-default';
ALTER TABLE "PushSubscription" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PushSubscription_businessId_idx" ON "PushSubscription"("businessId");

ALTER TABLE "CashRegister" ADD COLUMN "businessId" TEXT;
UPDATE "CashRegister" SET "businessId" = 'biz-default';
ALTER TABLE "CashRegister" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CashRegister_businessId_idx" ON "CashRegister"("businessId");

ALTER TABLE "CashMovement" ADD COLUMN "businessId" TEXT;
UPDATE "CashMovement" SET "businessId" = 'biz-default';
ALTER TABLE "CashMovement" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CashMovement_businessId_idx" ON "CashMovement"("businessId");

ALTER TABLE "SystemSettings" ADD COLUMN "businessId" TEXT;
UPDATE "SystemSettings" SET "businessId" = 'biz-default';
ALTER TABLE "SystemSettings" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SystemSettings_businessId_idx" ON "SystemSettings"("businessId");

ALTER TABLE "BusinessOperation" ADD COLUMN "businessId" TEXT;
UPDATE "BusinessOperation" SET "businessId" = 'biz-default';
ALTER TABLE "BusinessOperation" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "BusinessOperation" ADD CONSTRAINT "BusinessOperation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BusinessOperation_businessId_idx" ON "BusinessOperation"("businessId");

ALTER TABLE "BranchStock" ADD COLUMN "businessId" TEXT;
UPDATE "BranchStock" SET "businessId" = 'biz-default';
ALTER TABLE "BranchStock" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BranchStock_businessId_idx" ON "BranchStock"("businessId");

ALTER TABLE "Sale" ADD COLUMN "businessId" TEXT;
UPDATE "Sale" SET "businessId" = 'biz-default';
ALTER TABLE "Sale" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Sale_businessId_idx" ON "Sale"("businessId");

ALTER TABLE "SaleItem" ADD COLUMN "businessId" TEXT;
UPDATE "SaleItem" SET "businessId" = 'biz-default';
ALTER TABLE "SaleItem" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SaleItem_businessId_idx" ON "SaleItem"("businessId");

ALTER TABLE "Payment" ADD COLUMN "businessId" TEXT;
UPDATE "Payment" SET "businessId" = 'biz-default';
ALTER TABLE "Payment" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_businessId_idx" ON "Payment"("businessId");

ALTER TABLE "RepairOrder" ADD COLUMN "businessId" TEXT;
UPDATE "RepairOrder" SET "businessId" = 'biz-default';
ALTER TABLE "RepairOrder" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RepairOrder_businessId_idx" ON "RepairOrder"("businessId");

ALTER TABLE "RepairPart" ADD COLUMN "businessId" TEXT;
UPDATE "RepairPart" SET "businessId" = 'biz-default';
ALTER TABLE "RepairPart" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "RepairPart" ADD CONSTRAINT "RepairPart_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RepairPart_businessId_idx" ON "RepairPart"("businessId");

ALTER TABLE "RepairEvent" ADD COLUMN "businessId" TEXT;
UPDATE "RepairEvent" SET "businessId" = 'biz-default';
ALTER TABLE "RepairEvent" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RepairEvent_businessId_idx" ON "RepairEvent"("businessId");

ALTER TABLE "CashRequest" ADD COLUMN "businessId" TEXT;
UPDATE "CashRequest" SET "businessId" = 'biz-default';
ALTER TABLE "CashRequest" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "CashRequest" ADD CONSTRAINT "CashRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CashRequest_businessId_idx" ON "CashRequest"("businessId");

ALTER TABLE "RepairPhoto" ADD COLUMN "businessId" TEXT;
UPDATE "RepairPhoto" SET "businessId" = 'biz-default';
ALTER TABLE "RepairPhoto" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "RepairPhoto" ADD CONSTRAINT "RepairPhoto_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RepairPhoto_businessId_idx" ON "RepairPhoto"("businessId");

ALTER TABLE "WorkshopService" ADD COLUMN "businessId" TEXT;
UPDATE "WorkshopService" SET "businessId" = 'biz-default';
ALTER TABLE "WorkshopService" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "WorkshopService" ADD CONSTRAINT "WorkshopService_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "WorkshopService_businessId_idx" ON "WorkshopService"("businessId");

ALTER TABLE "MarketplaceRequest" ADD COLUMN "businessId" TEXT;
UPDATE "MarketplaceRequest" SET "businessId" = 'biz-default';
ALTER TABLE "MarketplaceRequest" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "MarketplaceRequest" ADD CONSTRAINT "MarketplaceRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "MarketplaceRequest_businessId_idx" ON "MarketplaceRequest"("businessId");

ALTER TABLE "WorkshopBranch" ADD COLUMN "businessId" TEXT;
UPDATE "WorkshopBranch" SET "businessId" = 'biz-default';
ALTER TABLE "WorkshopBranch" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "WorkshopBranch" ADD CONSTRAINT "Branch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Branch_businessId_idx" ON "WorkshopBranch"("businessId");

ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Per-business uniqueness: same name/slug/barcode may exist in two companies.
ALTER TABLE "SystemSettings" DROP CONSTRAINT IF EXISTS "SystemSettings_key_key";
DROP INDEX IF EXISTS "SystemSettings_key_key";
CREATE UNIQUE INDEX "SystemSettings_businessId_key_key" ON "SystemSettings"("businessId", "key");
DROP INDEX IF EXISTS "Brand_name_key"; DROP INDEX IF EXISTS "Brand_slug_key";
ALTER TABLE "Brand" DROP CONSTRAINT IF EXISTS "Brand_name_key"; ALTER TABLE "Brand" DROP CONSTRAINT IF EXISTS "Brand_slug_key";
CREATE UNIQUE INDEX "Brand_businessId_name_key" ON "Brand"("businessId", "name");
CREATE UNIQUE INDEX "Brand_businessId_slug_key" ON "Brand"("businessId", "slug");
ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS "Category_name_key"; ALTER TABLE "Category" DROP CONSTRAINT IF EXISTS "Category_slug_key";
DROP INDEX IF EXISTS "Category_name_key"; DROP INDEX IF EXISTS "Category_slug_key";
CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");
CREATE UNIQUE INDEX "Category_businessId_slug_key" ON "Category"("businessId", "slug");
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_barcode_key";
DROP INDEX IF EXISTS "Product_barcode_key";
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");
ALTER TABLE "WorkshopBranch" DROP CONSTRAINT IF EXISTS "WorkshopBranch_name_key";
DROP INDEX IF EXISTS "WorkshopBranch_name_key";
CREATE UNIQUE INDEX "Branch_businessId_name_key" ON "WorkshopBranch"("businessId", "name");

-- The slug now lives on Business.slug — single source of truth.
DELETE FROM "SystemSettings" WHERE "key" = 'business_slug';
