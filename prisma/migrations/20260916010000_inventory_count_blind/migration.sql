-- Conteo ciego: cuando "blind" es true, la captura no expone expectedQty al
-- capturador; las cantidades esperadas y las diferencias se revelan al aplicar.

ALTER TABLE "InventoryCount" ADD COLUMN "blind" BOOLEAN NOT NULL DEFAULT false;
