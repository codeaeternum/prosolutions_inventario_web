-- Cuatro niveles de precio: costo / taller propio / aliado / público.
-- internalPrice (taller propio) es opcional: null significa que la pieza
-- se cobra a retailPrice cuando se consume en una orden de servicio propia.
ALTER TABLE "Product" ADD COLUMN "internalPrice" DOUBLE PRECISION;

-- Visibilidad de mercado en tres niveles: HIDDEN / ALLIES / PUBLIC.
-- Lo que antes era visible para talleres migra a ALLIES (mismo alcance que
-- tenía); lo oculto queda HIDDEN. PUBLIC es nuevo alcance (catálogo público).
ALTER TABLE "Product" ADD COLUMN "marketVisibility" TEXT NOT NULL DEFAULT 'HIDDEN';
UPDATE "Product" SET "marketVisibility" = CASE WHEN "marketplaceVisible" THEN 'ALLIES' ELSE 'HIDDEN' END;
DROP INDEX IF EXISTS "Product_marketplaceVisible_idx";
ALTER TABLE "Product" DROP COLUMN "marketplaceVisible";
CREATE INDEX "Product_marketVisibility_idx" ON "Product"("marketVisibility");
