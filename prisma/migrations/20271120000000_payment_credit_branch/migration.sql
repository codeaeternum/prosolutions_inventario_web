-- Ligadura estructurada de los abonos de crédito: Payment.creditMovementId y
-- Payment.branchId reemplazan los tags máquina "[credit-movement:<id>]" y
-- "[branch:<id>]" que la convención de Oleada 45 escribía al final de
-- Payment.notes (ver src/lib/domain/cash.ts). La deuda técnica queda saldada:
-- el writer (domain/credit) ya no emite tags y los cortes/feed consultan las
-- columnas.
--
-- Backfill (idempotente, acotado a IS NULL — mismo criterio que
-- perf_indexes_phone_normalized):
--   • substring(notes from '...') devuelve el primer grupo del primer match,
--     exactamente la misma lectura que hacía el regex JS de los readers
--     legacy (creditPaymentMovementFromNotes / creditPaymentBranchFromNotes).
--   • El guard EXISTS evita poblar la columna con un id colgado (un
--     CreditMovement cuyo usuario hubiera sido borrado antes del guard de
--     historial, o una sucursal inexistente): si el destino no existe la
--     fila queda en NULL y el FK nunca truena al crearse. En la práctica no
--     puede ocurrir — las cuentas con movimientos no se borran (guard de
--     users/[id] DELETE) y las sucursales no tienen borrado individual.
--
-- Limpieza de notes: cada tag se recorta SOLO cuando su ligadura ya quedó en
-- la columna correspondiente — nunca se destruye información sin reemplazo
-- columnar. El formato es máquina y exacto (" · [credit-movement:<id>]" /
-- " · [branch:<id>]", unidos con el separador " · " del writer), así que el
-- regexp_replace global reproduce al stripCreditPaymentMetadata del código.
-- Excepción documentada: los abonos cobrados por el código viejo DURANTE la
-- ventana del deploy (migrate deploy corre antes de promover la app nueva)
-- nacen después de este backfill y conservan sus tags en notes — por eso la
-- capa de lectura mantiene el fallback de tag legacy y la presentación sigue
-- recortándolos al mostrar.
--
-- ADD COLUMN IF NOT EXISTS / backfill IS NULL: reejecutable tras un retry
-- (migrate deploy corre en transacción, pero la idempotencia no estorba).

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "creditMovementId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- Backfill desde los tags máquina de notes, solo cuando el destino existe.
UPDATE "Payment" p
SET "creditMovementId" = substring(p."notes" from '\[credit-movement:([^]]+)\]')
WHERE p."creditMovementId" IS NULL
  AND p."notes" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "CreditMovement" cm
    WHERE cm."id" = substring(p."notes" from '\[credit-movement:([^]]+)\]')
  );

UPDATE "Payment" p
SET "branchId" = substring(p."notes" from '\[branch:([^]]+)\]')
WHERE p."branchId" IS NULL
  AND p."notes" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "WorkshopBranch" b
    WHERE b."id" = substring(p."notes" from '\[branch:([^]]+)\]')
  );

-- Limpieza: recorta cada tag solo cuando su ligadura ya vive en columna.
-- NULLIF+trim reproduce el strip+trim del reader legacy; notes nunca queda
-- vacío porque siempre arranca con "Abono de <cliente>", pero el btrim
-- defiende el caso de notas capturadas con espacios colados tras el strip.
UPDATE "Payment"
SET "notes" = NULLIF(btrim(regexp_replace("notes", '\s*· \[credit-movement:[^]]+\]', '', 'g')), '')
WHERE "creditMovementId" IS NOT NULL
  AND "notes" ~ '\[credit-movement:[^]]+\]';

UPDATE "Payment"
SET "notes" = NULLIF(btrim(regexp_replace("notes", '\s*· \[branch:[^]]+\]', '', 'g')), '')
WHERE "branchId" IS NOT NULL
  AND "notes" ~ '\[branch:[^]]+\]';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payment_creditMovementId_idx" ON "Payment"("creditMovementId");
CREATE INDEX IF NOT EXISTS "Payment_branchId_idx" ON "Payment"("branchId");

-- AddForeignKey (SetNull: el comprobante de dinero sobrevive aunque el
-- asiento de deuda o la sucursal desaparezcan — mismo criterio que
-- CashRegister.branchId).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_creditMovementId_fkey"
  FOREIGN KEY ("creditMovementId") REFERENCES "CreditMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
