-- Permisos de staff por módulo y sucursal (vacío = sin restricción),
-- alertas de stock bajo anti-spam, tipo de documento de venta y lista de encargos.
ALTER TABLE "User" ADD COLUMN "allowedModules" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "allowedBranchIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN "lowStockAlertAt" TIMESTAMP(3);
CREATE TYPE "SaleKind" AS ENUM ('RETAIL', 'WORKSHOP');
ALTER TABLE "Sale" ADD COLUMN "kind" "SaleKind" NOT NULL DEFAULT 'RETAIL';
CREATE TYPE "ShoppingItemStatus" AS ENUM ('PENDING', 'PURCHASED', 'CANCELLED');
CREATE TABLE "ShoppingItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitCostCents" INTEGER NOT NULL DEFAULT 0,
  "status" "ShoppingItemStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "purchaseId" TEXT,
  "createdById" TEXT NOT NULL,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShoppingItem_businessId_status_idx" ON "ShoppingItem"("businessId", "status");
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
