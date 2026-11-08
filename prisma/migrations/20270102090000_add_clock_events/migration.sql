-- Checador real de asistencia: eventos "IN"/"OUT" que cada usuario registra
-- sobre sí mismo en POST /api/asistencia. Cuando un empleado tiene eventos en
-- el rango consultado, sus jornadas (turnos y estimado de nómina) salen de
-- pares IN→OUT reales en lugar de la reconstrucción por actividad.
-- branchId es snapshot escalar (sin FK): la sucursal puede desactivarse o
-- renombrarse sin tocar el historial; el evento pertenece al negocio vía
-- businessId. Los FK a Business y User borran en cascada: no queda historial
-- huérfano al eliminar el tenant o la cuenta.
-- Aditivo: no toca tablas ni datos existentes.
CREATE TABLE IF NOT EXISTS "ClockEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClockEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClockEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClockEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ClockEvent_businessId_userId_at_idx" ON "ClockEvent"("businessId", "userId", "at");
CREATE INDEX IF NOT EXISTS "ClockEvent_businessId_at_idx" ON "ClockEvent"("businessId", "at");
