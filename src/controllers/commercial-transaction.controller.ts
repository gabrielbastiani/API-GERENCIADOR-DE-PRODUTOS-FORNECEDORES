import type { NextFunction, Request, Response } from "express";
import { CommercialTransactionStatus, Prisma, SupplierDocumentType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  deleteStoredFiles,
  getCommercialDocumentUrl,
  saveCommercialDocument
} from "../utils/file-storage";

const statusSchema = z.enum([
  "DRAFT",
  "QUOTE_RECEIVED",
  "UNDER_ANALYSIS",
  "APPROVED",
  "ORDER_EFFECTIVE",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED"
]);

const documentTypeSchema = z.enum([
  "QUOTE",
  "PURCHASE_ORDER",
  "INVOICE",
  "OTHER"
]);

const optionalText = z.string().trim().optional().or(z.literal(""));

const createTransactionSchema = z.object({
  supplierId: z.string().uuid("Fornecedor inválido."),
  quoteReference: optionalText,
  orderReference: optionalText,
  quoteDate: optionalText,
  orderEffectiveDate: optionalText,
  status: statusSchema.optional(),
  notes: optionalText
});

const updateTransactionSchema = z.object({
  quoteReference: optionalText,
  orderReference: optionalText,
  quoteDate: optionalText,
  orderEffectiveDate: optionalText,
  status: statusSchema.optional(),
  notes: optionalText
});

const updateStatusSchema = z.object({
  status: statusSchema,
  orderReference: optionalText,
  orderEffectiveDate: optionalText,
  notes: optionalText
});

const createDocumentSchema = z.object({
  type: documentTypeSchema,
  title: z.string().trim().min(1, "O título do documento é obrigatório."),
  documentNumber: optionalText,
  documentDate: optionalText,
  notes: optionalText
});

const transactionItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(1, "Informe o nome do item."),
        code: z.string().trim().nullable().optional(),
        quantity: z
          .number()
          .int("A quantidade deve ser um número inteiro.")
          .min(1, "A quantidade mínima é 1."),
        unitPrice: z.number().min(0, "O preço não pode ser negativo.")
      })
    )
    .max(500, "Limite de 500 itens por negociação.")
});

function serializeItem(item: any) {
  return {
    ...item,
    unitPrice: Number(item.unitPrice)
  };
}

