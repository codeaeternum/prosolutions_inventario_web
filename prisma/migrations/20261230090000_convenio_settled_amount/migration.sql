-- Convenio B2B: congela el monto liquidado al saldar la cuenta. Hasta aquí
-- convenioSettledAt solo marcaba CUÁNDO se pagó y el total "ya saldado" se
-- derivaba del partnerPriceCents AL LEER — editar el precio convenio de una
-- orden ya saldada reescribía el histórico. convenioSettledAmountCents
-- guarda CUÁNTO se liquidó (el precio vigente en ese instante).
-- Aditivo: las cuentas saldadas antes del snapshot quedan NULL y el
-- agregado cae al partnerPriceCents actual como respaldo legacy.
ALTER TABLE "RepairOrder" ADD COLUMN "convenioSettledAmountCents" INTEGER;
