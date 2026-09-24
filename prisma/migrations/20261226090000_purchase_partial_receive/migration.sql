-- Recepción parcial de órdenes de compra: cada línea lleva cuántas unidades
-- ya entraron (receivedQty). La OC sigue ORDERED hasta que todas las líneas
-- quedan receivedQty = quantity; no hay estado "PARCIAL" nuevo.
ALTER TABLE "PurchaseItem" ADD COLUMN "receivedQty" INTEGER NOT NULL DEFAULT 0;

-- Backfill: las líneas de OCs históricas ya RECEIVED entraron completas —
-- sin esto quedarían como "0 recibidas" aunque su stock ya está adentro.
UPDATE "PurchaseItem"
SET "receivedQty" = "PurchaseItem"."quantity"
FROM "Purchase"
WHERE "PurchaseItem"."purchaseId" = "Purchase"."id"
  AND "Purchase"."status" = 'RECEIVED';
