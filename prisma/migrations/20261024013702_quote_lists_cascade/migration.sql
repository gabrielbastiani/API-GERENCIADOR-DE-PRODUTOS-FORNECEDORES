-- DropForeignKey
ALTER TABLE "QuoteList" DROP CONSTRAINT "QuoteList_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "QuoteListItem" DROP CONSTRAINT "QuoteListItem_productId_fkey";

-- AddForeignKey
ALTER TABLE "QuoteList" ADD CONSTRAINT "QuoteList_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteListItem" ADD CONSTRAINT "QuoteListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
