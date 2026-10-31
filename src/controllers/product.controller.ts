import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { Prisma, ProductStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const productStatusSchema = z.enum([
  "NOT_ANALYZED",
  "IN_VALIDATION",
  "PROMISING",
  "WAITING",
  "DISCARDED"
]);

const optionalText = z.string().trim().optional().or(z.literal(""));

const createProductSchema = z.object({
  supplierId: z.string().uuid("Fornecedor inválido."),
  catalogId: z
    .string()
    .uuid("Catálogo inválido.")
    .optional()
    .or(z.literal("")),
  name: z.string().trim().min(1, "O nome do produto é obrigatório."),
  referenceCode: optionalText,
  brand: optionalText,
  model: optionalText,
  ean: optionalText,
  cost: optionalText,
  description: optionalText,
  sourcePage: optionalText,
  status: productStatusSchema.optional(),
  justification: optionalText
});

const updateProductSchema = z.object({
  supplierId: z.string().uuid("Fornecedor inválido."),
  catalogId: z
    .string()
    .uuid("Catálogo inválido.")
    .optional()
    .or(z.literal("")),
  name: z.string().trim().min(1, "O nome do produto é obrigatório."),
  referenceCode: optionalText,
  brand: optionalText,
  model: optionalText,
  ean: optionalText,
  cost: optionalText,
  description: optionalText,
  sourcePage: optionalText,
  removeImageIds: z.string().optional()
});

const updateStatusSchema = z.object({
  status: productStatusSchema,
  justification: optionalText
});

const bulkDeleteProductsSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Informe ao menos um produto.")
});

function emptyToNull(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  return value.trim();
}

function parseOptionalDecimal(value: string | undefined) {
  const normalized = emptyToNull(value);

  if (normalized === null) {
    return null;
  }

  const text = normalized.replace(/\s/g, "");

  const parsed = Number(
    text.includes(",")
      ? text.replace(/\./g, "").replace(",", ".")
      : text
  );

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("O custo informado é inválido.");
  }

  return new Prisma.Decimal(parsed.toFixed(2));
}

function parseOptionalInteger(value: string | undefined) {
  const normalized = emptyToNull(value);

  if (normalized === null) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      "A página de origem deve ser um número inteiro positivo."
    );
  }

  return parsed;
}

function serializeProduct<
  T extends {
    cost: Prisma.Decimal | null;
    images?: unknown;
  }
>(product: T) {
  return {
    ...product,
    cost: product.cost?.toString() ?? null
  };
}

/* ------------------------------------------------------------------ */
/* Imagens                                                            */
/* ------------------------------------------------------------------ */

function getProductImageDirectory(productId: string) {
  return path.resolve(
    process.env.PRODUCT_IMAGE_DIRECTORY ?? "./storage/products",
    productId
  );
}

