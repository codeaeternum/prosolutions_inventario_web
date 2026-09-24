-- Folios por negocio en Purchase.number e InventoryCount.number: el
-- autoincrement GLOBAL dejaba huecos en los folios de cada tenant (OC-000001,
-- OC-000007...) y exponía el volumen total de la plataforma al comparar saltos.
-- El dominio ahora asigna MAX(number) del negocio + 1 dentro de la transacción
-- serializable (ver src/lib/domain/purchasing.ts, counts.ts y shopping.ts);
-- el default autoincrement queda como fallback inerte y las filas históricas
-- conservan su número.
--
-- Purchase.number no tenía índice único: se agrega el compuesto como red de
-- seguridad (los números históricos son únicos globales, así que no pueden
-- violar el único por negocio). InventoryCount.number era @unique GLOBAL:
-- dos tenants pueden compartir folio, así que pasa a (businessId, number).

DROP INDEX "InventoryCount_number_key";
CREATE UNIQUE INDEX "InventoryCount_businessId_number_key" ON "InventoryCount"("businessId", "number");
CREATE UNIQUE INDEX "Purchase_businessId_number_key" ON "Purchase"("businessId", "number");
