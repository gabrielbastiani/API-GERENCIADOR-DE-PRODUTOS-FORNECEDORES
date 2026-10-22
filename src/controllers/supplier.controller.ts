import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  deleteStoredFiles,
  getSupplierImageUrl,
  saveSupplierImage
} from "../utils/file-storage";

const optionalText = z.string().trim().optional().or(z.literal(""));

const createSupplierSchema = z.object({
  name: z.string().trim().min(1, "O nome do fornecedor é obrigatório."),
  document: optionalText,
  contactName: optionalText,
  email: z
    .string()
    .trim()
    .email("E-mail inválido.")
    .optional()
    .or(z.literal("")),
  phone: optionalText,
  website: optionalText,
  notes: optionalText
});

const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.union([z.boolean(), z.string()]).optional()
});

const countInclude = {
  _count: {
    select: {
      catalogs: true,
      products: true
    }
  }
} as const;

function emptyToNull(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  return value.trim();
}

// Retorna undefined quando o campo não foi enviado (mantém o valor atual).
function optionalField(value: string | undefined) {
  return value === undefined ? undefined : emptyToNull(value);
}

function parseBoolean(value: boolean | string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === "boolean" ? value : value === "true";
}

function serializeSupplier<T extends { imagePath: string | null }>(
  request: Request,
  supplier: T
) {
  const { imagePath, ...rest } = supplier;

  return {
    ...rest,
    imageUrl: getSupplierImageUrl(request, imagePath)
  };
}

export async function listSuppliers(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const suppliers = await prisma.supplier.findMany({
      where:
        request.query.includeInactive === "false"
          ? { isActive: true }
          : undefined,
      include: countInclude,
      orderBy: { name: "asc" }
    });

    return response.json(
      suppliers.map((supplier) => serializeSupplier(request, supplier))
    );
  } catch (error) {
    next(error);
  }
}

export async function getSupplier(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: request.params.id },
      include: countInclude
    });

    if (!supplier) {
      return response.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    return response.json(serializeSupplier(request, supplier));
  } catch (error) {
    next(error);
  }
}

export async function createSupplier(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = createSupplierSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ?? "Dados do fornecedor inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const data = parsed.data;

    const created = await prisma.supplier.create({
      data: {
        name: data.name,
        document: emptyToNull(data.document),
        contactName: emptyToNull(data.contactName),
        email: emptyToNull(data.email),
        phone: emptyToNull(data.phone),
        website: emptyToNull(data.website),
        notes: emptyToNull(data.notes)
      }
    });

    let supplier = await prisma.supplier.findUniqueOrThrow({
      where: { id: created.id },
      include: countInclude
    });

    if (request.file) {
      const imagePath = await saveSupplierImage(request.file, created.id);

      supplier = await prisma.supplier.update({
        where: { id: created.id },
        data: { imagePath },
        include: countInclude
      });
    }

    return response.status(201).json(serializeSupplier(request, supplier));
  } catch (error) {
    next(error);
  }
}

export async function updateSupplier(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateSupplierSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ?? "Dados do fornecedor inválidos.",
        errors: parsed.error.flatten()
      });
    }

    const current = await prisma.supplier.findUnique({
      where: { id: request.params.id }
    });

    if (!current) {
      return response.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    const data = parsed.data;

    let imagePath = current.imagePath;

    if (request.file) {
      imagePath = await saveSupplierImage(request.file, current.id);
    }

    const supplier = await prisma.supplier.update({
      where: { id: current.id },
      data: {
        name: data.name,
        document: optionalField(data.document),
        contactName: optionalField(data.contactName),
        email: optionalField(data.email),
        phone: optionalField(data.phone),
        website: optionalField(data.website),
        notes: optionalField(data.notes),
        isActive: parseBoolean(data.isActive),
        imagePath
      },
      include: countInclude
    });

    // Só apaga a imagem antiga depois de o banco ter sido atualizado.
    if (request.file && current.imagePath) {
      await deleteStoredFiles([current.imagePath]);
    }

    return response.json(serializeSupplier(request, supplier));
  } catch (error) {
    next(error);
  }
}

export async function deleteSupplier(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: request.params.id },
      include: {
        catalogs: {
          select: { filePath: true }
        },
        products: {
          select: {
            images: {
              select: { filePath: true }
            }
          }
        }
      }
    });

    if (!supplier) {
      return response.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    // O onDelete: Cascade do schema apaga catálogos, produtos, imagens,
    // histórico e pesquisas de marketplace no banco.
    await prisma.supplier.delete({
      where: { id: supplier.id }
    });

    await deleteStoredFiles([
      supplier.imagePath,
      ...supplier.catalogs.map((catalog) => catalog.filePath),
      ...supplier.products.flatMap((product) =>
        product.images.map((image) => image.filePath)
      )
    ]);

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}