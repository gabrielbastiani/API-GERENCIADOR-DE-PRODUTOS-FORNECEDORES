import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import fs from "node:fs";
import productRoutes from "./routes/product.routes";
import supplierRoutes from "./routes/supplier.routes";
import catalogRoutes from "./routes/catalog.routes";
import researchRoutes from "./routes/marketplace-research.routes";
import commercialTransactionRoutes from "./routes/commercial-transaction.routes";
import quoteListRoutes from "./routes/quote-list.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import purchaseRoutes from "./routes/purchase.routes";
import { cleanupOrphanPurchaseImages } from "./utils/purchase-images";
import { startFiscalScheduler } from "./services/fiscal/sync";
import fiscalRoutes from "./routes/fiscal.routes";
import prospectingRoutes from "./routes/prospecting.routes";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

const port = Number(process.env.PORT ?? 3333);

const frontendUrl =
  process.env.FRONTEND_URL ?? "http://localhost:3000";

const catalogStorageDirectory = path.resolve(
  process.env.UPLOAD_DIRECTORY ?? "./storage/catalogs"
);

const productImageStorageDirectory = path.resolve(
  process.env.PRODUCT_IMAGE_DIRECTORY ?? "./storage/products"
);

const supplierImageStorageDirectory = path.resolve(
  process.env.SUPPLIER_IMAGE_DIRECTORY ?? "./storage/suppliers"
);

fs.mkdirSync(supplierImageStorageDirectory, {
  recursive: true
});

fs.mkdirSync(catalogStorageDirectory, {
  recursive: true
});

fs.mkdirSync(productImageStorageDirectory, {
  recursive: true
});

app.use(
  "/storage",
  express.static(
    path.resolve(process.env.STORAGE_DIRECTORY ?? "./storage")
  )
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || frontendUrl.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origem não autorizada pelo CORS."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.use(
  "/uploads/catalogs",
  express.static(catalogStorageDirectory)
);

app.use(
  "/uploads/products",
  express.static(productImageStorageDirectory)
);

app.use(
  "/uploads/purchases",
  express.static(
    path.resolve(process.env.PURCHASE_IMAGE_DIRECTORY ?? "./storage/purchases")
  )
);

app.get("/health", (_request, response) => {
  return response.json({
    status: "ok",
    service: "catalog-manager-api"
  });
});

app.use("/suppliers", supplierRoutes);
app.use("/catalogs", catalogRoutes);
app.use("/products", productRoutes);
app.use("/marketplace-research", researchRoutes);
app.use("/transactions", commercialTransactionRoutes);
app.use("/quote-lists", quoteListRoutes);
app.use("/purchases", purchaseRoutes);
app.use("/fiscal", fiscalRoutes);
app.use("/prospecting", prospectingRoutes);
app.use("/dashboard", dashboardRoutes);

app.use(errorMiddleware);

cleanupOrphanPurchaseImages().catch(() => undefined);

setInterval(
  () => {
    cleanupOrphanPurchaseImages().catch(() => undefined);
  },
  6 * 60 * 60 * 1000
);

app.listen(port, () => {
  console.log(`API executando em http://localhost:${port}`);
  startFiscalScheduler();
});