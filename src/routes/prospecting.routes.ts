import { Router } from "express";
import {
  cnaesController,
  companiesController,
  companyDetailsController,
  companyGeocodeController,
  companyImportController,
  cnpjController,
  geocodeController,
  importStatusController,
  importSupplierController,
  municipalitiesController,
  placesController
} from "../controllers/prospecting.controller";

const router = Router();

// Rotas da base local da Receita Federal.
router.get("/companies", companiesController);
router.get("/companies/:cnpj", companyDetailsController);
router.post("/companies/:cnpj/geocode", companyGeocodeController);
router.post("/companies/:cnpj/import", companyImportController);
router.get("/cnaes", cnaesController);
router.get("/municipalities", municipalitiesController);
router.get("/import-status", importStatusController);

// Compatibilidade temporária com versões antigas da tela de prospecção.
router.get("/geocode", geocodeController);
router.get("/places", placesController);
router.get("/cnpj/:cnpj", cnpjController);
router.post("/import", importSupplierController);

export default router;
