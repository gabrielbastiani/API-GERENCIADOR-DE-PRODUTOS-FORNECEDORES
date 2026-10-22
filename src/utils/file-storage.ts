import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";

function getStorageRoot() {
  return path.resolve(process.env.STORAGE_DIRECTORY ?? "./storage");
}

function getExtensionFromMimeType(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };

  return extensions[mimeType] ?? ".bin";
}

export async function saveSupplierImage(
  file: Express.Multer.File,
  supplierId: string
) {
  const directory = path.join(getStorageRoot(), "suppliers");

  await fs.mkdir(directory, { recursive: true });

  const fileName = `${supplierId}-${crypto.randomUUID()}${getExtensionFromMimeType(file.mimetype)}`;
  const absolutePath = path.join(directory, fileName);

  await fs.writeFile(absolutePath, file.buffer);

  return absolutePath;
}

export function getSupplierImageUrl(
  request: Request,
  imagePath: string | null
) {
  if (!imagePath) {
    return null;
  }

  return `${request.protocol}://${request.get("host")}/storage/suppliers/${path.basename(imagePath)}`;
}

/**
 * Remove arquivos ou pastas. Nunca lança erro: uma falha ao apagar
 * um arquivo não deve derrubar uma exclusão já concluída no banco.
 */
export async function deleteStoredFiles(
  filePaths: Array<string | null | undefined>
) {
  await Promise.allSettled(
    filePaths
      .filter((filePath): filePath is string => Boolean(filePath))
      .map((filePath) =>
        fs.rm(filePath, { recursive: true, force: true })
      )
  );
}

function getCommercialDocumentExtension(
  originalName: string,
  mimeType: string
) {
  const originalExtension = path.extname(originalName).toLowerCase();

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

  if (allowedExtensions.has(originalExtension)) {
    return originalExtension;
  }

  const mimeExtensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx"
  };

  return mimeExtensions[mimeType] ?? ".bin";
}

export async function saveCommercialDocument(
  file: Express.Multer.File,
  transactionId: string
) {
  const directory = path.join(
    getStorageRoot(),
    "commercial-documents",
    transactionId
  );

  await fs.mkdir(directory, {
    recursive: true
  });

  const extension = getCommercialDocumentExtension(
    file.originalname,
    file.mimetype
  );

  const fileName = `${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(directory, fileName);

  await fs.writeFile(absolutePath, file.buffer);

  return {
    fileName,
    filePath: absolutePath
  };
}

export function getCommercialDocumentUrl(
  request: Request,
  transactionId: string,
  fileName: string
) {
  return `${request.protocol}://${request.get(
    "host"
  )}/storage/commercial-documents/${transactionId}/${encodeURIComponent(
    fileName
  )}`;
}