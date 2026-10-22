-- CreateEnum
CREATE TYPE "CommercialTransactionStatus" AS ENUM ('DRAFT', 'QUOTE_RECEIVED', 'UNDER_ANALYSIS', 'APPROVED', 'ORDER_EFFECTIVE', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierDocumentType" AS ENUM ('QUOTE', 'PURCHASE_ORDER', 'INVOICE', 'OTHER');

-- CreateTable
CREATE TABLE "CommercialTransaction" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteReference" TEXT,
    "orderReference" TEXT,
    "quoteDate" TIMESTAMP(3),
    "orderEffectiveDate" TIMESTAMP(3),
    "status" "CommercialTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierDocument" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "transactionId" TEXT,
    "type" "SupplierDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "documentNumber" TEXT,
    "originalName" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "documentDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialTransactionStatusHistory" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "oldStatus" "CommercialTransactionStatus",
    "newStatus" "CommercialTransactionStatus" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialTransactionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialTransaction_supplierId_idx" ON "CommercialTransaction"("supplierId");

-- CreateIndex
CREATE INDEX "CommercialTransaction_status_idx" ON "CommercialTransaction"("status");

-- CreateIndex
CREATE INDEX "CommercialTransaction_quoteDate_idx" ON "CommercialTransaction"("quoteDate");

-- CreateIndex
CREATE INDEX "CommercialTransaction_orderEffectiveDate_idx" ON "CommercialTransaction"("orderEffectiveDate");

-- CreateIndex
CREATE INDEX "SupplierDocument_supplierId_idx" ON "SupplierDocument"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierDocument_transactionId_idx" ON "SupplierDocument"("transactionId");

-- CreateIndex
CREATE INDEX "SupplierDocument_type_idx" ON "SupplierDocument"("type");

-- CreateIndex
CREATE INDEX "SupplierDocument_documentNumber_idx" ON "SupplierDocument"("documentNumber");

-- CreateIndex
CREATE INDEX "CommercialTransactionStatusHistory_transactionId_idx" ON "CommercialTransactionStatusHistory"("transactionId");

-- AddForeignKey
ALTER TABLE "CommercialTransaction" ADD CONSTRAINT "CommercialTransaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDocument" ADD CONSTRAINT "SupplierDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDocument" ADD CONSTRAINT "SupplierDocument_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommercialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTransactionStatusHistory" ADD CONSTRAINT "CommercialTransactionStatusHistory_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommercialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
