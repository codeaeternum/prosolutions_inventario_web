-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('RECEIVED', 'DIAGNOSIS', 'WAITING_APPROVAL', 'WAITING_PARTS', 'IN_REPAIR', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkshopBranch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RepairStatus" NOT NULL DEFAULT 'RECEIVED',
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "equipmentType" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "accessories" TEXT,
    "intakeCondition" TEXT,
    "reportedIssue" TEXT NOT NULL,
    "diagnosis" TEXT,
    "quoteCents" INTEGER,
    "approvedQuoteCents" INTEGER,
    "quoteApprovedAt" TIMESTAMP(3),
    "qualityCheck" TEXT,
    "deliveredTo" TEXT,
    "promisedAt" TIMESTAMP(3),
    "intakeBranchId" TEXT NOT NULL,
    "currentBranchId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopBranch_name_key" ON "WorkshopBranch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_number_key" ON "RepairOrder"("number");

-- CreateIndex
CREATE INDEX "RepairOrder_currentBranchId_status_createdAt_idx" ON "RepairOrder"("currentBranchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RepairOrder_assignedToId_status_idx" ON "RepairOrder"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "RepairOrder_customerPhone_idx" ON "RepairOrder"("customerPhone");

-- CreateIndex
CREATE INDEX "RepairEvent_orderId_createdAt_idx" ON "RepairEvent"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_intakeBranchId_fkey" FOREIGN KEY ("intakeBranchId") REFERENCES "WorkshopBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_currentBranchId_fkey" FOREIGN KEY ("currentBranchId") REFERENCES "WorkshopBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairOrder" ADD CONSTRAINT "RepairOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RepairOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

