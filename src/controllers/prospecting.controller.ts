import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  geocode,
  lookupCnpj,
  searchPlaces,
  PlaceCategory
} from "../services/prospecting/prospecting.service";
import {
  getCnpjEstablishment,
  getCnpjImportStatus,
  geocodeCnpjEstablishment,
  importCnpjEstablishmentAsSupplier,
  isValidCnpj,
  normalizeCnpj,
  searchCnaes,
  searchCnpjEstablishments,
  searchMunicipalities
} from "../services/prospecting/cnpj-database.service";

const VALID_CATEGORIES: PlaceCategory[] = ["todos", "atacado", "fabricas", "lojas"];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function companiesController(req: Request, res: Response) {
  try {
    const result = await searchCnpjEstablishments({
      uf: String(req.query.uf || ""),
      municipalities: String(req.query.municipalities || ""),
      cnae: String(req.query.cnae || ""),
      search: String(req.query.search || ""),
      onlyWithContact: String(req.query.onlyWithContact || "false") === "true",
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 20)
    });
    return res.json(result);
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("ainda não foi importada") ? 503 : 400;
    return res.status(status).json({ message });
  }
}

export async function companyDetailsController(req: Request, res: Response) {
  try {
    const result = await getCnpjEstablishment(req.params.cnpj || "");
    return res.json(result);
  } catch (error) {
    return res.status(404).json({ message: errorMessage(error) });
  }
}

export async function companyGeocodeController(req: Request, res: Response) {
  try {
    const result = await geocodeCnpjEstablishment(req.params.cnpj || "");
    return res.json(result);
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("não foi localizado") ? 422 : 400;
    return res.status(status).json({ message });
  }
}

export async function companyImportController(req: Request, res: Response) {
  try {
    const result = await importCnpjEstablishmentAsSupplier(req.params.cnpj || "");
    if (result.duplicate) {
      return res.status(409).json({
        message: `Esta empresa já está cadastrada como fornecedor: ${result.supplierName}.`,
        supplierId: result.supplierId
      });
    }
    return res.status(201).json(result.supplier);
  } catch (error) {
    return res.status(400).json({ message: errorMessage(error) });
  }
}

export async function cnaesController(req: Request, res: Response) {
  try {
    return res.json(await searchCnaes(String(req.query.q || "")));
  } catch (error) {
    return res.status(400).json({ message: errorMessage(error) });
  }
}

export async function municipalitiesController(req: Request, res: Response) {
  try {
    return res.json(await searchMunicipalities(
      String(req.query.uf || ""),
      String(req.query.q || "")
    ));
  } catch (error) {
    return res.status(400).json({ message: errorMessage(error) });
  }
}

export async function importStatusController(_req: Request, res: Response) {
  try {
    return res.json(await getCnpjImportStatus());
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
}

// Rotas de compatibilidade com a tela antiga. Podem ser removidas depois da migração.
export async function geocodeController(req: Request, res: Response) {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.status(400).json({ message: "Informe ao menos 3 letras da cidade." });
  try {
    return res.json(await geocode(q));
  } catch (error) {
    return res.status(502).json({ message: errorMessage(error) });
  }
}

export async function placesController(req: Request, res: Response) {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const radiusKm = Number(req.query.radiusKm || 10);
  const category = String(req.query.category || "todos") as PlaceCategory;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ message: "Coordenadas inválidas." });
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ message: "Categoria inválida." });
  try {
    return res.json(await searchPlaces({ lat, lon, radiusKm, category }));
  } catch (error) {
    return res.status(502).json({ message: errorMessage(error) });
  }
}

export async function cnpjController(req: Request, res: Response) {
  try {
    return res.json(await lookupCnpj(String(req.params.cnpj || "")));
  } catch (error) {
    return res.status(400).json({ message: errorMessage(error) });
  }
}

export async function importSupplierController(req: Request, res: Response) {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const document = normalizeCnpj(String(body.document || ""));
  if (!name) return res.status(400).json({ message: "Informe o nome do fornecedor." });
  if (body.document && !isValidCnpj(document)) return res.status(400).json({ message: "CNPJ inválido. Confira os 14 caracteres e os dígitos verificadores." });

  const existing = await prisma.supplier.findMany({
    select: { id: true, name: true, document: true }
  });
  const duplicate = existing.find((supplier) => {
    const sameDocument = document.length === 14 && normalizeCnpj(supplier.document || "") === document;
    const sameName = normalizeName(supplier.name) === normalizeName(name);
    return sameDocument || sameName;
  });
  if (duplicate) {
    return res.status(409).json({
      message: `Já existe um fornecedor parecido cadastrado: ${duplicate.name}.`,
      supplierId: duplicate.id
    });
  }

  const data: Record<string, unknown> = { name };
  if (document) data.document = document;
  if (body.phone) data.phone = String(body.phone);
  if (body.email) data.email = String(body.email);
  if (body.website) data.website = String(body.website);
  if (body.contactName) data.contactName = String(body.contactName);
  if (body.notes) data.notes = String(body.notes);

  try {
    const supplier = await prisma.supplier.create({ data: data as any });
    return res.status(201).json(supplier);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
}
