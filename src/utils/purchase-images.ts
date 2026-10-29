import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "../lib/prisma";

const URL_MARKER = "/uploads/purchases/";
const FILE_NAME_PATTERN = /^[a-f0-9-]{36}\.(jpg|png|webp)$/i;

export function getPurchaseImageDirectory() {
  return path.resolve(
    process.env.PURCHASE_IMAGE_DIRECTORY ?? "./storage/purchases"
  );
}

function fileNameFromUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  const index = url.indexOf(URL_MARKER);

  if (index === -1) {
    return null;
  }

  const name = path.basename(
    url.slice(index + URL_MARKER.length).split("?")[0]
  );

  return FILE_NAME_PATTERN.test(name) ? name : null;
}

async function isReferenced(fileName: string) {
  const found = await prisma.purchaseItem.findFirst({
    where: { imageUrl: { endsWith: fileName } },
    select: { id: true }
  });

  return !!found;
}

/**
 * Apaga os arquivos das URLs informadas, mas somente se nenhum item
 * de compra ainda os utilizar. Só mexe em arquivos desta pasta.
 */
export async function deleteUnusedPurchaseImages(
  urls: Array<string | null | undefined>
) {
  const names = new Set(
    urls
      .map(fileNameFromUrl)
      .filter((name): name is string => name !== null)
  );

  for (const name of names) {
    try {
      if (await isReferenced(name)) {
        continue;
      }

      await fs.unlink(path.join(getPurchaseImageDirectory(), name));
    } catch {
      // arquivo já removido ou inacessível: ignora
    }
  }
}

/**
 * Remove arquivos da pasta que nenhuma compra usa (por exemplo, imagens
 * enviadas e depois substituídas antes de salvar). Só apaga arquivos com
 * mais de "minAgeMs" para não atingir uploads de formulários abertos.
 */
export async function cleanupOrphanPurchaseImages(
  minAgeMs = 60 * 60 * 1000
) {
  const directory = getPurchaseImageDirectory();
  let removed = 0;

  let files: string[] = [];

  try {
    files = await fs.readdir(directory);
  } catch {
    return 0;
  }

  for (const name of files) {
    if (!FILE_NAME_PATTERN.test(name)) {
      continue;
    }

    try {
      const filePath = path.join(directory, name);
      const stat = await fs.stat(filePath);

      if (Date.now() - stat.mtimeMs < minAgeMs) {
        continue;
      }

      if (await isReferenced(name)) {
        continue;
      }

      await fs.unlink(filePath);
      removed += 1;
    } catch {
      // segue para o próximo arquivo
    }
  }

  return removed;
}