function getUploadedImages(request: Request) {
  return (request.files as Express.Multer.File[] | undefined) ?? [];
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseImageIds(value: string | undefined): string[] | null {
  if (!value || value.trim() === "") {
    return [];
  }

  try {
    const result = z
      .array(z.string().min(1))
      .safeParse(JSON.parse(value));

    return result.success ? Array.from(new Set(result.data)) : null;
  } catch {
    return null;
  }
}

async function removeImageFiles(
  productId: string,
  images: Array<{ fileName: string; filePath: string }>
) {
  const directory = getProductImageDirectory(productId);

  for (const image of images) {
    const candidates = new Set([
      path.join(directory, path.basename(image.fileName)),
      image.filePath
    ]);

    for (const candidate of candidates) {
      try {
        await fs.rm(candidate, { force: true });
      } catch (error) {
        console.error(
          `[imagens] Não foi possível remover o arquivo ${candidate}:`,
          error
        );
      }
    }
  }
}

async function removeProductImages(
  productId: string,
  imageIds: string[]
) {
  if (imageIds.length === 0) {
    return 0;
  }

  const images = await prisma.productImage.findMany({
    where: {
      productId,
      id: {
        in: imageIds
      }
    }
  });

  if (images.length === 0) {
    return 0;
  }

  await prisma.productImage.deleteMany({
    where: {
      productId,
      id: {
        in: images.map((image) => image.id)
      }
    }
  });

  await removeImageFiles(productId, images);

  return images.length;
}

async function saveProductImages(
  productId: string,
  files: Express.Multer.File[]
) {
  const productDirectory = getProductImageDirectory(productId);

  const currentImages = await prisma.productImage.findMany({
    where: {
      productId
    },
    orderBy: {
      sortOrder: "asc"
    }
  });

  if (files.length === 0) {
    return { images: currentImages, saved: 0, skipped: 0 };
  }

  await fs.mkdir(productDirectory, {
    recursive: true
  });

  // Hash do conteúdo das imagens que o produto já possui.
  const knownHashes = new Set<string>();

  for (const image of currentImages) {
    const candidates = [
      path.join(productDirectory, path.basename(image.fileName)),
      image.filePath
    ];

    for (const candidate of candidates) {
      try {
        const buffer = await fs.readFile(candidate);
        knownHashes.add(sha256(buffer));
        break;
      } catch {
        // tenta o próximo caminho
      }
    }
  }

  const lastSortOrder = currentImages.reduce(
    (max, image) => Math.max(max, image.sortOrder),
    -1
  );

  const baseUrl = (
    process.env.PUBLIC_BASE_URL ?? "http://localhost:3333"
  ).replace(/\/$/, "");

  const newRecords: Array<{
    productId: string;
    fileName: string;
    originalName: string;
    filePath: string;
    fileUrl: string;
    mimeType: string;
    fileSize: number;
    sortOrder: number;
  }> = [];

  let skipped = 0;

  for (const file of files) {
    const extension = extensionFromMimeType(file.mimetype);

    if (!extension) {
      throw new Error("Tipo de imagem não permitido.");
    }

    const hash = sha256(file.buffer);

    if (knownHashes.has(hash)) {
      skipped += 1;
      continue;
    }

    knownHashes.add(hash);

    const fileName = `${crypto.randomUUID()}${extension}`;
    const filePath = path.join(productDirectory, fileName);

    await fs.writeFile(filePath, file.buffer);

    newRecords.push({
      productId,
      fileName,
      originalName: file.originalname,
      filePath,
      fileUrl: `${baseUrl}/uploads/products/${productId}/${fileName}`,
      mimeType: file.mimetype,
      fileSize: file.size,
      sortOrder: lastSortOrder + newRecords.length + 1
    });
  }

  if (newRecords.length > 0) {
    await prisma.productImage.createMany({
      data: newRecords
    });
  }

  const images = await prisma.productImage.findMany({
    where: {
      productId
    },
    orderBy: {
      sortOrder: "asc"
    }
  });

  return { images, saved: newRecords.length, skipped };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

export async function listProducts(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const {
      supplierId,
      catalogId,
      status,
      search,
      sourcePageOrder,
      activeSuppliersOnly,
      page = "1",
      limit = "20"
    } = request.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const where: Prisma.ProductWhereInput = {};

    if (typeof supplierId === "string" && supplierId.trim() !== "") {
      where.supplierId = supplierId.trim();
    }

    if (typeof catalogId === "string" && catalogId.trim() !== "") {
      const parsedCatalogId = z.string().uuid().safeParse(catalogId.trim());

      if (!parsedCatalogId.success) {
        return response.status(400).json({
          message: "Catálogo inválido."
        });
      }

      where.catalogId = parsedCatalogId.data;
    }

    // Ordena páginas numericamente e mantém produtos sem página no final.
    let pageSort: "asc" | "desc" | undefined;

    if (typeof sourcePageOrder === "string" && sourcePageOrder.trim() !== "") {
      if (sourcePageOrder !== "asc" && sourcePageOrder !== "desc") {
        return response.status(400).json({
          message: "Ordenação da página do catálogo inválida."
        });
      }

      pageSort = sourcePageOrder;
    }

    // Oculta produtos de fornecedores inativos quando solicitado.
    if (activeSuppliersOnly === "true") {
      where.supplier = {
        isActive: true
      };
    }

    if (typeof status === "string" && status.trim() !== "") {
      const parsedStatus = productStatusSchema.safeParse(status);

      if (!parsedStatus.success) {
        return response.status(400).json({
          message: "Status de produto inválido."
        });
      }

      where.status = parsedStatus.data as ProductStatus;
    }

    if (typeof search === "string" && search.trim() !== "") {
      const term = search.trim();

      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { referenceCode: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { model: { contains: term, mode: "insensitive" } },
        { ean: { contains: term, mode: "insensitive" } }
      ];
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput[] = pageSort
      ? [
          {
            sourcePage: {
              sort: pageSort,
              nulls: "last"
            }
          },
          { createdAt: "desc" },
          { name: "asc" }
        ]
      : [{ createdAt: "desc" }];

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          supplier: true,
          catalog: true,
          images: {
            orderBy: {
              sortOrder: "asc"
            }
          }
        },
        orderBy,
        skip: (currentPage - 1) * pageSize,
        take: pageSize
      }),
      prisma.product.count({ where })
    ]);

    return response.json({
      data: products.map(serializeProduct),
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getProduct(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const product = await prisma.product.findUnique({
      where: {
        id: request.params.id
      },
      include: {
        supplier: true,
        catalog: true,
        images: {
          orderBy: {
            sortOrder: "asc"
          }
        },
        statusHistory: {
          orderBy: {
            createdAt: "desc"
          }
        },
        researches: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });

    if (!product) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

    return response.json(serializeProduct(product));
  } catch (error) {
    next(error);
  }
}

export async function createProduct(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = createProductSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ??
          "Dados do produto inválidos.",
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

    if (data.catalogId) {
      const catalog = await prisma.catalog.findFirst({
        where: {
          id: data.catalogId,
          supplierId: data.supplierId
        }
      });

      if (!catalog) {
        return response.status(400).json({
          message: "O catálogo não pertence ao fornecedor informado."
        });
      }
    }

    const created = await prisma.product.create({
      data: {
        supplierId: data.supplierId,
        catalogId: emptyToNull(data.catalogId),
        name: data.name,
        referenceCode: emptyToNull(data.referenceCode),
        brand: emptyToNull(data.brand),
        model: emptyToNull(data.model),
        ean: emptyToNull(data.ean),
        cost: parseOptionalDecimal(data.cost),
        description: emptyToNull(data.description),
        sourcePage: parseOptionalInteger(data.sourcePage),
        status: (data.status ?? "NOT_ANALYZED") as ProductStatus,
        justification: emptyToNull(data.justification)
      }
    });

    await saveProductImages(created.id, getUploadedImages(request));

    const product = await prisma.product.findUnique({
      where: {
        id: created.id
      },
      include: {
        supplier: true,
        catalog: true,
        images: {
          orderBy: {
            sortOrder: "asc"
          }
        }
      }
    });

    if (!product) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

    return response.status(201).json(serializeProduct(product));
  } catch (error) {
    next(error);
  }
}

export async function updateProduct(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const uploadedFiles = getUploadedImages(request);

    console.log("[updateProduct] recebido:", {
      productId: request.params.id,
      bodyKeys: Object.keys(request.body ?? {}),
      removeImageIds: request.body?.removeImageIds,
      uploadedFiles: uploadedFiles.map((file) => file.originalname)
    });

    const parsed = updateProductSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ??
          "Dados do produto inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const data = parsed.data;

    const imageIdsToRemove = parseImageIds(data.removeImageIds);

    if (imageIdsToRemove === null) {
      return response.status(400).json({
        message: "Lista de imagens para remoção inválida."
      });
    }

    const existingProduct = await prisma.product.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!existingProduct) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

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

    if (data.catalogId) {
      const catalog = await prisma.catalog.findFirst({
        where: {
          id: data.catalogId,
          supplierId: data.supplierId
        }
      });

      if (!catalog) {
        return response.status(400).json({
          message: "O catálogo não pertence ao fornecedor informado."
        });
      }
    }

    await prisma.product.update({
      where: {
        id: existingProduct.id
      },
      data: {
        supplierId: data.supplierId,
        catalogId: emptyToNull(data.catalogId),
        name: data.name,
        referenceCode: emptyToNull(data.referenceCode),
        brand: emptyToNull(data.brand),
        model: emptyToNull(data.model),
        ean: emptyToNull(data.ean),
        cost: parseOptionalDecimal(data.cost),
        description: emptyToNull(data.description),
        sourcePage: parseOptionalInteger(data.sourcePage)
      }
    });

    // Primeiro remove, depois adiciona.
    const removed = await removeProductImages(
      existingProduct.id,
      imageIdsToRemove
    );

    const { saved, skipped } = await saveProductImages(
      existingProduct.id,
      uploadedFiles
    );

    console.log("[updateProduct] resultado:", {
      solicitadasParaRemover: imageIdsToRemove.length,
      removidas: removed,
      novasSalvas: saved,
      duplicadasIgnoradas: skipped
    });

    const product = await prisma.product.findUnique({
      where: {
        id: existingProduct.id
      },
      include: {
        supplier: true,
        catalog: true,
        images: {
          orderBy: {
            sortOrder: "asc"
          }
        }
      }
    });

    if (!product) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

    return response.json(serializeProduct(product));
  } catch (error) {
    next(error);
  }
}

