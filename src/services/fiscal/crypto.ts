import crypto from "node:crypto";
import { FiscalError } from "./errors";

function getKey() {
  const hex = process.env.CERT_ENCRYPTION_KEY ?? "";

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new FiscalError(
      "CERT_ENCRYPTION_KEY não configurada (são necessários 64 caracteres hexadecimais)."
    );
  }

  return Buffer.from(hex, "hex");
}

export function encrypt(plain: Buffer | string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, data].map((part) => part.toString("base64")).join(":");
}

export function decrypt(payload: string): Buffer {
  const [ivB64, tagB64, dataB64] = payload.split(":");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new FiscalError("Dado criptografado inválido.");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivB64, "base64")
    );

    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]);
  } catch {
    throw new FiscalError(
      "Não foi possível descriptografar o certificado. Verifique a CERT_ENCRYPTION_KEY."
    );
  }
}