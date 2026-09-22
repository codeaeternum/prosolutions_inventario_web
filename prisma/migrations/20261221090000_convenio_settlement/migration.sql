-- Cuentas del convenio entre talleres asociados (órdenes espejo): marca
-- local simétrica de "convenio saldado". En la orden ORIGEN significa "ya
-- le pagué al taller reparador"; en la ESPEJO, "el captador ya me pagó".
-- Aditivo: las órdenes existentes quedan con la cuenta pendiente (NULL).
ALTER TABLE "RepairOrder" ADD COLUMN "convenioSettledAt" TIMESTAMP(3);
