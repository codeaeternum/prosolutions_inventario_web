-- Esquema de pago del staff para el "Estimado de nómina" (un solo tipo por
-- usuario en v1): NONE | HOURLY | SALARY | COMMISSION. payRateCents es la
-- tarifa por hora (HOURLY) o el sueldo por quincena (SALARY); commissionPct
-- es el % sobre ventas COMPLETED. Default 'NONE' y columnas nullable:
-- retrocompatible, nadie cambia de esquema hasta que el ADMIN lo capture.
ALTER TABLE "User"
  ADD COLUMN "payType" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "payRateCents" INTEGER,
  ADD COLUMN "commissionPct" DOUBLE PRECISION;
