import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { loadPfx } from "../services/fiscal/certificate";
import { encrypt } from "../services/fiscal/crypto";
import { FiscalError } from "../services/fiscal/errors";
import {
  fetchByAccessKey,
  manifestInvoice,
  syncCertificate
} from "../services/fiscal/sync";

const saveCertificateSchema = z.object({
  pfxBase64: z.string().min(1, "Selecione o arquivo do certificado."),
  password: z.string().min(1, "Informe a senha do certificado."),
  ufCode: z.number().int(),
  environment: z.union([z.literal(1), z.literal(2)]),
  autoCiencia: z.boolean().default(false),
  autoSync: z.boolean().default(true),
  cnpj: z.string().optional()
});

const updateCertificateSchema = z.object({
  autoCiencia: z.boolean().optional(),
  autoSync: z.boolean().optional()
});

const manifestSchema = z.object({
  kind: z.enum(["CIENCIA", "CONFIRMACAO"])
});

const fetchByKeySchema = z.object({
  accessKey: z.string().regex(/^\d{44}$/, "A chave deve ter 44 dígitos.")
});

function handleError(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof FiscalError) {
    return response.status(400).json({ message: error.message });
  }

  return next(error);
}

function serializeCertificate(record: any) {
  return {
    id: record.id,
    cnpj: record.cnpj,
    companyName: record.companyName,
    ufCode: record.ufCode,
    environment: record.environment,
    validFrom: record.validFrom,
    validTo: record.validTo,
    autoCiencia: record.autoCiencia,
    autoSync: record.autoSync,
    lastNsu: record.lastNsu,
    maxNsu: record.maxNsu,
    blockedUntil: record.blockedUntil,
    lastSyncAt: record.lastSyncAt,
    lastSyncStatus: record.lastSyncStatus,
    lastSyncMessage: record.lastSyncMessage
  };
}

function serializeInvoice(invoice: any) {
  return { ...invoice, totalValue: Number(invoice.totalValue) };
}

export async function getCertificate(
  _request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const record = await prisma.fiscalCertificate.findFirst();

    return response.json(record ? serializeCertificate(record) : null);
  } catch (error) {
    next(error);
  }
}

export async function saveCertificate(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = saveCertificateSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Dados inválidos."
      });
    }

    const input = parsed.data;
    const loaded = loadPfx(Buffer.from(input.pfxBase64, "base64"), input.password);

    if (loaded.validTo.getTime() < Date.now()) {
      throw new FiscalError("O certificado informado está vencido.");
    }

    const cnpj = loaded.cnpj ?? (input.cnpj ?? "").replace(/\D/g, "");

    if (!/^\d{14}$/.test(cnpj)) {
      throw new FiscalError(
        "Não foi possível identificar o CNPJ no certificado. Informe o CNPJ da empresa."
      );
    }

    if (input.cnpj && loaded.cnpj) {
      const typed = input.cnpj.replace(/\D/g, "");

      if (typed && typed.slice(0, 8) !== loaded.cnpj.slice(0, 8)) {
        throw new FiscalError("O CNPJ informado não corresponde ao do certificado.");
      }
    }

    const existing = await prisma.fiscalCertificate.findFirst();

    if (existing && existing.cnpj !== cnpj) {
      return response.status(409).json({
        message: "Já existe um certificado de outro CNPJ. Remova-o antes de enviar este."
      });
    }

    const data = {
      cnpj,
      companyName: loaded.subjectName || null,
      ufCode: input.ufCode,
      environment: input.environment,
      pfxEncrypted: encrypt(Buffer.from(input.pfxBase64, "base64")),
      passwordEncrypted: encrypt(input.password),
      validFrom: loaded.validFrom,
      validTo: loaded.validTo,
      autoCiencia: input.autoCiencia,
      autoSync: input.autoSync
    };

    const record = existing
      ? await prisma.fiscalCertificate.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...(existing.environment !== input.environment
              ? {
                  lastNsu: "000000000000000",
                  maxNsu: null,
                  blockedUntil: null
                }
              : {})
          }
        })
      : await prisma.fiscalCertificate.create({ data });

    return response.json(serializeCertificate(record));
  } catch (error) {
    handleError(error, response, next);
  }
}

