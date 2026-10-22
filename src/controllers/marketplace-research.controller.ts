import { NextFunction, Request, Response } from "express";
import { Marketplace } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const optionalMoney = z.number().min(0).nullable().optional();
const optionalInt = z.number().int().min(0).nullable().optional();

const researchSchema = z.object({
  productId: z.string().uuid("Produto inválido."),
  marketplace: z.nativeEnum(Marketplace),
  searchedTerm: z
    .string()
    .trim()
    .min(1, "Informe o termo pesquisado."),
  estimatedDemand: optionalInt,
  competition: optionalInt,
  salePrice: optionalMoney,
  marketplaceFee: optionalMoney,
  shippingCost: optionalMoney,
  taxCost: optionalMoney,
  otherCosts: optionalMoney,
  notes: z.string().trim().nullable().optional()
});

const updateResearchSchema = researchSchema.omit({ productId: true });

type ResearchInput = z.infer<typeof updateResearchSchema>;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function buildData(input: ResearchInput, productCost: unknown) {
  const cost =
    productCost === null || productCost === undefined
      ? null
      : Number(productCost);

  let estimatedProfit: number | null = null;
  let estimatedMargin: number | null = null;

  if (
    input.salePrice !== null &&
    input.salePrice !== undefined &&
    input.salePrice > 0 &&
    cost !== null &&
    !Number.isNaN(cost)
  ) {
    const profit =
      input.salePrice -
      cost -
      (input.marketplaceFee ?? 0) -
      (input.shippingCost ?? 0) -
      (input.taxCost ?? 0) -
      (input.otherCosts ?? 0);

    estimatedProfit = round2(profit);
    estimatedMargin = round2((profit / input.salePrice) * 100);
  }

  return {
    marketplace: input.marketplace,
    searchedTerm: input.searchedTerm,
    estimatedDemand: input.estimatedDemand ?? null,
    competition: input.competition ?? null,
    salePrice: input.salePrice ?? null,
    marketplaceFee: input.marketplaceFee ?? null,
    shippingCost: input.shippingCost ?? null,
    taxCost: input.taxCost ?? null,
    otherCosts: input.otherCosts ?? null,
    estimatedProfit,
    estimatedMargin,
    notes: input.notes ? input.notes : null
  };
}

export async function listResearch(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const productId = String(request.query.productId ?? "");

    if (!productId) {
      return response.status(400).json({
        message: "Informe o produto."
      });
    }

    const research = await prisma.marketplaceResearch.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" }
    });

    return response.json(research);
  } catch (error) {
    next(error);
  }
}

export async function createResearch(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = researchSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ?? "Dados inválidos."
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: { id: true, cost: true }
    });

    if (!product) {
      return response.status(404).json({
        message: "Produto não encontrado."
      });
    }

    const research = await prisma.marketplaceResearch.create({
      data: {
        productId: product.id,
        ...buildData(parsed.data, product.cost)
      }
    });

    return response.status(201).json(research);
  } catch (error) {
    next(error);
  }
}

export async function updateResearch(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const parsed = updateResearchSchema.safeParse(request.body);

    if (!parsed.success) {
      return response.status(400).json({
        message:
          parsed.error.issues[0]?.message ?? "Dados inválidos."
      });
    }

    const current = await prisma.marketplaceResearch.findUnique({
      where: { id: request.params.id },
      include: { product: { select: { cost: true } } }
    });

    if (!current) {
      return response.status(404).json({
        message: "Pesquisa não encontrada."
      });
    }

    const research = await prisma.marketplaceResearch.update({
      where: { id: current.id },
      data: buildData(parsed.data, current.product.cost)
    });

    return response.json(research);
  } catch (error) {
    next(error);
  }
}

export async function deleteResearch(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const current = await prisma.marketplaceResearch.findUnique({
      where: { id: request.params.id }
    });

    if (!current) {
      return response.status(404).json({
        message: "Pesquisa não encontrada."
      });
    }

    await prisma.marketplaceResearch.delete({
      where: { id: current.id }
    });

    return response.status(204).send();
  } catch (error) {
    next(error);
  }
}