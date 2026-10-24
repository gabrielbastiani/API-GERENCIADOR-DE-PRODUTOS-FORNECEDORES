-- CreateEnum
CREATE TYPE "QuoteListStatus" AS ENUM ('DRAFT', 'SENT', 'ARCHIVED');

-- CreateTable
CREATE TABLE "QuoteList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "status" "QuoteListStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteListItem" (
    "id" TEXT NOT NULL,
    "quoteListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "referenceCode" TEXT,
    "productReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteList_supplierId_idx" ON "QuoteList"("supplierId");

-- CreateIndex
CREATE INDEX "QuoteList_status_idx" ON "QuoteList"("status");

-- CreateIndex
CREATE INDEX "QuoteList_createdAt_idx" ON "QuoteList"("createdAt");

-- CreateIndex
CREATE INDEX "QuoteListItem_quoteListId_idx" ON "QuoteListItem"("quoteListId");

-- CreateIndex
CREATE INDEX "QuoteListItem_productId_idx" ON "QuoteListItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteListItem_quoteListId_productId_key" ON "QuoteListItem"("quoteListId", "productId");

-- AddForeignKey
ALTER TABLE "QuoteList" ADD CONSTRAINT "QuoteList_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteListItem" ADD CONSTRAINT "QuoteListItem_quoteListId_fkey" FOREIGN KEY ("quoteListId") REFERENCES "QuoteList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteListItem" ADD CONSTRAINT "QuoteListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
