-- Base local de prospeccao a partir dos Dados Abertos do CNPJ da Receita Federal.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TYPE "CnpjImportStatus" AS ENUM ('RUNNING', 'PUBLISHED', 'SUPERSEDED', 'FAILED');

CREATE TABLE "CnpjImportBatch" (
    "id" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "states" TEXT[] NOT NULL,
    "status" "CnpjImportStatus" NOT NULL DEFAULT 'RUNNING',
    "source" TEXT NOT NULL DEFAULT 'RECEITA_FEDERAL',
    "activeCandidatesCount" INTEGER NOT NULL DEFAULT 0,
    "companiesCount" INTEGER NOT NULL DEFAULT 0,
    "establishmentsCount" INTEGER NOT NULL DEFAULT 0,
    "meiExcludedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedMissingCompanyCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "CnpjImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CnpjCompany" (
    "cnpjBase" VARCHAR(8) NOT NULL,
    "batchId" TEXT NOT NULL,
    "corporateName" VARCHAR(255) NOT NULL,
    "legalNatureCode" VARCHAR(4),
    "responsibleQualificationCode" VARCHAR(2),
    "capitalSocial" DECIMAL(20,2),
    "companySizeCode" VARCHAR(2),
    "federalEntity" VARCHAR(100),
    CONSTRAINT "CnpjCompany_pkey" PRIMARY KEY ("cnpjBase", "batchId")
);

CREATE TABLE "CnaeReference" (
    "code" VARCHAR(7) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    CONSTRAINT "CnaeReference_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "MunicipalityReference" (
    "code" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    CONSTRAINT "MunicipalityReference_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "CnpjEstablishment" (
    "cnpj" VARCHAR(14) NOT NULL,
    "batchId" TEXT NOT NULL,
    "cnpjBase" VARCHAR(8) NOT NULL,
    "cnpjOrder" VARCHAR(4) NOT NULL,
    "cnpjDv" VARCHAR(2) NOT NULL,
    "establishmentType" VARCHAR(1),
    "fantasyName" VARCHAR(255),
    "registrationStatus" VARCHAR(2) NOT NULL,
    "registrationStatusDate" VARCHAR(8),
    "registrationReasonCode" VARCHAR(2),
    "foreignCityName" TEXT,
    "countryCode" TEXT,
    "activityStartDate" VARCHAR(8),
    "mainCnaeCode" VARCHAR(7) NOT NULL,
    "secondaryCnaeCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "streetType" TEXT,
    "streetName" TEXT,
    "streetNumber" TEXT,
    "addressComplement" TEXT,
    "neighborhood" TEXT,
    "postalCode" TEXT,
    "uf" VARCHAR(2) NOT NULL,
    "municipalityCode" TEXT NOT NULL,
    "ddd1" TEXT,
    "phone1" TEXT,
    "ddd2" TEXT,
    "phone2" TEXT,
    "faxDdd" TEXT,
    "faxNumber" TEXT,
    "email" TEXT,
    "specialStatus" TEXT,
    "specialStatusDate" VARCHAR(8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CnpjEstablishment_pkey" PRIMARY KEY ("cnpj", "batchId")
);

CREATE TABLE "CnpjGeoCache" (
    "cnpj" VARCHAR(14) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "addressFingerprint" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NOMINATIM',
    "geocodedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CnpjGeoCache_pkey" PRIMARY KEY ("cnpj")
);

CREATE INDEX "Supplier_document_idx" ON "Supplier"("document");
CREATE INDEX "CnpjImportBatch_status_finishedAt_idx" ON "CnpjImportBatch"("status", "finishedAt");
CREATE INDEX "CnpjImportBatch_competence_idx" ON "CnpjImportBatch"("competence");
CREATE INDEX "CnpjCompany_batchId_corporateName_idx" ON "CnpjCompany"("batchId", "corporateName");
CREATE INDEX "CnpjCompany_batchId_companySizeCode_idx" ON "CnpjCompany"("batchId", "companySizeCode");
CREATE INDEX "CnpjEstablishment_cnpj_idx" ON "CnpjEstablishment"("cnpj");
CREATE INDEX "CnpjEstablishment_batchId_uf_municipalityCode_idx" ON "CnpjEstablishment"("batchId", "uf", "municipalityCode");
CREATE INDEX "CnpjEstablishment_batchId_mainCnaeCode_idx" ON "CnpjEstablishment"("batchId", "mainCnaeCode");
CREATE INDEX "CnpjEstablishment_secondaryCnaeCodes_idx" ON "CnpjEstablishment" USING GIN ("secondaryCnaeCodes");
CREATE INDEX "CnpjEstablishment_batchId_fantasyName_idx" ON "CnpjEstablishment"("batchId", "fantasyName");
CREATE INDEX "CnpjEstablishment_batchId_cnpjBase_idx" ON "CnpjEstablishment"("batchId", "cnpjBase");
CREATE INDEX "CnpjGeoCache_geocodedAt_idx" ON "CnpjGeoCache"("geocodedAt");

ALTER TABLE "CnpjCompany" ADD CONSTRAINT "CnpjCompany_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "CnpjImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CnpjEstablishment" ADD CONSTRAINT "CnpjEstablishment_company_fkey"
  FOREIGN KEY ("cnpjBase", "batchId") REFERENCES "CnpjCompany"("cnpjBase", "batchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CnpjEstablishment" ADD CONSTRAINT "CnpjEstablishment_mainCnaeCode_fkey"
  FOREIGN KEY ("mainCnaeCode") REFERENCES "CnaeReference"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CnpjEstablishment" ADD CONSTRAINT "CnpjEstablishment_municipalityCode_fkey"
  FOREIGN KEY ("municipalityCode") REFERENCES "MunicipalityReference"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices trigram aceleram a busca parcial (ILIKE %termo%) nos nomes.
CREATE INDEX "CnpjEstablishment_fantasyName_trgm_idx"
  ON "CnpjEstablishment" USING GIN ("fantasyName" gin_trgm_ops);
CREATE INDEX "CnpjCompany_corporateName_trgm_idx"
  ON "CnpjCompany" USING GIN ("corporateName" gin_trgm_ops);
