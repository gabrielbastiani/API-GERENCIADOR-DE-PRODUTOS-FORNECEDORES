import type { Request, Response } from "express";
import { QuoteListStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  AddQuoteListItemsBody,
  CreateQuoteListBody,
  UpdateQuoteListBody
} from "../types/quote-list.types";

const productSelect = {
  id: true,
  name: true,
  referenceCode: true,
  supplierId: true
} as const;

const quoteListInclude = {
  supplier: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      isActive: true
    }
  },
  items: {
    orderBy: {
      createdAt: "asc" as const
    },
    include: {
      product: {
        select: productSelect
      }
    }
  }
};

function toItemData(product: {
  id: string;
  name: string;
  referenceCode: string | null;
}) {
  return {
    productId: product.id,
    productName: product.name,
    productCode: product.referenceCode ?? null,
    productReference: null
  };
}

export async function listQuoteLists(req: Request, res: Response) {
  try {
    const status = req.query.status as QuoteListStatus | undefined;
    const supplierId = req.query.supplierId as string | undefined;

    if (status && !Object.values(QuoteListStatus).includes(status)) {
      return res.status(400).json({ message: "Status inválido." });
    }

    const lists = await prisma.quoteList.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(supplierId ? { supplierId } : {})
      },
      include: quoteListInclude,
      orderBy: { updatedAt: "desc" }
    });

    return res.json(lists);
  } catch (error) {
    console.error("Erro ao listar listas de orçamento:", error);

    return res.status(500).json({
      message: "Não foi possível listar as listas de orçamento."
    });
  }
}

export async function getQuoteList(req: Request, res: Response) {
  try {
    const quoteList = await prisma.quoteList.findUnique({
      where: { id: req.params.id },
      include: quoteListInclude
    });

    if (!quoteList) {
      return res.status(404).json({
        message: "Lista de orçamento não encontrada."
      });
    }

    return res.json(quoteList);
  } catch (error) {
    console.error("Erro ao buscar lista de orçamento:", error);

    return res.status(500).json({
      message: "Não foi possível buscar a lista de orçamento."
    });
  }
}

export async function createQuoteList(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as CreateQuoteListBody;
    const supplierId = body.supplierId?.trim();

    if (!supplierId) {
      return res.status(400).json({
        message: "O fornecedor é obrigatório."
      });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, isActive: true }
    });

    if (!supplier) {
      return res.status(404).json({
        message: "Fornecedor não encontrado."
      });
    }

    if (!supplier.isActive) {
      return res.status(400).json({
        message: "Não é possível criar uma lista para fornecedor inativo."
      });
    }

    const productIds = Array.from(new Set(body.productIds ?? []));

    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: productSelect
        })
      : [];

    if (products.length !== productIds.length) {
      return res.status(400).json({
        message: "Um ou mais produtos não foram encontrados."
      });
    }

    if (products.some((product) => product.supplierId !== supplierId)) {
      return res.status(400).json({
        message:
          "Todos os produtos da lista precisam pertencer ao mesmo fornecedor."
      });
    }

    const quoteList = await prisma.quoteList.create({
      data: {
        name:
          body.name?.trim() || `Lista de orçamento - ${supplier.name}`,
        notes: body.notes?.trim() || null,
        supplierId,
        items: {
          create: products.map(toItemData)
        }
      },
      include: quoteListInclude
    });

    return res.status(201).json(quoteList);
  } catch (error) {
    console.error("Erro ao criar lista de orçamento:", error);

    return res.status(500).json({
      message: "Não foi possível criar a lista de orçamento."
    });
  }
}

