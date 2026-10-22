import multer from "multer";

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/xml",
  "text/xml",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);

const allowedExtensions = new Set([
  ".pdf",
  ".xml",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx"
]);

export const commercialDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    const extension = file.originalname
      .toLowerCase()
      .slice(file.originalname.lastIndexOf("."));

    const mimeAllowed = allowedMimeTypes.has(file.mimetype);
    const extensionAllowed = allowedExtensions.has(extension);

    if (!mimeAllowed && !extensionAllowed) {
      callback(
        new Error(
          "Tipo de arquivo não permitido. Envie PDF, XML, imagem ou arquivo de planilha/documento."
        )
      );
      return;
    }

    callback(null, true);
  }
});