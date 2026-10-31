import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { deleteUnusedPurchaseImages } from "../utils/purchase-images";
import { prisma } from "../lib/prisma";
import { serializePurchase } from "../utils/purchase-calc";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const purchaseInclude = Prisma.validator<Prisma.PurchaseInclude>()({
  supplier: {
    select: {
      id: true,
      name: true
    }
  },
  transaction: {
    select: {
      id: true,
      quoteReference: true,
      orderReference: true,
      status: true
    }
  },
  items: {
    orderBy: {
      position: "asc"
    },
    include: {
      product: {
        select: {
          images: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { fileUrl: true }
          }
        }
      }
    }
  }
});

const nullableText = z.string().trim().nullable().optional();

const itemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Informe o nome de todos os produtos."),
  code: nullableText,
  quantity: z.number().positive("A quantidade deve ser maior que zero."),
  unitPrice: z.number().min(0, "O valor unitário não pode ser negativo."),
  imageUrl: nullableText
});

const purchaseSchema = z.object({
  supplierId: z.string().uuid("Fornecedor inválido."),
  invoiceNumber: nullableText,
  invoiceKey: nullableText,
  purchaseDate: nullableText,
  freightTotal: z.number().min(0, "O frete não pode ser negativo.").default(0),
  notes: nullableText,
  source: z.enum(["MANUAL", "XML"]).default("MANUAL"),
  items: z.array(itemSchema).min(1, "Informe ao menos um produto."),
    transactionId: z.string().min(1).nullable().optional(),
});

function emptyToNull(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function parseDate(value: string | null | undefined) {
  const text = emptyToNull(value);

  if (!text) {
    return null;
  }

  const date = new Date(
    text.length === 10 ? `${text}T12:00:00.000Z` : text
  );

  if (Number.isNaN(date.getTime())) {
    throw new Error("Data da compra inválida.");
  }

  return date;
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeTaxIdentifier(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function validateProducts(
  supplierId: string,
  productIds: string[]
) {
  const ids = Array.from(new Set(productIds));

  if (ids.length === 0) {
    return true;
  }

  const count = await prisma.product.count({
    where: {
      id: { in: ids },
      supplierId
    }
  });

  return count === ids.length;
}

async function validateTransaction(
  supplierId: string,
  transactionId: string | null | undefined
) {
  if (!transactionId) {
    return true;
  }

  const count = await prisma.commercialTransaction.count({
    where: { id: transactionId, supplierId }
  });

  return count === 1;
}

function buildItems(items: z.infer<typeof itemSchema>[]) {
  return items.map((item, index) => ({
    productId: item.productId ?? null,
    position: index,
    name: item.name,
    code: emptyToNull(item.code),
    quantity: new Prisma.Decimal(item.quantity),
    unitPrice: new Prisma.Decimal(item.unitPrice),
    imageUrl: emptyToNull(item.imageUrl)
  }));
}

/* ------------------------------------------------------------------ */

export async function listPurchases(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
        const { supplierId, search, transactionId } = request.query;

    const where: Prisma.PurchaseWhereInput = {};

    if (typeof supplierId === "string" && supplierId.trim() !== "") {
      where.supplierId = supplierId;
    }

        if (typeof transactionId === "string" && transactionId.trim() !== "") {
      where.transactionId = transactionId;
    }

    if (typeof search === "string" && search.trim() !== "") {
      where.invoiceNumber = {
        contains: search.trim(),
        mode: "insensitive"
      };
    }

    const purchases = await prisma.purchase.findMany({
      where,
      include: purchaseInclude,
      orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }]
    });

    return response.json(purchases.map(serializePurchase));
  } catch (error) {
    next(error);
  }
}

export async function getPurchase(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: request.params.id },
      include: purchaseInclude
    });

    if (!purchase) {
      return response.status(404).json({
        message: "Compra não encontrada."
      });
    }

    return response.json(serializePurchase(purchase));
  } catch (error) {
    next(error);
  }
}

