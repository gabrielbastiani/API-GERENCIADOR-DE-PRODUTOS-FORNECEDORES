import type { Prisma } from "@prisma/client";

export type CalcItem = {
  quantity: number;
  unitPrice: number;
};

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Rateia o frete proporcionalmente ao valor de cada item.
 * Trabalha em centavos e ajusta o último item, para que a soma
 * dos rateios seja exatamente igual ao frete informado.
 */
export function calculateFreightShares(
  items: CalcItem[],
  freightTotal: number
): number[] {
  const freightCents = Math.round(freightTotal * 100);

  const subtotals = items.map((item) =>
    Math.round(item.quantity * item.unitPrice * 100)
  );

  const sum = subtotals.reduce((total, value) => total + value, 0);

  if (freightCents <= 0 || sum <= 0) {
    return items.map(() => 0);
  }

  let allocated = 0;

  return subtotals.map((subtotal, index) => {
    const isLast = index === subtotals.length - 1;

    const share = isLast
      ? freightCents - allocated
      : Math.round((freightCents * subtotal) / sum);

    allocated += share;

    return share / 100;
  });
}

type ItemRecord = {
  id: string;
  productId: string | null;
  position: number;
  name: string;
  code: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  product?: { images: Array<{ fileUrl: string }> } | null;
  imageUrl: string | null;
};

export function serializePurchase<
  T extends {
    freightTotal: Prisma.Decimal;
    items: ItemRecord[];
  }
>(purchase: T) {
  const freightTotal = Number(purchase.freightTotal);

  const base = purchase.items.map((item) => ({
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice)
  }));

  const shares = calculateFreightShares(base, freightTotal);

  const items = purchase.items.map((item, index) => {
    const { quantity, unitPrice } = base[index];
    const subtotal = round(quantity * unitPrice, 2);
    const freightShare = shares[index];
    const totalCost = round(subtotal + freightShare, 2);

    return {
      id: item.id,
      productId: item.productId,
      name: item.name,
      code: item.code,
      quantity,
      unitPrice,
      subtotal,
      freightShare,
      unitCost: quantity > 0 ? round(totalCost / quantity, 4) : 0,
      totalCost,
      imageUrl: item.imageUrl ?? item.product?.images[0]?.fileUrl ?? null
    };
  });

  const itemsTotal = round(
    items.reduce((total, item) => total + item.subtotal, 0),
    2
  );

  return {
    ...purchase,
    freightTotal,
    items,
    itemsTotal,
    grandTotal: round(itemsTotal + freightTotal, 2)
  };
}