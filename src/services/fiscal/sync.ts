import type { FiscalCertificate } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { loadPfx, type LoadedCertificate } from "./certificate";
import { decrypt } from "./crypto";
import { parseDocument } from "./document-parser";
import { FiscalError } from "./errors";
import {
  distributionQuery,
  sendManifestation,
  type DistDoc,
  type ManifestKind
} from "./sefaz-client";

const BLOCK_MINUTES = 61;
const MAX_ROUNDS_PER_RUN = 30;
const running = new Set<string>();

function onlyDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function loadCertificateRecord(record: FiscalCertificate): LoadedCertificate {
  const loaded = loadPfx(
    decrypt(record.pfxEncrypted),
    decrypt(record.passwordEncrypted).toString("utf8")
  );

  if (loaded.validTo.getTime() < Date.now()) {
    throw new FiscalError("O certificado digital está vencido.");
  }

  return loaded;
}

async function buildSupplierMap() {
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, document: true }
  });
  const map = new Map<string, string>();

  for (const supplier of suppliers) {
    const digits = onlyDigits(supplier.document);

    if (digits) {
      map.set(digits, supplier.id);
    }
  }

  return map;
}

async function storeDocument(
  certificateId: string,
  doc: DistDoc,
  supplierMap: Map<string, string>
) {
  const parsed = parseDocument(doc.xml);

  if (parsed.kind === "ignore") {
    return;
  }

  if (parsed.kind === "cancellation") {
    await prisma.receivedInvoice.updateMany({
      where: { accessKey: parsed.accessKey },
      data: { cancelled: true }
    });
    return;
  }

  const existing = await prisma.receivedInvoice.findUnique({
    where: { accessKey: parsed.accessKey },
    select: { id: true, hasFullXml: true }
  });

  if (parsed.kind === "summary" && existing) {
    if (parsed.cancelled) {
      await prisma.receivedInvoice.update({
        where: { id: existing.id },
        data: { cancelled: true }
      });
    }
    return;
  }

  const data = {
    nsu: doc.nsu,
    issuerCnpj: onlyDigits(parsed.issuerCnpj),
    issuerName: parsed.issuerName,
    number: parsed.number,
    series: parsed.series,
    issuedAt: parsed.issuedAt,
    totalValue: parsed.totalValue,
    cancelled: parsed.cancelled,
    hasFullXml: parsed.kind === "invoice",
    xmlContent: parsed.kind === "invoice" ? doc.xml : null,
    supplierId: supplierMap.get(onlyDigits(parsed.issuerCnpj)) ?? null
  };

  if (existing) {
    await prisma.receivedInvoice.update({
      where: { id: existing.id },
      data
    });
    return;
  }

  await prisma.receivedInvoice.create({
    data: { ...data, accessKey: parsed.accessKey, certificateId }
  });
}

async function relinkSuppliers(supplierMap: Map<string, string>) {
  const orphans = await prisma.receivedInvoice.findMany({
    where: { supplierId: null },
    select: { id: true, issuerCnpj: true }
  });

  for (const orphan of orphans) {
    const supplierId = supplierMap.get(orphan.issuerCnpj);

    if (supplierId) {
      await prisma.receivedInvoice.update({
        where: { id: orphan.id },
        data: { supplierId }
      });
    }
  }
}

