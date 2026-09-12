-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED', 'PENDING_REVIEW', 'REFUNDED', 'VOIDED');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "CashRegister" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "saleId" TEXT,
ADD COLUMN     "toBranchId" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "homeBranchId" TEXT;

-- CreateTable
CREATE TABLE "BranchStock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BranchStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "total" DOUBLE PRECISION NOT NULL,
    "branchId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "saleId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "proofUrl" TEXT,
    "reference" TEXT,
    "cashMovementId" TEXT,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchStock_branchId_quantity_idx" ON "BranchStock"("branchId", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "BranchStock_productId_branchId_key" ON "BranchStock"("productId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_number_key" ON "Sale"("number");

-- CreateIndex
CREATE INDEX "Sale_branchId_createdAt_idx" ON "Sale"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_createdAt_idx" ON "Sale"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_status_createdAt_idx" ON "Sale"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_cashMovementId_key" ON "Payment"("cashMovementId");

-- CreateIndex
CREATE INDEX "Payment_saleId_idx" ON "Payment"("saleId");

-- CreateIndex
CREATE INDEX "Payment_method_createdAt_idx" ON "Payment"("method", "createdAt");

-- CreateIndex
CREATE INDEX "CashRegister_branchId_status_idx" ON "CashRegister"("branchId", "status");

-- CreateIndex
CREATE INDEX "InventoryMovement_branchId_createdAt_idx" ON "InventoryMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_saleId_idx" ON "InventoryMovement"("saleId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "WorkshopBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES "WorkshopBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "CashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ==================== DATOS Y RESTRICCIONES ====================

-- Sucursal principal: recibe todo el stock histórico. Renombrable desde admin.
INSERT INTO "WorkshopBranch" ("id", "name", "isActive", "createdAt")
VALUES ('branch-principal', 'Local principal', true, now())
ON CONFLICT ("id") DO NOTHING;

-- Existencias por sucursal: el stock actual pasa completo a la sucursal principal.
INSERT INTO "BranchStock" ("id", "productId", "branchId", "quantity")
SELECT 'bs-' || "id", "id", 'branch-principal', "stock"
FROM "Product"
ON CONFLICT ("productId", "branchId") DO NOTHING;

-- Backfill de sucursal en registros históricos.
UPDATE "InventoryMovement" SET "branchId" = 'branch-principal' WHERE "branchId" IS NULL;
UPDATE "Reservation" SET "branchId" = 'branch-principal' WHERE "branchId" IS NULL;
UPDATE "CashRegister" SET "branchId" = 'branch-principal' WHERE "branchId" IS NULL;
UPDATE "User" SET "homeBranchId" = 'branch-principal' WHERE "homeBranchId" IS NULL AND "role" IN ('ADMIN', 'EMPLOYEE');

-- Una caja abierta por sucursal (sustituye la restricción global anterior).
DROP INDEX IF EXISTS "CashRegister_one_open";
CREATE UNIQUE INDEX "CashRegister_one_open_per_branch" ON "CashRegister" ("branchId") WHERE "status" = 'OPEN';

-- Restricciones de integridad.
ALTER TABLE "BranchStock" ADD CONSTRAINT "BranchStock_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_total_nonnegative_finite" CHECK ("total" >= 0 AND "total" < 'Infinity'::double precision);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_quantity_positive" CHECK ("quantity" > 0 AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonzero_finite" CHECK ("amount" <> 0 AND "amount" < 'Infinity'::double precision AND "amount" > '-Infinity'::double precision);
