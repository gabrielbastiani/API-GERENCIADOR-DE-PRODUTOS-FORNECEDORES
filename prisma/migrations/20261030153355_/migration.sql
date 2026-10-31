-- RenameForeignKey
ALTER TABLE "CnpjEstablishment" RENAME CONSTRAINT "CnpjEstablishment_company_fkey" TO "CnpjEstablishment_cnpjBase_batchId_fkey";
