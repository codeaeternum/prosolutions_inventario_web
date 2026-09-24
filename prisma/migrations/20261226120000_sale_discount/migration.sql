-- Descuento autorizado al cobrar un documento del mostrador: el servidor
-- recalcula el total de catálogo como siempre y los pagos cuadran contra
-- (total - discountCents). El motivo queda en la propia venta — rastro de
-- quién vendió abajo del precio y por qué.
-- Aditivo: DEFAULT 0 deja todas las ventas existentes sin descuento.
ALTER TABLE "Sale" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN "discountReason" TEXT;
