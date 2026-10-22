import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  deleteProductImage,
  deleteProductsBulk,
  getProduct,
  listProducts,
  updateProduct,
  updateProductStatus
} from "../controllers/product.controller";
import { productImageUpload } from "../middlewares/product-image-upload.middleware";

const productRoutes = Router();

productRoutes.get("/", listProducts);

productRoutes.delete("/bulk", deleteProductsBulk);

productRoutes.get("/:id", getProduct);

productRoutes.post(
  "/",
  productImageUpload.array("images", 10),
  createProduct
);

productRoutes.put(
  "/:id",
  productImageUpload.array("images", 10),
  updateProduct
);

productRoutes.patch("/:id/status", updateProductStatus);

productRoutes.delete("/:id/images/:imageId", deleteProductImage);

productRoutes.delete("/:id", deleteProduct);

export default productRoutes;