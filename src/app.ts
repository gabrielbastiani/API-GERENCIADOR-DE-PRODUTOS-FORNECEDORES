import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import dotenv from "dotenv";

import supplierRoutes from "./routes/supplier.routes";
import catalogRoutes from "./routes/catalog.routes";
import productRoutes from "./routes/product.routes";
import researchRoutes from "./routes/marketplace-research.routes";
import commercialTransactionRoutes from "./routes/commercial-transaction.routes";
import { errorMiddleware } from "./middlewares/error.middleware";

dotenv.config();

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(morgan("dev"));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

const storageDirectory = path.resolve(
  process.env.UPLOAD_DIRECTORY || "./storage/catalogs"
);

app.use(
  "/uploads/catalogs",
  express.static(storageDirectory)
);

const storageRoot = path.resolve(
  process.env.STORAGE_DIRECTORY || "./storage"
);

app.use(
  "/storage",
  express.static(storageRoot)
);

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "catalog-manager-api",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/suppliers", supplierRoutes);
app.use("/api", catalogRoutes);
app.use("/api/products", productRoutes);
app.use("/api", researchRoutes);
app.use("/api/transactions", commercialTransactionRoutes);

app.use((_request, response) => {
  response.status(404).json({
    message: "Rota não encontrada."
  });
});

app.use(errorMiddleware);

export default app;