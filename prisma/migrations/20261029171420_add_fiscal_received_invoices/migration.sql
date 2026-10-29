-- CreateTable
CREATE TABLE "FiscalCertificate" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "companyName" TEXT,
    "ufCode" INTEGER NOT NULL,
    "environment" INTEGER NOT NULL DEFAULT 1,
    "pfxEncrypted" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "autoCiencia" BOOLEAN NOT NULL DEFAULT false,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "lastNsu" TEXT NOT NULL DEFAULT '000000000000000',
    "maxNsu" TEXT,
    "blockedUntil" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivedInvoice" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "issuerCnpj" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "number" TEXT,
    "series" TEXT,
    "issuedAt" TIMESTAMP(3),
    "totalValue" DECIMAL(14,2) NOT NULL,
    "hasFullXml" BOOLEAN NOT NULL DEFAULT false,
    "xmlContent" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "manifestStatus" TEXT NOT NULL DEFAULT 'NONE',
    "manifestMessage" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalCertificate_cnpj_key" ON "FiscalCertificate"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedInvoice_accessKey_key" ON "ReceivedInvoice"("accessKey");

-- CreateIndex
CREATE INDEX "ReceivedInvoice_issuerCnpj_idx" ON "ReceivedInvoice"("issuerCnpj");

-- CreateIndex
CREATE INDEX "ReceivedInvoice_supplierId_idx" ON "ReceivedInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "ReceivedInvoice_issuedAt_idx" ON "ReceivedInvoice"("issuedAt");

-- AddForeignKey
ALTER TABLE "ReceivedInvoice" ADD CONSTRAINT "ReceivedInvoice_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "FiscalCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedInvoice" ADD CONSTRAINT "ReceivedInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