export async function updateQuoteList(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as UpdateQuoteListBody;

    const currentList = await prisma.quoteList.findUnique({
      where: { id }
    });

    if (!currentList) {
      return res.status(404).json({
        message: "Lista de orçamento não encontrada."
      });
    }

    if (
      body.status &&
      !Object.values(QuoteListStatus).includes(body.status)
    ) {
      return res.status(400).json({ message: "Status inválido." });
    }

    if (body.name !== undefined && body.name.trim() === "") {
      return res.status(400).json({
        message: "O nome da lista não pode ficar vazio."
      });
    }

    const quoteList = await prisma.quoteList.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.notes !== undefined
          ? { notes: body.notes.trim() || null }
          : {}),
        ...(body.status !== undefined
          ? {
              status: body.status,
              ...(body.status === QuoteListStatus.SENT
                ? { sentAt: new Date() }
                : {})
            }
          : {})
      },
      include: quoteListInclude
    });

    return res.json(quoteList);
  } catch (error) {
    console.error("Erro ao atualizar lista de orçamento:", error);

    return res.status(500).json({
      message: "Não foi possível atualizar a lista de orçamento."
    });
  }
}

export async function deleteQuoteList(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const quoteList = await prisma.quoteList.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!quoteList) {
      return res.status(404).json({
        message: "Lista de orçamento não encontrada."
      });
    }

    await prisma.quoteList.delete({ where: { id } });

    return res.status(204).send();
  } catch (error) {
    console.error("Erro ao excluir lista de orçamento:", error);

    return res.status(500).json({
      message: "Não foi possível excluir a lista de orçamento."
    });
  }
}

export async function addItemsToQuoteList(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as AddQuoteListItemsBody;

    const productIds = Array.from(new Set(body.productIds ?? []));

    if (!productIds.length) {
      return res.status(400).json({
        message: "Informe pelo menos um produto."
      });
    }

    const quoteList = await prisma.quoteList.findUnique({
      where: { id },
      select: { id: true, status: true, supplierId: true }
    });

    if (!quoteList) {
      return res.status(404).json({
        message: "Lista de orçamento não encontrada."
      });
    }

    if (quoteList.status !== QuoteListStatus.DRAFT) {
      return res.status(400).json({
        message: "Só é possível alterar uma lista que está em rascunho."
      });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: productSelect
    });

    if (products.length !== productIds.length) {
      return res.status(400).json({
        message: "Um ou mais produtos não foram encontrados."
      });
    }

    if (products.some((product) => product.supplierId !== quoteList.supplierId)) {
      return res.status(400).json({
        message: "O produto selecionado pertence a outro fornecedor."
      });
    }

    await prisma.quoteListItem.createMany({
      data: products.map((product) => ({
        quoteListId: id,
        ...toItemData(product)
      })),
      skipDuplicates: true
    });

    await prisma.quoteList.update({
      where: { id },
      data: { updatedAt: new Date() }
    });

    const updatedList = await prisma.quoteList.findUnique({
      where: { id },
      include: quoteListInclude
    });

    return res.json(updatedList);
  } catch (error) {
    console.error("Erro ao adicionar produtos à lista:", error);

    return res.status(500).json({
      message: "Não foi possível adicionar os produtos à lista."
    });
  }
}

export async function removeItemFromQuoteList(req: Request, res: Response) {
  try {
    const { id, itemId } = req.params;

    const quoteList = await prisma.quoteList.findUnique({
      where: { id },
      select: { id: true, status: true }
    });

    if (!quoteList) {
      return res.status(404).json({
        message: "Lista de orçamento não encontrada."
      });
    }

    if (quoteList.status !== QuoteListStatus.DRAFT) {
      return res.status(400).json({
        message: "Só é possível remover produtos de uma lista em rascunho."
      });
    }

    const item = await prisma.quoteListItem.findFirst({
      where: { id: itemId, quoteListId: id }
    });

    if (!item) {
      return res.status(404).json({
        message: "Produto não encontrado nesta lista."
      });
    }

    await prisma.quoteListItem.delete({ where: { id: itemId } });

    await prisma.quoteList.update({
      where: { id },
      data: { updatedAt: new Date() }
    });

    return res.status(204).send();
  } catch (error) {
    console.error("Erro ao remover produto da lista:", error);

    return res.status(500).json({
      message: "Não foi possível remover o produto da lista."
    });
  }
}