export async function syncCertificate(certificateId: string) {
  if (running.has(certificateId)) {
    return { skipped: true, message: "Sincronização já em andamento." };
  }

  const record = await prisma.fiscalCertificate.findUnique({
    where: { id: certificateId }
  });

  if (!record) {
    throw new FiscalError("Certificado não configurado.");
  }

  if (record.blockedUntil && record.blockedUntil.getTime() > Date.now()) {
    return {
      skipped: true,
      message: `A SEFAZ só permite nova consulta após ${record.blockedUntil.toLocaleString("pt-BR")}.`
    };
  }

  running.add(certificateId);

  let ultNsu = record.lastNsu;
  let maxNsu = record.maxNsu;
  let stored = 0;
  let blockedUntil: Date | null = null;
  let message = "";

  try {
    const certificate = loadCertificateRecord(record);
    const supplierMap = await buildSupplierMap();

    for (let round = 0; round < MAX_ROUNDS_PER_RUN; round += 1) {
      const result = await distributionQuery(certificate, {
        cnpj: record.cnpj,
        ufCode: record.ufCode,
        environment: record.environment,
        ultNSU: ultNsu
      });

      if (result.cStat === "656") {
        // Consumo indevido: a SEFAZ devolve o último NSU correto e bloqueia por ~1h
        if (result.ultNSU) {
          ultNsu = result.ultNSU;
        }
        blockedUntil = new Date(Date.now() + BLOCK_MINUTES * 60_000);
        message = result.xMotivo;
        break;
      }

      if (result.cStat !== "137" && result.cStat !== "138") {
        throw new FiscalError(`SEFAZ ${result.cStat}: ${result.xMotivo}`);
      }

      for (const doc of result.docs) {
        await storeDocument(record.id, doc, supplierMap);
        stored += 1;
      }

      ultNsu = result.ultNSU || ultNsu;
      maxNsu = result.maxNSU || maxNsu;

      await prisma.fiscalCertificate.update({
        where: { id: record.id },
        data: { lastNsu: ultNsu, maxNsu }
      });

      if (result.cStat === "137" || ultNsu === maxNsu) {
        blockedUntil = new Date(Date.now() + BLOCK_MINUTES * 60_000);
        message = "Sincronizado. Nenhuma nota pendente no momento.";
        break;
      }
    }

    await relinkSuppliers(supplierMap);

    if (record.autoCiencia) {
      const pending = await prisma.receivedInvoice.findMany({
        where: {
          certificateId: record.id,
          hasFullXml: false,
          cancelled: false,
          manifestStatus: "NONE"
        },
        select: { id: true },
        take: 50
      });

      for (const invoice of pending) {
        try {
          await manifestInvoice(invoice.id, "CIENCIA");
        } catch (error) {
          console.error("[fiscal] Falha na ciência automática:", error);
        }
      }
    }

    await prisma.fiscalCertificate.update({
      where: { id: record.id },
      data: {
        lastNsu: ultNsu,
        maxNsu,
        blockedUntil,
        lastSyncAt: new Date(),
        lastSyncStatus: "OK",
        lastSyncMessage: message || `${stored} documento(s) processado(s).`
      }
    });

    return { skipped: false, message: `${stored} documento(s) processado(s).` };
  } catch (error) {
    const text = error instanceof Error ? error.message : "Erro desconhecido.";

    await prisma.fiscalCertificate.update({
      where: { id: record.id },
      data: {
        lastNsu: ultNsu,
        blockedUntil,
        lastSyncAt: new Date(),
        lastSyncStatus: "ERROR",
        lastSyncMessage: text
      }
    });

    throw error;
  } finally {
    running.delete(certificateId);
  }
}

export async function manifestInvoice(invoiceId: string, kind: ManifestKind) {
  const invoice = await prisma.receivedInvoice.findUnique({
    where: { id: invoiceId },
    include: { certificate: true }
  });

  if (!invoice) {
    throw new FiscalError("Nota não encontrada.");
  }

  if (invoice.cancelled) {
    throw new FiscalError("Nota cancelada não aceita manifestação.");
  }

  if (invoice.manifestStatus === "CONFIRMADA" && kind === "CIENCIA") {
    throw new FiscalError("A operação já foi confirmada.");
  }

  const certificate = loadCertificateRecord(invoice.certificate);

  const result = await sendManifestation(certificate, {
    cnpj: invoice.certificate.cnpj,
    environment: invoice.certificate.environment,
    accessKey: invoice.accessKey,
    kind
  });

  await prisma.receivedInvoice.update({
    where: { id: invoice.id },
    data: {
      manifestStatus: result.ok
        ? kind === "CONFIRMACAO"
          ? "CONFIRMADA"
          : "CIENCIA"
        : "ERRO",
      manifestMessage: `${result.cStat} - ${result.message}`
    }
  });

  if (!result.ok) {
    throw new FiscalError(`SEFAZ ${result.cStat}: ${result.message}`);
  }
}

export async function fetchByAccessKey(accessKey: string) {
  if (!/^\d{44}$/.test(accessKey)) {
    throw new FiscalError("A chave de acesso deve ter 44 dígitos.");
  }

  const record = await prisma.fiscalCertificate.findFirst();

  if (!record) {
    throw new FiscalError("Certificado não configurado.");
  }

  const certificate = loadCertificateRecord(record);

  const result = await distributionQuery(certificate, {
    cnpj: record.cnpj,
    ufCode: record.ufCode,
    environment: record.environment,
    accessKey
  });

  if (result.cStat !== "138") {
    throw new FiscalError(`SEFAZ ${result.cStat}: ${result.xMotivo}`);
  }

  const supplierMap = await buildSupplierMap();

  for (const doc of result.docs) {
    await storeDocument(record.id, doc, supplierMap);
  }

  const invoice = await prisma.receivedInvoice.findUnique({
    where: { accessKey },
    select: { id: true, hasFullXml: true }
  });

  if (!invoice) {
    throw new FiscalError("A SEFAZ não retornou um documento utilizável para essa chave.");
  }

  return invoice;
}

let schedulerStarted = false;

export function startFiscalScheduler() {
  if (schedulerStarted || process.env.FISCAL_SYNC_ENABLED === "false") {
    return;
  }

  schedulerStarted = true;

  async function tick() {
    try {
      const certificates = await prisma.fiscalCertificate.findMany({
        where: { autoSync: true }
      });

      for (const certificate of certificates) {
        try {
          await syncCertificate(certificate.id);
        } catch (error) {
          console.error("[fiscal] Falha na sincronização:", error);
        }
      }
    } catch (error) {
      console.error("[fiscal] Falha no agendador:", error);
    }
  }

  setTimeout(tick, 30_000);
  setInterval(tick, 10 * 60_000);
}