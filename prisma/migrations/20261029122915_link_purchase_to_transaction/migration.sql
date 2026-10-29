-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "transactionId" TEXT;

-- CreateIndex
CREATE INDEX "Purchase_transactionId_idx" ON "Purchase"("transactionId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommercialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