export async function updateProductStatus(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateStatusSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message: "Status ou justificativa inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const currentProduct = await prisma.product.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!currentProduct) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

    const updatedProduct = await prisma.$transaction(
      async (transaction) => {
        const product = await transaction.product.update({
          where: {
            id: request.params.id
          },
          data: {
            status: parsed.data.status as ProductStatus,
            justification: emptyToNull(parsed.data.justification)
          },
          include: {
            supplier: true,
            catalog: true,
            images: {
              orderBy: {
                sortOrder: "asc"
              }
            }
          }
        });

        if (currentProduct.status !== parsed.data.status) {
          await transaction.productStatusHistory.create({
            data: {
              productId: product.id,
              oldStatus: currentProduct.status,
              newStatus: parsed.data.status as ProductStatus,
              justification: emptyToNull(parsed.data.justification)
            }
          });
        }

        return product;
      }
    );

    return response.json(serializeProduct(updatedProduct));
  } catch (error) {
    next(error);
  }
}

export async function deleteProduct(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const product = await prisma.product.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!product) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

    await prisma.product.delete({
      where: {
        id: product.id
      }
    });

    await fs.rm(getProductImageDirectory(product.id), {
      recursive: true,
      force: true
    });

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function deleteProductImage(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const removed = await removeProductImages(request.params.id, [
      request.params.imageId
    ]);

    if (removed === 0) {
      return response.status(404).json({
        message: "Imagem não encontrada."
      });
    }

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function deleteProductsBulk(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = bulkDeleteProductsSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ??
          "Lista de produtos inválida."
      });
    }

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: parsed.data.ids
        }
      },
      select: {
        id: true
      }
    });

    if (products.length === 0) {
      return response.status(404).json({
        message: "Nenhum produto encontrado."
      });
    }

    await prisma.product.deleteMany({
      where: {
        id: {
          in: products.map((product) => product.id)
        }
      }
    });

    await Promise.all(
      products.map((product) =>
        fs.rm(getProductImageDirectory(product.id), {
          recursive: true,
          force: true
        })
      )
    );

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}