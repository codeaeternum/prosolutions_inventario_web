-- Encargos de clientes: pieza que el cliente pide y el negocio no tiene en
-- stock. Estados PENDING → ORDERED → READY → DELIVERED (CANCELLED desde
-- cualquiera). `marketplaceRequestId` liga con la solicitud al aliado cuando
-- la pieza se pidió por el mercado B2B.
-- Aditivo: tabla nueva, no toca datos existentes.
CREATE TABLE IF NOT EXISTS "Encargo" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "deposit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "supplierNote" TEXT,
    "marketplaceRequestId" TEXT,
    "createdById" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Encargo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Encargo_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encargo_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WorkshopBranch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encargo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encargo_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encargo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Encargo_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Encargo_businessId_status_idx" ON "Encargo"("businessId", "status");
CREATE INDEX IF NOT EXISTS "Encargo_businessId_createdAt_idx" ON "Encargo"("businessId", "createdAt");
