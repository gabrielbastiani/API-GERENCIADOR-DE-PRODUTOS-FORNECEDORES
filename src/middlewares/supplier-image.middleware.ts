import multer from "multer";

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
];

const storage = multer.memoryStorage();

export const supplierImageUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      callback(
        new Error(
          "Formato de imagem inválido. Use JPG, PNG, WEBP ou GIF."
        )
      );
      return;
    }

    callback(null, true);
  }
});