function emptyToNull(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function parseDate(
  value: string | undefined,
  fieldName: string
): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (normalized === "") {
    return null;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} inválida.`);
  }

  return date;
}

function serializeDocument<
  T extends {
    transactionId: string | null;
    fileName: string;
    fileUrl: string | null;
  }
>(request: Request, document: T) {
  return {
    ...document,
    fileUrl:
      document.fileUrl ??
      (document.transactionId
        ? getCommercialDocumentUrl(
          request,
          document.transactionId,
          document.fileName
        )
        : null)
  };
}

function serializeTransaction(request: Request, transaction: any) {
  return {
    ...transaction,
    documents: transaction.documents?.map((document: any) =>
      serializeDocument(request, document)
    ),
    items: transaction.items?.map(serializeItem)
  };
}

function transactionInclude() {
  return {
    supplier: {
      select: {
        id: true,
        name: true
      }
    },
    documents: {
      orderBy: {
        createdAt: "desc" as const
      }
    },
    statusHistory: {
      orderBy: {
        createdAt: "desc" as const
      }
    },
    items: {
      orderBy: {
        sortOrder: "asc" as const
      }
    },
  };
}

export async function listTransactions(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const {
      supplierId,
      status,
      search,
      startDate,
      endDate
    } = request.query;

    const where: Prisma.CommercialTransactionWhereInput = {};

    if (typeof supplierId === "string" && supplierId.trim() !== "") {
      where.supplierId = supplierId;
    }

    if (typeof status === "string" && status.trim() !== "") {
      const parsedStatus = statusSchema.safeParse(status);

      if (!parsedStatus.success) {
        return response.status(400).json({
          message: "Status comercial inválido."
        });
      }

      where.status = parsedStatus.data as CommercialTransactionStatus;
    }

    if (typeof search === "string" && search.trim() !== "") {
      const term = search.trim();

      where.OR = [
        {
          quoteReference: {
            contains: term,
            mode: "insensitive"
          }
        },
        {
          orderReference: {
            contains: term,
            mode: "insensitive"
          }
        },
        {
          notes: {
            contains: term,
            mode: "insensitive"
          }
        }
      ];
    }

    if (
      (typeof startDate === "string" && startDate.trim() !== "") ||
      (typeof endDate === "string" && endDate.trim() !== "")
    ) {
      const quoteDate: Prisma.DateTimeNullableFilter = {};

      if (typeof startDate === "string" && startDate.trim() !== "") {
        quoteDate.gte = parseDate(startDate, "Data inicial") ?? undefined;
      }

      if (typeof endDate === "string" && endDate.trim() !== "") {
        quoteDate.lte = parseDate(endDate, "Data final") ?? undefined;
      }

      where.quoteDate = quoteDate;
    }

    const transactions = await prisma.commercialTransaction.findMany({
      where,
      include: {
        supplier: {
          select: {
            id: true,
            name: true
          }
        },
        documents: {
          orderBy: {
            createdAt: "desc"
          }
        },
        items: {
          orderBy: {
            sortOrder: "asc"
          }
        },
        _count: {
          select: {
            documents: true,
            statusHistory: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    return response.json(
      transactions.map((transaction) => ({
        ...transaction,
        items: transaction.items.map(serializeItem)
      }))
    );
  } catch (error) {
    next(error);
  }
}

export async function getTransaction(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const transaction = await prisma.commercialTransaction.findUnique({
      where: {
        id: request.params.id
      },
      include: transactionInclude()
    });

    if (!transaction) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    return response.json(serializeTransaction(request, transaction));
  } catch (error) {
    next(error);
  }
}

export async function createTransaction(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = createTransactionSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ??
          "Dados do orçamento ou pedido inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const data = parsed.data;

    const supplier = await prisma.supplier.findUnique({
      where: {
        id: data.supplierId
      }
    });

    if (!supplier) {
      return response.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    const status = (data.status ??
      "DRAFT") as CommercialTransactionStatus;

    const quoteDate = parseDate(data.quoteDate, "Data do orçamento");
    let orderEffectiveDate = parseDate(
      data.orderEffectiveDate,
      "Data de efetivação do pedido"
    );

    if (
      status === CommercialTransactionStatus.ORDER_EFFECTIVE &&
      !orderEffectiveDate
    ) {
      orderEffectiveDate = new Date();
    }

    const created = await prisma.commercialTransaction.create({
      data: {
        supplierId: data.supplierId,
        quoteReference: emptyToNull(data.quoteReference),
        orderReference: emptyToNull(data.orderReference),
        quoteDate: quoteDate ?? null,
        orderEffectiveDate: orderEffectiveDate ?? null,
        status,
        notes: emptyToNull(data.notes),
        statusHistory: {
          create: {
            oldStatus: null,
            newStatus: status,
            notes: emptyToNull(data.notes)
          }
        }
      },
      include: transactionInclude()
    });

    return response.status(201).json(
      serializeTransaction(request, created)
    );
  } catch (error) {
    next(error);
  }
}

export async function updateTransaction(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateTransactionSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ??
          "Dados do orçamento ou pedido inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const current = await prisma.commercialTransaction.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!current) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    const data = parsed.data;
    const newStatus = data.status
      ? (data.status as CommercialTransactionStatus)
      : current.status;

    const quoteDate = parseDate(data.quoteDate, "Data do orçamento");
    let orderEffectiveDate = parseDate(
      data.orderEffectiveDate,
      "Data de efetivação do pedido"
    );

    if (
      newStatus === CommercialTransactionStatus.ORDER_EFFECTIVE &&
      !orderEffectiveDate &&
      !current.orderEffectiveDate
    ) {
      orderEffectiveDate = new Date();
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.commercialTransaction.update({
        where: {
          id: current.id
        },
        data: {
          quoteReference:
            data.quoteReference === undefined
              ? undefined
              : emptyToNull(data.quoteReference),

          orderReference:
            data.orderReference === undefined
              ? undefined
              : emptyToNull(data.orderReference),

          quoteDate:
            data.quoteDate === undefined
              ? undefined
              : quoteDate ?? null,

          orderEffectiveDate:
            data.orderEffectiveDate === undefined
              ? orderEffectiveDate
              : orderEffectiveDate ?? null,

          status: newStatus,

          notes:
            data.notes === undefined
              ? undefined
              : emptyToNull(data.notes)
        },
        include: transactionInclude()
      });

      if (current.status !== newStatus) {
        await transaction.commercialTransactionStatusHistory.create({
          data: {
            transactionId: current.id,
            oldStatus: current.status,
            newStatus,
            notes: emptyToNull(data.notes)
          }
        });
      }

      return result;
    });

    return response.json(
      serializeTransaction(request, updated)
    );
  } catch (error) {
    next(error);
  }
}

export async function updateTransactionStatus(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateStatusSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message: "Status comercial inválido.",
        errors: parsed.error.flatten()
      });
    }

    const current = await prisma.commercialTransaction.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!current) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    const newStatus = parsed.data.status as CommercialTransactionStatus;

    let orderEffectiveDate = parseDate(
      parsed.data.orderEffectiveDate,
      "Data de efetivação do pedido"
    );

    if (
      newStatus === CommercialTransactionStatus.ORDER_EFFECTIVE &&
      !orderEffectiveDate
    ) {
      orderEffectiveDate =
        current.orderEffectiveDate ?? new Date();
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.commercialTransaction.update({
        where: {
          id: current.id
        },
        data: {
          status: newStatus,

          orderReference:
            parsed.data.orderReference === undefined
              ? undefined
              : emptyToNull(parsed.data.orderReference),

          orderEffectiveDate:
            newStatus === CommercialTransactionStatus.ORDER_EFFECTIVE
              ? orderEffectiveDate
              : undefined,

          notes:
            parsed.data.notes === undefined
              ? undefined
              : emptyToNull(parsed.data.notes)
        },
        include: transactionInclude()
      });

      if (current.status !== newStatus) {
        await transaction.commercialTransactionStatusHistory.create({
          data: {
            transactionId: current.id,
            oldStatus: current.status,
            newStatus,
            notes: emptyToNull(parsed.data.notes)
          }
        });
      }

      return result;
    });

    return response.json(
      serializeTransaction(request, updated)
    );
  } catch (error) {
    next(error);
  }
}

export async function deleteTransaction(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const transaction = await prisma.commercialTransaction.findUnique({
      where: {
        id: request.params.id
      },
      include: {
        documents: {
          select: {
            filePath: true
          }
        }
      }
    });

    if (!transaction) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    await prisma.commercialTransaction.delete({
      where: {
        id: transaction.id
      }
    });

    await deleteStoredFiles(
      transaction.documents.map((document) => document.filePath)
    );

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function listTransactionDocuments(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const transaction = await prisma.commercialTransaction.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!transaction) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    const documents = await prisma.supplierDocument.findMany({
      where: {
        transactionId: transaction.id
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return response.json(
      documents.map((document) =>
        serializeDocument(request, document)
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function createTransactionDocument(
  request: Request,
  response: Response,
  next: NextFunction
) {
  let savedFilePath: string | null = null;

  try {
    const parsed = createDocumentSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ??
          "Dados do documento inválidos.",
        errors: parsed.error.flatten()
      });
    }

    if (!request.file) {
      return response.status(400).json({
        message: "Envie o arquivo no campo \"file\"."
      });
    }

    const transaction = await prisma.commercialTransaction.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!transaction) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    const documentDate = parseDate(
      parsed.data.documentDate,
      "Data do documento"
    );

    const storedFile = await saveCommercialDocument(
      request.file,
      transaction.id
    );

    savedFilePath = storedFile.filePath;

    const baseUrl = (
      process.env.PUBLIC_BASE_URL ??
      `${request.protocol}://${request.get("host")}`
    ).replace(/\/$/, "");

    const document = await prisma.supplierDocument.create({
      data: {
        supplierId: transaction.supplierId,
        transactionId: transaction.id,
        type: parsed.data.type as SupplierDocumentType,
        title: parsed.data.title,
        documentNumber: emptyToNull(parsed.data.documentNumber),
        originalName: request.file.originalname,
        fileName: storedFile.fileName,
        filePath: storedFile.filePath,
        fileUrl: `${baseUrl}/storage/commercial-documents/${transaction.id}/${encodeURIComponent(
          storedFile.fileName
        )}`,
        fileSize: request.file.size,
        mimeType: request.file.mimetype,
        documentDate: documentDate ?? null,
        notes: emptyToNull(parsed.data.notes)
      }
    });

    return response.status(201).json(
      serializeDocument(request, document)
    );
  } catch (error) {
    if (savedFilePath) {
      await deleteStoredFiles([savedFilePath]);
    }

    next(error);
  }
}

