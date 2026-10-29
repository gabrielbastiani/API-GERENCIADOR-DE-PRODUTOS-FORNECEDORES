import multer from "multer";

export const purchaseXmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter(_request, file, callback) {
    const isXml =
      file.originalname.toLowerCase().endsWith(".xml") ||
      file.mimetype.includes("xml");

    callback(null, isXml);
  }
});