export async function updateCertificate(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateCertificateSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({ message: "Dados inválidos." });
    }

    const existing = await prisma.fiscalCertificate.findFirst();

    if (!existing) {
      return response.status(404).json({ message: "Certificado não configurado." });
    }

    const record = await prisma.fiscalCertificate.update({
      where: { id: existing.id },
      data: parsed.data
    });

    return response.json(serializeCertificate(record));
  } catch (error) {
    next(error);
  }
}

export async function deleteCertificate(
  _request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const existing = await prisma.fiscalCertificate.findFirst();

    if (existing) {
      await prisma.fiscalCertificate.delete({ where: { id: existing.id } });
    }

    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function syncNow(
  _request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const existing = await prisma.fiscalCertificate.findFirst();

    if (!existing) {
      return response.status(404).json({ message: "Certificado não configurado." });
    }

    const result = await syncCertificate(existing.id);
    const record = await prisma.fiscalCertificate.findUnique({
      where: { id: existing.id }
    });

    return response.json({
      message: result.message,
      certificate: record ? serializeCertificate(record) : null
    });
  } catch (error) {
    handleError(error, response, next);
  }
}

export async function listInvoices(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const search = String(request.query.search ?? "").trim();
    const status = String(request.query.status ?? "all");
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 20) || 20));

    const where: Prisma.ReceivedInvoiceWhereInput = {};

    if (search) {
      const digits = search.replace(/\D/g, "");

      where.OR = [
        { issuerName: { contains: search, mode: "insensitive" } },
        { number: { contains: search } },
        ...(digits
          ? [
              { issuerCnpj: { contains: digits } },
              { accessKey: { contains: digits } }
            ]
          : [])
      ];
    }

    if (status === "withXml") where.hasFullXml = true;
    if (status === "summary") where.hasFullXml = false;
    if (status === "unlinked") where.supplierId = null;

    const [total, rows] = await Promise.all([
      prisma.receivedInvoice.count({ where }),
      prisma.receivedInvoice.findMany({
        where,
        orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          accessKey: true,
          issuerCnpj: true,
          issuerName: true,
          number: true,
          series: true,
          issuedAt: true,
          totalValue: true,
          hasFullXml: true,
          cancelled: true,
          manifestStatus: true,
          manifestMessage: true,
          supplierId: true,
          supplier: { select: { id: true, name: true } }
        }
      })
    ]);

    return response.json({
      data: rows.map(serializeInvoice),
      total,
      page,
      limit
    });
  } catch (error) {
    next(error);
  }
}

export async function getInvoiceXml(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: request.params.id },
      select: { accessKey: true, xmlContent: true, hasFullXml: true }
    });

    if (!invoice || !invoice.hasFullXml || !invoice.xmlContent) {
      return response.status(404).json({
        message: "O XML completo ainda não está disponível para esta nota."
      });
    }

    return response.json({
      fileName: `${invoice.accessKey}-nfe.xml`,
      xml: invoice.xmlContent
    });
  } catch (error) {
    next(error);
  }
}

export async function manifestInvoiceHandler(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = manifestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({ message: "Tipo de manifestação inválido." });
    }

    await manifestInvoice(request.params.id, parsed.data.kind);

    return response.json({ ok: true });
  } catch (error) {
    handleError(error, response, next);
  }
}

export async function fetchInvoiceXml(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const invoice = await prisma.receivedInvoice.findUnique({
      where: { id: request.params.id },
      select: { accessKey: true }
    });

    if (!invoice) {
      return response.status(404).json({ message: "Nota não encontrada." });
    }

    const result = await fetchByAccessKey(invoice.accessKey);

    return response.json(result);
  } catch (error) {
    handleError(error, response, next);
  }
}

export async function fetchByKey(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = fetchByKeySchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Chave inválida."
      });
    }

    const result = await fetchByAccessKey(parsed.data.accessKey);

    return response.json(result);
  } catch (error) {
    handleError(error, response, next);
  }
}