-- Conteo físico por sucursal: sesión de captura de existencias reales que al
-- aplicarse genera ajustes auditados (InventoryMovement ADJUSTMENT).
-- Una sola sesión OPEN por sucursal: índice único parcial
-- "InventoryCount_one_open" (mismo patrón que "CashRegister_one_open").

CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'APPLIED', 'CANCELLED');

CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryCount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryCount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InventoryCount_number_key" ON "InventoryCount"("number");
CREATE INDEX "InventoryCount_businessId_status_idx" ON "InventoryCount"("businessId", "status");
CREATE UNIQUE INDEX "InventoryCount_one_open" ON "InventoryCount"("branchId") WHERE "status" = 'OPEN';

CREATE TABLE "InventoryCountItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    CONSTRAINT "InventoryCountItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryCountItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryCountItem_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryCountItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InventoryCountItem_countId_productId_key" ON "InventoryCountItem"("countId", "productId");
CREATE INDEX "InventoryCountItem_businessId_idx" ON "InventoryCountItem"("businessId");
