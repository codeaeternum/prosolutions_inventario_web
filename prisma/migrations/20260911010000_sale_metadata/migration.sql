ALTER TABLE "InventoryMovement" ADD COLUMN "businessVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentMethod" TEXT, ADD COLUMN "customerId" TEXT, ADD COLUMN "reservationId" TEXT;
CREATE UNIQUE INDEX "CashRegister_one_open" ON "CashRegister" ("status") WHERE "status" = 'OPEN';