export async function createPurchase(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = purchaseSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Dados da compra inválidos."
      });
    }

    const data = parsed.data;

    const supplier = await prisma.supplier.findUnique({
      where: { id: data.supplierId },
      select: { id: true }
    });

    if (!supplier) {
      return response.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    const productIds = data.items
      .map((item) => item.productId)
      .filter((id): id is string => !!id);

    if (!(await validateProducts(data.supplierId, productIds))) {
      return response.status(400).json({
        message: "Há produtos que não pertencem ao fornecedor selecionado."
      });
    }

        if (!(await validateTransaction(data.supplierId, data.transactionId))) {
      return response.status(400).json({
        message: "O pedido/orçamento selecionado não pertence ao fornecedor."
      });
    }

    const invoiceKey = emptyToNull(data.invoiceKey);

    if (invoiceKey) {
      const duplicated = await prisma.purchase.findUnique({
        where: { invoiceKey },
        select: { id: true }
      });

      if (duplicated) {
        return response.status(409).json({
          message: "Esta nota fiscal já foi cadastrada."
        });
      }
    }

    const purchase = await prisma.purchase.create({
      data: {
        supplierId: data.supplierId,
        invoiceNumber: emptyToNull(data.invoiceNumber),
        invoiceKey,
                transactionId: data.transactionId ?? null,
        purchaseDate: parseDate(data.purchaseDate),
        freightTotal: new Prisma.Decimal(data.freightTotal),
        notes: emptyToNull(data.notes),
        source: data.source,
        items: {
          create: buildItems(data.items)
        }
      },
      include: purchaseInclude
    });

    return response.status(201).json(serializePurchase(purchase));
  } catch (error) {
    next(error);
  }
}

export async function updatePurchase(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = purchaseSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Dados da compra inválidos."
      });
    }

    const data = parsed.data;

    const current = await prisma.purchase.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        items: { select: { imageUrl: true } }
      }
    });

    if (!current) {
      return response.status(404).json({
        message: "Compra não encontrada."
      });
    }

    const productIds = data.items
      .map((item) => item.productId)
      .filter((id): id is string => !!id);

    if (!(await validateProducts(data.supplierId, productIds))) {
      return response.status(400).json({
        message: "Há produtos que não pertencem ao fornecedor selecionado."
      });
    }

        if (!(await validateTransaction(data.supplierId, data.transactionId))) {
      return response.status(400).json({
        message: "O pedido/orçamento selecionado não pertence ao fornecedor."
      });
    }

    const invoiceKey = emptyToNull(data.invoiceKey);

    if (invoiceKey) {
      const duplicated = await prisma.purchase.findFirst({
        where: {
          invoiceKey,
          id: { not: current.id }
        },
        select: { id: true }
      });

      if (duplicated) {
        return response.status(409).json({
          message: "Esta nota fiscal já foi cadastrada."
        });
      }
    }

    const purchase = await prisma.purchase.update({
      where: { id: current.id },
      data: {
        supplierId: data.supplierId,
        invoiceNumber: emptyToNull(data.invoiceNumber),
        invoiceKey,
                transactionId: data.transactionId ?? null,
        purchaseDate: parseDate(data.purchaseDate),
        freightTotal: new Prisma.Decimal(data.freightTotal),
        notes: emptyToNull(data.notes),
        source: data.source,
        items: {
          deleteMany: {},
          create: buildItems(data.items)
        }
      },
      include: purchaseInclude
    });

    await deleteUnusedPurchaseImages(
      current.items.map((item) => item.imageUrl)
    ).catch(() => undefined);

    return response.json(serializePurchase(purchase));
  } catch (error) {
    next(error);
  }
}

export async function deletePurchase(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const current = await prisma.purchase.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        items: { select: { imageUrl: true } }
      }
    });

    if (!current) {
      return response.status(404).json({
        message: "Compra não encontrada."
      });
    }

    await prisma.purchase.delete({ where: { id: current.id } });

    await deleteUnusedPurchaseImages(
      current.items.map((item) => item.imageUrl)
    ).catch(() => undefined);

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}

