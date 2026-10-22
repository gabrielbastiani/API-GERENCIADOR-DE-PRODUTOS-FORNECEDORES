-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('NOT_ANALYZED', 'IN_VALIDATION', 'PROMISING', 'WAITING', 'APPROVED', 'UNVIABLE', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ExtractionReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'OTHER');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "contactPerson" TEXT,
    "commercialTerms" TEXT,
    "minimumOrderValue" DECIMAL(12,2),
    "paymentTerms" TEXT,
    "shippingTerms" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Catalog" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "fileHash" TEXT,
    "fileSize" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "referenceDate" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionCandidate" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "rawText" TEXT NOT NULL,
    "extractedName" TEXT,
    "extractedCode" TEXT,
    "extractedBrand" TEXT,
    "extractedModel" TEXT,
    "extractedPrice" DECIMAL(12,2),
    "specifications" JSONB,
    "confidence" DECIMAL(5,2),
    "reviewStatus" "ExtractionReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "extractionCandidateId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT,
    "supplierCode" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "specifications" JSONB,
    "acquisitionCost" DECIMAL(12,2) NOT NULL,
    "catalogPage" INTEGER,
    "catalogLink" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'NOT_ANALYZED',
    "justification" TEXT,
    "nextAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceResearch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "searchedTerm" TEXT NOT NULL,
    "searchUrl" TEXT,
    "estimatedDemand" DECIMAL(12,2),
    "demandNotes" TEXT,
    "competitionLevel" DECIMAL(5,2),
    "competitionNotes" TEXT,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "marketplaceFeePercent" DECIMAL(5,2) NOT NULL,
    "marketplaceFee" DECIMAL(12,2) NOT NULL,
    "shippingCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedProfit" DECIMAL(12,2) NOT NULL,
    "estimatedMargin" DECIMAL(5,2) NOT NULL,
    "notes" TEXT,
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductStatusHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldStatus" "ProductStatus",
    "newStatus" "ProductStatus" NOT NULL,
    "justification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Catalog_supplierId_idx" ON "Catalog"("supplierId");

-- CreateIndex
CREATE INDEX "Catalog_referenceDate_idx" ON "Catalog"("referenceDate");

-- CreateIndex
CREATE INDEX "ExtractionCandidate_catalogId_idx" ON "ExtractionCandidate"("catalogId");

-- CreateIndex
CREATE INDEX "ExtractionCandidate_reviewStatus_idx" ON "ExtractionCandidate"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Product_extractionCandidateId_key" ON "Product"("extractionCandidateId");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");

-- CreateIndex
CREATE INDEX "Product_catalogId_idx" ON "Product"("catalogId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierId_catalogId_supplierCode_key" ON "Product"("supplierId", "catalogId", "supplierCode");

-- CreateIndex
CREATE INDEX "MarketplaceResearch_productId_idx" ON "MarketplaceResearch"("productId");

-- CreateIndex
CREATE INDEX "MarketplaceResearch_marketplace_idx" ON "MarketplaceResearch"("marketplace");

-- CreateIndex
CREATE INDEX "ProductStatusHistory_productId_idx" ON "ProductStatusHistory"("productId");

-- AddForeignKey
ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionCandidate" ADD CONSTRAINT "ExtractionCandidate_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_extractionCandidateId_fkey" FOREIGN KEY ("extractionCandidateId") REFERENCES "ExtractionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceResearch" ADD CONSTRAINT "MarketplaceResearch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStatusHistory" ADD CONSTRAINT "ProductStatusHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
