-- Encargos de clientes: ledger de dinero. El anticipo del cliente queda
-- ligado como Payment (con su CashMovement IN cuando es efectivo) y el pago
-- al proveedor como SupplierPayment ligado al encargo — antes ambos vivían
-- solo en supplierNote como texto libre y un anticipo en efectivo quedaba
-- fuera de la caja.
-- Aditivo: columnas nullable + FKs e índices, no toca datos existentes.
ALTER TABLE "Payment" ADD COLUMN "encargoId" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "encargoId" TEXT;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_encargoId_fkey"
  FOREIGN KEY ("encargoId") REFERENCES "Encargo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_encargoId_fkey"
  FOREIGN KEY ("encargoId") REFERENCES "Encargo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payment_encargoId_idx" ON "Payment"("encargoId");
CREATE INDEX "SupplierPayment_encargoId_idx" ON "SupplierPayment"("encargoId");