/* ------------------------------------------------------------------ */
/* Leitura do XML da NF-e (apenas prévia, nada é salvo)                */
/* ------------------------------------------------------------------ */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "det"
});

class XmlImportError extends Error {}

async function buildXmlPreview(xmlText: string, forcedSupplierId?: string) {
  let parsed: any;

  try {
    parsed = xmlParser.parse(xmlText);
  } catch {
    throw new XmlImportError("Não foi possível ler o arquivo XML.");
  }

  const root = parsed?.nfeProc?.NFe ?? parsed?.NFe;
  const inf = root?.infNFe;

  if (!inf || !inf.det) {
    throw new XmlImportError(
      "O arquivo não parece ser o XML de uma NF-e (infNFe não encontrado)."
    );
  }

  const invoiceKey =
    onlyDigits(inf["@_Id"]) ||
    onlyDigits(parsed?.nfeProc?.protNFe?.infProt?.chNFe);

  const emissionDate = String(inf.ide?.dhEmi ?? inf.ide?.dEmi ?? "").slice(
    0,
    10
  );

  const issuerDocument = normalizeTaxIdentifier(inf.emit?.CNPJ ?? inf.emit?.CPF);
  const issuerName = String(inf.emit?.xNome ?? "");
  const freightTotal = toNumber(inf.total?.ICMSTot?.vFrete);

  let supplierId: string | null = forcedSupplierId ?? null;

  if (!supplierId && issuerDocument) {
    const suppliers = await prisma.supplier.findMany({
      where: { document: { not: null } },
      select: { id: true, document: true }
    });

    supplierId =
      suppliers.find(
        (supplier) => normalizeTaxIdentifier(supplier.document) === issuerDocument
      )?.id ?? null;
  }

  const rawItems = (inf.det as any[]).map((det) => {
    const prod = det.prod ?? {};
    const quantity = toNumber(prod.qCom);
    const gross = toNumber(prod.vProd);
    const discount = toNumber(prod.vDesc);

    const unitPrice =
      quantity > 0
        ? Math.round(((gross - discount) / quantity) * 1000000) / 1000000
        : toNumber(prod.vUnCom);

    const ean = onlyDigits(prod.cEAN);

    return {
      code: String(prod.cProd ?? "").trim(),
      ean: ean.length >= 8 ? ean : "",
      name: String(prod.xProd ?? "").trim(),
      quantity,
      unitPrice
    };
  });

  const productsByCode = new Map<string, any>();
  const productsByEan = new Map<string, any>();

  if (supplierId) {
    const products = await prisma.product.findMany({
      where: { supplierId },
      select: {
        id: true,
        referenceCode: true,
        ean: true,
        images: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: { fileUrl: true }
        }
      }
    });

    for (const product of products) {
      if (product.referenceCode) {
        productsByCode.set(product.referenceCode.trim(), product);
      }

      if (product.ean) {
        productsByEan.set(onlyDigits(product.ean), product);
      }
    }
  }

  const items = rawItems.map((item) => {
    const product =
      (item.code && productsByCode.get(item.code)) ||
      (item.ean && productsByEan.get(item.ean)) ||
      null;

    return {
      productId: product?.id ?? null,
      name: item.name,
      code: item.code,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      imageUrl: product?.images[0]?.fileUrl ?? null
    };
  });

  const alreadyImported = invoiceKey
    ? await prisma.purchase.findUnique({
        where: { invoiceKey },
        select: { id: true }
      })
    : null;

  return {
    invoiceNumber: String(inf.ide?.nNF ?? ""),
    invoiceKey,
    purchaseDate: emissionDate,
    freightTotal,
    issuer: {
      name: issuerName,
      document: issuerDocument
    },
    supplierId,
    alreadyImportedPurchaseId: alreadyImported?.id ?? null,
    items
  };
}

