import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const createCatalogSchema = z.object({
  supplierId: z.string().uuid("Fornecedor inválido."),
  title: z.string().trim().min(1, "O título do catálogo é obrigatório."),
  notes: z.string().trim().optional().or(z.literal(""))
});

const updateCatalogSchema = z.object({
  title: z.string().trim().min(1, "O título é obrigatório.").optional(),
  notes: z.string().trim().optional().or(z.literal(""))
});

function emptyToNull(value: string | undefined) {
  if (!value || value.trim() === "") {
    return null;
  }

  return value.trim();
}

export async function listCatalogs(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const { supplierId } = request.query;

    const catalogs = await prisma.catalog.findMany({
      where:
        typeof supplierId === "string" && supplierId.trim() !== ""
          ? { supplierId }
          : undefined,
      include: {
        supplier: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            products: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return response.json(catalogs);
  } catch (error) {
    next(error);
  }
}

export async function getCatalog(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const catalog = await prisma.catalog.findUnique({
      where: {
        id: request.params.id
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            products: true
          }
        }
      }
    });

    if (!catalog) {
      return response.status(404).json({
        message: "Catálogo não encontrado."
      });
    }

    return response.json(catalog);
  } catch (error) {
    next(error);
  }
}

export async function createCatalog(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = createCatalogSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        message: "Dados do catálogo inválidos.",
        errors: parsed.error.flatten()
      });
    }

    if (!request.file) {
      return response.status(400).json({
        message: "Envie o arquivo PDF no campo \"file\"."
      });
    }

    const supplier = await prisma.supplier.findUnique({
      where: {
        id: parsed.data.supplierId
      }
    });

    if (!supplier) {
      return response.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    const directory = path.resolve(
      process.env.UPLOAD_DIRECTORY ?? "./storage/catalogs"
    );

    await fs.mkdir(directory, {
      recursive: true
    });

    const fileName = `${crypto.randomUUID()}.pdf`;
    const filePath = path.join(directory, fileName);

    await fs.writeFile(filePath, request.file.buffer);

    const baseUrl = (
      process.env.PUBLIC_BASE_URL ?? "http://localhost:3333"
    ).replace(/\/$/, "");

    try {
      const catalog = await prisma.catalog.create({
        data: {
          supplierId: parsed.data.supplierId,
          title: parsed.data.title,
          fileName,
          originalName: request.file.originalname,
          filePath,
          fileUrl: `${baseUrl}/uploads/catalogs/${fileName}`,
          fileSize: request.file.size,
          mimeType: request.file.mimetype,
          notes: emptyToNull(parsed.data.notes)
        }
      });

      return response.status(201).json(catalog);
    } catch (databaseError) {
      await fs.rm(filePath, { force: true });
      throw databaseError;
    }
  } catch (error) {
    next(error);
  }
}

export async function updateCatalog(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateCatalogSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        message: "Dados inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const existing = await prisma.catalog.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!existing) {
      return response.status(404).json({
        message: "Catálogo não encontrado."
      });
    }

    const catalog = await prisma.catalog.update({
      where: {
        id: request.params.id
      },
      data: {
        title: parsed.data.title,
        notes:
          parsed.data.notes === undefined
            ? undefined
            : emptyToNull(parsed.data.notes)
      }
    });

    return response.json(catalog);
  } catch (error) {
    next(error);
  }
}

export async function deleteCatalog(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const catalog = await prisma.catalog.findUnique({
      where: {
        id: request.params.id
      }
    });

    if (!catalog) {
      return response.status(404).json({
        message: "Catálogo não encontrado."
      });
    }

    await prisma.catalog.delete({
      where: {
        id: catalog.id
      }
    });

    await fs.rm(catalog.filePath, { force: true });

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}