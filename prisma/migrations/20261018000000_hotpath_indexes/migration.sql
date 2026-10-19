-- Índices en rutas calientes: cierres de caja, historial de inventario,
-- devoluciones por reserva, reportes por fecha, delegación entre talleres.
CREATE INDEX "InventoryMovement_reservationId_idx" ON "InventoryMovement"("reservationId");
CREATE INDEX "CashMovement_registerId_idx" ON "CashMovement"("registerId");
CREATE INDEX "Sale_businessId_createdAt_idx" ON "Sale"("businessId", "createdAt");
CREATE INDEX "Sale_sellerId_idx" ON "Sale"("sellerId");
CREATE INDEX "CreditMovement_businessId_createdAt_idx" ON "CreditMovement"("businessId", "createdAt");
CREATE INDEX "Reservation_businessId_status_idx" ON "Reservation"("businessId", "status");
CREATE INDEX "Product_businessId_isActive_idx" ON "Product"("businessId", "isActive");
CREATE INDEX "RepairOrder_intakeBranchId_idx" ON "RepairOrder"("intakeBranchId");
CREATE INDEX "RepairOrder_originBusinessId_idx" ON "RepairOrder"("originBusinessId");
CREATE INDEX "RepairOrder_delegatedToBusinessId_idx" ON "RepairOrder"("delegatedToBusinessId");
CREATE INDEX "RepairOrder_delegatedFromOrderId_idx" ON "RepairOrder"("delegatedFromOrderId");
CREATE INDEX "MarketplaceRequest_requestedById_idx" ON "MarketplaceRequest"("requestedById");
CREATE INDEX "MarketplaceRequest_decidedById_idx" ON "MarketplaceRequest"("decidedById");
