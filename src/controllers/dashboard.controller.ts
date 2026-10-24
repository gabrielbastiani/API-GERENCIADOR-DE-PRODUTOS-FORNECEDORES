import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";

type StatusCountRow = {
  status: string;
  _count: { _all: number };
};

function countStatus(rows: StatusCountRow[], ...statuses: string[]) {
  return rows
    .filter((row) => statuses.includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);
}

function sumAll(rows: StatusCountRow[]) {
  return rows.reduce((sum, row) => sum + row._count._all, 0);
}

export async function getDashboardSummary(
  _request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const [
      suppliersTotal,
      suppliersActive,
      inactiveSuppliersWithProducts,
      catalogsTotal,
      productsByStatus,
      quoteListsByStatus,
      transactionsByStatus,
      recentProducts,
      recentQuoteLists,
      recentTransactions
    ] = await Promise.all([
      prisma.supplier.count(),
      prisma.supplier.count({ where: { isActive: true } }),
      prisma.supplier.count({
        where: {
          isActive: false,
          products: { some: {} }
        }
      }),
      prisma.catalog.count(),
      prisma.product.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      prisma.quoteList.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      prisma.commercialTransaction.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      prisma.product.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          referenceCode: true,
          supplierId: true,
          status: true,
          createdAt: true,
          supplier: { select: { name: true } }
        }
      }),
      prisma.quoteList.findMany({
        take: 5,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          supplierId: true,
          status: true,
          updatedAt: true,
          supplier: { select: { name: true } },
          _count: { select: { items: true } }
        }
      }),
      prisma.commercialTransaction.findMany({
        take: 5,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          supplierId: true,
          quoteReference: true,
          orderReference: true,
          status: true,
          updatedAt: true,
          supplier: { select: { name: true } }
        }
      })
    ]);

    const products = productsByStatus as StatusCountRow[];
    const quoteLists = quoteListsByStatus as StatusCountRow[];
    const transactions = transactionsByStatus as StatusCountRow[];

    const notAnalyzed = countStatus(products, "NOT_ANALYZED");
    const draftQuoteLists = countStatus(quoteLists, "DRAFT");

    return response.json({
      suppliers: {
        total: suppliersTotal,
        active: suppliersActive,
        inactive: suppliersTotal - suppliersActive
      },

      catalogs: {
        total: catalogsTotal
      },

      products: {
        total: sumAll(products),
        notAnalyzed,
        inValidation: countStatus(products, "IN_VALIDATION"),
        promising: countStatus(products, "PROMISING"),
        waiting: countStatus(products, "WAITING"),
        discarded: countStatus(products, "DISCARDED")
      },

      quoteLists: {
        total: sumAll(quoteLists),
        drafts: draftQuoteLists,
        sent: countStatus(quoteLists, "SENT"),
        archived: countStatus(quoteLists, "ARCHIVED")
      },

      transactions: {
        total: sumAll(transactions),
        open: countStatus(
          transactions,
          "DRAFT",
          "QUOTE_RECEIVED",
          "UNDER_ANALYSIS"
        ),
        approved: countStatus(transactions, "APPROVED"),
        effectiveOrders: countStatus(
          transactions,
          "ORDER_EFFECTIVE",
          "PARTIALLY_RECEIVED"
        ),
        completed: countStatus(transactions, "COMPLETED"),
        cancelled: countStatus(transactions, "CANCELLED")
      },

      alerts: {
        productsWithoutAnalysis: notAnalyzed,
        inactiveSuppliersWithProducts,
        draftQuoteLists
      },

      recentProducts: recentProducts.map((product) => ({
        id: product.id,
        name: product.name,
        referenceCode: product.referenceCode,
        supplierId: product.supplierId,
        supplierName: product.supplier.name,
        status: product.status,
        createdAt: product.createdAt.toISOString()
      })),

      recentQuoteLists: recentQuoteLists.map((list) => ({
        id: list.id,
        name: list.name,
        supplierId: list.supplierId,
        supplierName: list.supplier.name,
        status: list.status,
        itemsCount: list._count.items,
        updatedAt: list.updatedAt.toISOString()
      })),

      recentTransactions: recentTransactions.map((transaction) => ({
        id: transaction.id,
        supplierId: transaction.supplierId,
        supplierName: transaction.supplier.name,
        quoteReference: transaction.quoteReference,
        orderReference: transaction.orderReference,
        status: transaction.status,
        updatedAt: transaction.updatedAt.toISOString()
      }))
    });
  } catch (error) {
    next(error);
  }
}