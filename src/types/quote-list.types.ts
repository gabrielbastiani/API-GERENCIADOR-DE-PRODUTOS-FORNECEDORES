import { QuoteListStatus } from "@prisma/client";

export type CreateQuoteListBody = {
  name?: string;
  notes?: string;
  supplierId: string;
  productIds?: string[];
};

export type UpdateQuoteListBody = {
  name?: string;
  notes?: string;
  status?: QuoteListStatus;
};

export type AddQuoteListItemsBody = {
  productIds: string[];
};