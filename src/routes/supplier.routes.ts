import { Router } from "express";
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier
} from "../controllers/supplier.controller";
import { supplierImageUpload } from "../middlewares/supplier-image.middleware";

const supplierRoutes = Router();

supplierRoutes.get("/", listSuppliers);

supplierRoutes.get("/:id", getSupplier);

supplierRoutes.post(
  "/",
  supplierImageUpload.single("image"),
  createSupplier
);

supplierRoutes.put(
  "/:id",
  supplierImageUpload.single("image"),
  updateSupplier
);

supplierRoutes.delete("/:id", deleteSupplier);

export default supplierRoutes;