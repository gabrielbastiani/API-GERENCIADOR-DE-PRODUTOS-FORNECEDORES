-- CreateTable
CREATE TABLE "CommercialTransactionItem" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialTransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialTransactionItem_transactionId_idx" ON "CommercialTransactionItem"("transactionId");

-- AddForeignKey
ALTER TABLE "CommercialTransactionItem" ADD CONSTRAINT "CommercialTransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommercialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTransactionItem" ADD CONSTRAINT "CommercialTransactionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
