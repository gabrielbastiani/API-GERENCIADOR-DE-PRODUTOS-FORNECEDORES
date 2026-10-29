import multer from "multer";

export const purchaseImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter(_request, file, callback) {
    callback(
      null,
      ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
    );
  }
});