import { Router } from "express";
import {
  deleteCertificate,
  fetchByKey,
  fetchInvoiceXml,
  getCertificate,
  getInvoiceXml,
  listInvoices,
  manifestInvoiceHandler,
  saveCertificate,
  syncNow,
  updateCertificate
} from "../controllers/fiscal.controller";

const fiscalRoutes = Router();

fiscalRoutes.get("/certificate", getCertificate);
fiscalRoutes.post("/certificate", saveCertificate);
fiscalRoutes.patch("/certificate", updateCertificate);
fiscalRoutes.delete("/certificate", deleteCertificate);

fiscalRoutes.post("/sync", syncNow);
fiscalRoutes.post("/fetch-by-key", fetchByKey);

fiscalRoutes.get("/invoices", listInvoices);
fiscalRoutes.get("/invoices/:id/xml", getInvoiceXml);
fiscalRoutes.post("/invoices/:id/manifest", manifestInvoiceHandler);
fiscalRoutes.post("/invoices/:id/fetch-xml", fetchInvoiceXml);

export default fiscalRoutes;