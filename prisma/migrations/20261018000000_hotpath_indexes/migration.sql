-- Índices en rutas calientes: cierres de caja, historial de inventario,
-- devoluciones por reserva, reportes por fecha, delegación entre talleres.
-- IF NOT EXISTS: algunos entornos ya crearon índices a mano fuera de schema.
CREATE INDEX IF NOT EXISTS "InventoryMovement_reservationId_idx" ON "InventoryMovement"("reservationId");
CREATE INDEX IF NOT EXISTS "CashMovement_registerId_idx" ON "CashMovement"("registerId");
CREATE INDEX IF NOT EXISTS "Sale_businessId_createdAt_idx" ON "Sale"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "Sale_sellerId_idx" ON "Sale"("sellerId");
CREATE INDEX IF NOT EXISTS "CreditMovement_businessId_createdAt_idx" ON "CreditMovement"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "Reservation_businessId_status_idx" ON "Reservation"("businessId", "status");
CREATE INDEX IF NOT EXISTS "Product_businessId_isActive_idx" ON "Product"("businessId", "isActive");
CREATE INDEX IF NOT EXISTS "RepairOrder_intakeBranchId_idx" ON "RepairOrder"("intakeBranchId");
CREATE INDEX IF NOT EXISTS "MarketplaceRequest_requestedById_idx" ON "MarketplaceRequest"("requestedById");
CREATE INDEX IF NOT EXISTS "MarketplaceRequest_decidedById_idx" ON "MarketplaceRequest"("decidedById");