export async function parsePurchaseXml(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    if (!request.file) {
      return response.status(400).json({
        message: "Envie um arquivo XML válido no campo \"file\"."
      });
    }

    const preview = await buildXmlPreview(
      request.file.buffer.toString("utf-8")
    );

    return response.json(preview);
  } catch (error) {
    if (error instanceof XmlImportError) {
      return response.status(400).json({ message: error.message });
    }

    next(error);
  }
}

/**
 * Lê o XML que já está anexado a um pedido/orçamento (documento do
 * fornecedor) e devolve a mesma prévia do upload. Nada é salvo.
 */
export async function parsePurchaseDocumentXml(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const document = await prisma.supplierDocument.findUnique({
      where: { id: request.params.documentId },
      select: {
        id: true,
        supplierId: true,
        transactionId: true,
        originalName: true,
        filePath: true,
        mimeType: true
      }
    });

    if (!document) {
      return response.status(404).json({
        message: "Documento não encontrado."
      });
    }

    const isXml =
      document.originalName.toLowerCase().endsWith(".xml") ||
      (document.mimeType ?? "").includes("xml");

    if (!isXml) {
      return response.status(400).json({
        message: "O documento selecionado não é um arquivo XML."
      });
    }

    let content: string;

    try {
      content = await fs.readFile(path.resolve(document.filePath), "utf-8");
    } catch {
      return response.status(404).json({
        message:
          "O arquivo XML não foi encontrado no servidor. Anexe-o novamente ou use o botão de selecionar XML."
      });
    }

    const preview = await buildXmlPreview(content, document.supplierId);

    return response.json({
      ...preview,
      transactionId: document.transactionId
    });
  } catch (error) {
    if (error instanceof XmlImportError) {
      return response.status(400).json({ message: error.message });
    }

    next(error);
  }
}

/**
 * Opções para vincular uma compra a um orçamento/pedido do fornecedor,
 * já com os XMLs anexados a cada um.
 */
export async function listLinkOptions(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const supplierId = String(request.query.supplierId ?? "");

    if (!supplierId) {
      return response.json([]);
    }

    const transactions = await prisma.commercialTransaction.findMany({
      where: { supplierId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        quoteReference: true,
        orderReference: true,
        quoteDate: true,
        orderEffectiveDate: true,
        status: true,
        documents: {
          select: {
            id: true,
            originalName: true,
            mimeType: true
          }
        },
        _count: {
          select: { purchases: true }
        }
      }
    });

    return response.json(
      transactions.map((transaction) => ({
        id: transaction.id,
        quoteReference: transaction.quoteReference,
        orderReference: transaction.orderReference,
        quoteDate: transaction.quoteDate,
        orderEffectiveDate: transaction.orderEffectiveDate,
        status: transaction.status,
        purchaseCount: transaction._count.purchases,
        xmlDocuments: transaction.documents
          .filter(
            (document) =>
              document.originalName.toLowerCase().endsWith(".xml") ||
              (document.mimeType ?? "").includes("xml")
          )
          .map((document) => ({
            id: document.id,
            originalName: document.originalName
          }))
      }))
    );
  } catch (error) {
    next(error);
  }
}

export async function uploadPurchaseImage(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    if (!request.file) {
      return response.status(400).json({
        message: "Envie uma imagem JPG, PNG ou WEBP de até 5 MB."
      });
    }

    const extensions: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp"
    };

    const directory = path.resolve(
      process.env.PURCHASE_IMAGE_DIRECTORY ?? "./storage/purchases"
    );

    await fs.mkdir(directory, { recursive: true });

    const fileName = `${crypto.randomUUID()}${extensions[request.file.mimetype]
      }`;

    await fs.writeFile(path.join(directory, fileName), request.file.buffer);

    const baseUrl = (
      process.env.PUBLIC_BASE_URL ?? "http://localhost:3333"
    ).replace(/\/$/, "");

    return response.status(201).json({
      imageUrl: `${baseUrl}/uploads/purchases/${fileName}`
    });
  } catch (error) {
    next(error);
  }
}