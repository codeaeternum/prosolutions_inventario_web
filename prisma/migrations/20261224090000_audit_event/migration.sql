-- Bitácora administrativa (AuditEvent): quién cambió qué en ediciones que
-- antes no dejaban rastro (precios, usuarios, ajustes, catálogos). Las
-- operaciones de dinero/stock siguen en BusinessOperation y las de taller en
-- RepairEvent; esta tabla es solo lectura forense, jamás se edita ni borra.
-- Aditivo: no toca datos existentes.
CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "entityName" TEXT,
    "summary" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AuditEvent_businessId_createdAt_idx" ON "AuditEvent"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_businessId_actorId_createdAt_idx" ON "AuditEvent"("businessId", "actorId", "createdAt");
