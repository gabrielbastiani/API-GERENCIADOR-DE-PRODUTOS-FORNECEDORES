import { Router } from "express";
import {
  createCatalog,
  deleteCatalog,
  getCatalog,
  listCatalogs,
  updateCatalog
} from "../controllers/catalog.controller";
import { catalogUpload } from "../middlewares/catalog-upload.middleware";

const catalogRoutes = Router();

catalogRoutes.get("/", listCatalogs);

catalogRoutes.get("/:id", getCatalog);

catalogRoutes.post("/", catalogUpload.single("file"), createCatalog);

catalogRoutes.put("/:id", updateCatalog);

catalogRoutes.delete("/:id", deleteCatalog);

export default catalogRoutes;