-- Tipo de negocio al registrarse, delegación de órdenes a taller asociado
-- (la orden local queda como referencia y la espejo vive en el tenant
-- reparador) y verificación de contacto por código OTP.
CREATE TYPE "BusinessKind" AS ENUM ('FULL', 'REPAIR', 'PARTNER', 'PARTS');
ALTER TABLE "Business" ADD COLUMN "businessKind" "BusinessKind" NOT NULL DEFAULT 'FULL';

ALTER TABLE "RepairOrder" ADD COLUMN "delegatedToBusinessId" TEXT,
  ADD COLUMN "delegatedOrderId" TEXT,
  ADD COLUMN "delegatedAt" TIMESTAMP(3),
  ADD COLUMN "delegatedFromOrderId" TEXT;
CREATE INDEX "RepairOrder_delegatedFromOrderId_idx" ON "RepairOrder"("delegatedFromOrderId");
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_delegatedToBusinessId_fkey" FOREIGN KEY ("delegatedToBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "RepairOrder_delegatedToBusinessId_idx" ON "RepairOrder"("delegatedToBusinessId");

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

CREATE TYPE "VerificationChannel" AS ENUM ('EMAIL', 'PHONE', 'TELEGRAM');
CREATE TABLE "VerificationCode" (
  "id" TEXT NOT NULL,
  "businessId" TEXT,
  "userId" TEXT,
  "identifier" TEXT NOT NULL,
  "channel" "VerificationChannel" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'SIGNUP',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VerificationCode_identifier_purpose_idx" ON "VerificationCode"("identifier", "purpose");
CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
