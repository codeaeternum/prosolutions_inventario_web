-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "businessVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BusinessOperation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOperation_key_key" ON "BusinessOperation"("key");

-- CreateIndex
CREATE INDEX "BusinessOperation_actorId_createdAt_idx" ON "BusinessOperation"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessOperation" ADD CONSTRAINT "BusinessOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense in depth: transactions also validate these rules before writing.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_amount_positive_finite" CHECK ("amount" > 0 AND "amount" < 'Infinity'::double precision);
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_amount_positive_finite" CHECK ("amount" > 0 AND "amount" < 'Infinity'::double precision);
ALTER TABLE "User" ADD CONSTRAINT "User_creditBalance_nonnegative_finite" CHECK ("creditBalance" >= 0 AND "creditBalance" < 'Infinity'::double precision);
ALTER TABLE "Product" ADD CONSTRAINT "Product_prices_nonnegative_finite" CHECK ("retailPrice" >= 0 AND "retailPrice" < 'Infinity'::double precision AND "wholesalePrice" >= 0 AND "wholesalePrice" < 'Infinity'::double precision AND ("costPrice" IS NULL OR ("costPrice" >= 0 AND "costPrice" < 'Infinity'::double precision)));
