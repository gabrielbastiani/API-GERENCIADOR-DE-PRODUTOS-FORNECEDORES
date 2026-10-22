/*
  Warnings:

  - The values [AMAZON,MAGALU] on the enum `Marketplace` will be removed. If these variants are still used in the database, this will fail.
  - The values [APPROVED,UNVIABLE] on the enum `ProductStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `fileHash` on the `Catalog` table. All the data in the column will be lost.
  - You are about to drop the column `isCurrent` on the `Catalog` table. All the data in the column will be lost.
  - You are about to drop the column `publicUrl` on the `Catalog` table. All the data in the column will be lost.
  - You are about to drop the column `referenceDate` on the `Catalog` table. All the data in the column will be lost.
  - You are about to drop the column `uploadedAt` on the `Catalog` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `Catalog` table. All the data in the column will be lost.
  - You are about to drop the column `competitionLevel` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to drop the column `competitionNotes` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to drop the column `demandNotes` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to drop the column `marketplaceFeePercent` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to drop the column `researchedAt` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to drop the column `searchUrl` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to drop the column `taxes` on the `MarketplaceResearch` table. All the data in the column will be lost.
  - You are about to alter the column `estimatedDemand` on the `MarketplaceResearch` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `Integer`.
  - You are about to drop the column `acquisitionCost` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `catalogLink` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `catalogPage` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `extractionCandidateId` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `nextAction` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `normalizedName` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `specifications` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `supplierCode` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `active` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `commercialTerms` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `contactPerson` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `legalName` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `minimumOrderValue` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `paymentTerms` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `shippingTerms` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the `ExtractionCandidate` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `title` to the `Catalog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Catalog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Marketplace_new" AS ENUM ('MERCADO_LIVRE', 'SHOPEE', 'OTHER');
ALTER TABLE "MarketplaceResearch" ALTER COLUMN "marketplace" TYPE "Marketplace_new" USING ("marketplace"::text::"Marketplace_new");
ALTER TYPE "Marketplace" RENAME TO "Marketplace_old";
ALTER TYPE "Marketplace_new" RENAME TO "Marketplace";
DROP TYPE "Marketplace_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ProductStatus_new" AS ENUM ('NOT_ANALYZED', 'IN_VALIDATION', 'PROMISING', 'WAITING', 'DISCARDED');
ALTER TABLE "Product" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "status" TYPE "ProductStatus_new" USING ("status"::text::"ProductStatus_new");
ALTER TABLE "ProductStatusHistory" ALTER COLUMN "oldStatus" TYPE "ProductStatus_new" USING ("oldStatus"::text::"ProductStatus_new");
ALTER TABLE "ProductStatusHistory" ALTER COLUMN "newStatus" TYPE "ProductStatus_new" USING ("newStatus"::text::"ProductStatus_new");
ALTER TYPE "ProductStatus" RENAME TO "ProductStatus_old";
ALTER TYPE "ProductStatus_new" RENAME TO "ProductStatus";
DROP TYPE "ProductStatus_old";
ALTER TABLE "Product" ALTER COLUMN "status" SET DEFAULT 'NOT_ANALYZED';
COMMIT;

-- DropForeignKey
ALTER TABLE "ExtractionCandidate" DROP CONSTRAINT "ExtractionCandidate_catalogId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_catalogId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_extractionCandidateId_fkey";

-- DropIndex
DROP INDEX "Catalog_referenceDate_idx";

-- DropIndex
DROP INDEX "Product_extractionCandidateId_key";

-- DropIndex
DROP INDEX "Product_name_idx";

-- DropIndex
DROP INDEX "Product_supplierId_catalogId_supplierCode_key";

-- AlterTable
ALTER TABLE "Catalog" DROP COLUMN "fileHash",
DROP COLUMN "isCurrent",
DROP COLUMN "publicUrl",
DROP COLUMN "referenceDate",
DROP COLUMN "uploadedAt",
DROP COLUMN "version",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fileUrl" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "title" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "MarketplaceResearch" DROP COLUMN "competitionLevel",
DROP COLUMN "competitionNotes",
DROP COLUMN "demandNotes",
DROP COLUMN "marketplaceFeePercent",
DROP COLUMN "researchedAt",
DROP COLUMN "searchUrl",
DROP COLUMN "taxes",
ADD COLUMN     "competition" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "taxCost" DECIMAL(12,2),
ALTER COLUMN "estimatedDemand" SET DATA TYPE INTEGER,
ALTER COLUMN "salePrice" DROP NOT NULL,
ALTER COLUMN "marketplaceFee" DROP NOT NULL,
ALTER COLUMN "shippingCost" DROP NOT NULL,
ALTER COLUMN "shippingCost" DROP DEFAULT,
ALTER COLUMN "otherCosts" DROP NOT NULL,
ALTER COLUMN "otherCosts" DROP DEFAULT,
ALTER COLUMN "estimatedProfit" DROP NOT NULL,
ALTER COLUMN "estimatedMargin" DROP NOT NULL,
ALTER COLUMN "estimatedMargin" SET DATA TYPE DECIMAL(8,2);

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "acquisitionCost",
DROP COLUMN "catalogLink",
DROP COLUMN "catalogPage",
DROP COLUMN "extractionCandidateId",
DROP COLUMN "nextAction",
DROP COLUMN "normalizedName",
DROP COLUMN "specifications",
DROP COLUMN "supplierCode",
ADD COLUMN     "cost" DECIMAL(12,2),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "ean" TEXT,
ADD COLUMN     "referenceCode" TEXT,
ADD COLUMN     "sourcePage" INTEGER,
ALTER COLUMN "catalogId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "active",
DROP COLUMN "commercialTerms",
DROP COLUMN "contactPerson",
DROP COLUMN "legalName",
DROP COLUMN "minimumOrderValue",
DROP COLUMN "paymentTerms",
DROP COLUMN "shippingTerms",
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE "ExtractionCandidate";

-- DropEnum
DROP TYPE "ExtractionReviewStatus";

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE INDEX "Product_ean_idx" ON "Product"("ean");

-- CreateIndex
CREATE INDEX "Product_referenceCode_idx" ON "Product"("referenceCode");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
