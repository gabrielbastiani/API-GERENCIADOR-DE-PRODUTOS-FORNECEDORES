import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const uploadDirectory =
  process.env.UPLOAD_DIRECTORY || "./storage/catalogs";

if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, uploadDirectory);
  },

  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const randomName = `${Date.now()}-${crypto.randomUUID()}${extension}`;

    callback(null, randomName);
  }
});

const fileFilter: multer.Options["fileFilter"] = (
  _request,
  file,
  callback
) => {
  const isPdf =
    file.mimetype === "application/pdf" ||
    path.extname(file.originalname).toLowerCase() === ".pdf";

  if (!isPdf) {
    callback(new Error("Apenas arquivos PDF são permitidos."));
    return;
  }

  callback(null, true);
};

export const uploadCatalogPdf = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});