export async function deleteTransactionDocument(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const document = await prisma.supplierDocument.findFirst({
      where: {
        id: request.params.documentId,
        transactionId: request.params.id
      }
    });

    if (!document) {
      return response.status(404).json({
        message: "Documento não encontrado."
      });
    }

    await prisma.supplierDocument.delete({
      where: {
        id: document.id
      }
    });

    await deleteStoredFiles([document.filePath]);

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function listTransactionItems(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const items = await prisma.commercialTransactionItem.findMany({
      where: { transactionId: request.params.id },
      orderBy: { sortOrder: "asc" }
    });

    return response.json(items.map(serializeItem));
  } catch (error) {
    next(error);
  }
}

export async function replaceTransactionItems(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = transactionItemsSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ?? "Itens inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const transaction = await prisma.commercialTransaction.findUnique({
      where: { id: request.params.id }
    });

    if (!transaction) {
      return response.status(404).json({
        message: "Orçamento ou pedido não encontrado."
      });
    }

    const productIds = Array.from(
      new Set(
        parsed.data.items
          .map((item) => item.productId)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          supplierId: transaction.supplierId
        },
        select: { id: true }
      });

      if (products.length !== productIds.length) {
        return response.status(400).json({
          message:
            "Um ou mais produtos não pertencem ao fornecedor desta negociação."
        });
      }
    }

    const items = await prisma.$transaction(async (tx) => {
      await tx.commercialTransactionItem.deleteMany({
        where: { transactionId: transaction.id }
      });

      if (parsed.data.items.length > 0) {
        await tx.commercialTransactionItem.createMany({
          data: parsed.data.items.map((item, index) => ({
            transactionId: transaction.id,
            productId: item.productId ?? null,
            name: item.name,
            code: item.code ? item.code : null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            sortOrder: index
          }))
        });
      }

      return tx.commercialTransactionItem.findMany({
        where: { transactionId: transaction.id },
        orderBy: { sortOrder: "asc" }
      });
    });

    return response.json(items.map(serializeItem));
  } catch (error) {
    next(error);
  }
}