import multer from "multer";

export const catalogUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype !== "application/pdf") {
      callback(new Error("O catálogo deve ser um arquivo PDF."));
      return;
    }

    callback(null, true);
  }
});