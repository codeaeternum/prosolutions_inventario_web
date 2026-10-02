-- Bitácora de la consola de plataforma: suspender/reactivar/eliminar
-- empresas. Aditivo: tabla nueva sin tocar datos existentes.
CREATE TABLE "PlatformEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessSlug" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformEvent_businessId_createdAt_idx" ON "PlatformEvent"("businessId", "createdAt");
CREATE INDEX "PlatformEvent_createdAt_idx" ON "PlatformEvent"("createdAt");
