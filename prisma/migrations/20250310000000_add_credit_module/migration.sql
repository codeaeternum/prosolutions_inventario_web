-- AlterTable: User - add credit fields
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creditLimit" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creditBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateEnum: CreditMovementType
DO $$ BEGIN
    CREATE TYPE "CreditMovementType" AS ENUM ('DEBT', 'PAYMENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: CreditReferenceType
DO $$ BEGIN
    CREATE TYPE "CreditReferenceType" AS ENUM ('RESERVATION', 'SALE', 'MANUAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: CreditMovement
CREATE TABLE IF NOT EXISTS "CreditMovement" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "CreditMovementType" NOT NULL,
    "referenceType" "CreditReferenceType",
    "referenceId" TEXT,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CreditMovement_userId_idx" ON "CreditMovement"("userId");
CREATE INDEX IF NOT EXISTS "CreditMovement_createdAt_idx" ON "CreditMovement"("createdAt");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CreditMovement_userId_fkey'
    ) THEN
        ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
