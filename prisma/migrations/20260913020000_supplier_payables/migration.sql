-- Cuentas por pagar a proveedores: abonos ligados a una OC (ORDERED|RECEIVED)
-- o a cuenta general. El saldo del proveedor se deriva:
--   sum(Purchase.totalCents WHERE status='RECEIVED') - sum(SupplierPayment.amountCents)
-- Purchase.paidCents es cache por OC para validar ligados y marcar "Pagada".

ALTER TABLE "Purchase"
    ADD COLUMN "paidCents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "dueAt" TIMESTAMP(3),
    ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierPayment_amount_positive" CHECK ("amountCents" > 0),
    CONSTRAINT "SupplierPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupplierPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SupplierPayment_businessId_idx" ON "SupplierPayment"("businessId");
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");
CREATE INDEX "SupplierPayment_purchaseId_idx" ON "SupplierPayment"("purchaseId");
