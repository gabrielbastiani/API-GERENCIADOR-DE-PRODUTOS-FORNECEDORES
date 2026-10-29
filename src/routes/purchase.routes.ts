import { Router } from "express";
import {
  createPurchase,
  deletePurchase,
  getPurchase,
  listLinkOptions,
  listPurchases,
  parsePurchaseDocumentXml,
  parsePurchaseXml,
  updatePurchase,
  uploadPurchaseImage
} from "../controllers/purchase.controller";
import { purchaseXmlUpload } from "../middlewares/purchase-xml-upload.middleware";
import { purchaseImageUpload } from "../middlewares/purchase-image-upload.middleware";

const purchaseRoutes = Router();

purchaseRoutes.get("/", listPurchases);

purchaseRoutes.get("/link-options", listLinkOptions);

purchaseRoutes.post(
  "/parse-xml",
  purchaseXmlUpload.single("file"),
  parsePurchaseXml
);

purchaseRoutes.post(
  "/parse-document-xml/:documentId",
  parsePurchaseDocumentXml
);

purchaseRoutes.post(
  "/upload-image",
  purchaseImageUpload.single("file"),
  uploadPurchaseImage
);

purchaseRoutes.get("/:id", getPurchase);
purchaseRoutes.post("/", createPurchase);
purchaseRoutes.put("/:id", updatePurchase);
purchaseRoutes.delete("/:id", deletePurchase);

export default purchaseRoutes;