import multer from "multer";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const storage = multer.memoryStorage();

export const productImageUpload = multer({
  storage,
  limits: {
    files: 10,
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(
        new Error("A imagem deve estar no formato JPG, PNG ou WEBP.")
      );
      return;
    }

    callback(null, true);
  }
});