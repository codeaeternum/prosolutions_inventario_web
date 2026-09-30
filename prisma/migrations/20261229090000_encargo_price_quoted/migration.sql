-- Precio cotizado al cliente al registrar el encargo (opcional, pesos).
-- Aditivo: columna nullable, no toca datos existentes.
ALTER TABLE "Encargo" ADD COLUMN "priceQuoted" DOUBLE PRECISION;
