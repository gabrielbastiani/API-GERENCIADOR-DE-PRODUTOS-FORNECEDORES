import { Router } from "express";
import {
  createTransaction,
  createTransactionDocument,
  deleteTransaction,
  deleteTransactionDocument,
  getTransaction,
  listTransactionDocuments,
  listTransactionItems,
  listTransactions,
  replaceTransactionItems,
  updateTransaction,
  updateTransactionStatus
} from "../controllers/commercial-transaction.controller";
import { commercialDocumentUpload } from "../middlewares/commercial-document-upload.middleware";

const commercialTransactionRoutes = Router();

commercialTransactionRoutes.get("/", listTransactions);

commercialTransactionRoutes.post("/", createTransaction);

commercialTransactionRoutes.get("/:id", getTransaction);

commercialTransactionRoutes.put("/:id", updateTransaction);

commercialTransactionRoutes.patch(
  "/:id/status",
  updateTransactionStatus
);

commercialTransactionRoutes.delete("/:id", deleteTransaction);

commercialTransactionRoutes.get(
  "/:id/documents",
  listTransactionDocuments
);

commercialTransactionRoutes.post(
  "/:id/documents",
  commercialDocumentUpload.single("file"),
  createTransactionDocument
);

commercialTransactionRoutes.delete(
  "/:id/documents/:documentId",
  deleteTransactionDocument
);

commercialTransactionRoutes.get("/:id/items", listTransactionItems);

commercialTransactionRoutes.put("/:id/items", replaceTransactionItems);

export default commercialTransactionRoutes;