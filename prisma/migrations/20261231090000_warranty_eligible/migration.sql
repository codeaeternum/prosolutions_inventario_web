-- Ventana real para reclamar garantía tras cada entrega.
--
-- Antes el guard de STATUS→WARRANTY leía warrantyUntil, pero SETTLE_DELIVER
-- lo limpia a null en la misma entrega: la vigencia "vencida" jamás existía
-- y cualquier empleado reabría DELIVERED→WARRANTY sin límite. Ahora la
-- elegibilidad se fija en cada entrega (SETTLE_DELIVER y el cierre delegado)
-- como now + warranty_days del negocio; vencida, reabrir exige ADMIN.
ALTER TABLE "RepairOrder"
  ADD COLUMN "warrantyEligibleUntil" TIMESTAMP(3);
