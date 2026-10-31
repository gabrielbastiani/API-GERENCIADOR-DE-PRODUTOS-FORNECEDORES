import { getCnpjEstablishment, isValidCnpj as isValidCnpjAlpha, normalizeCnpj } from "./cnpj-database.service";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const BRASILAPI_CNPJ_URL = "https://brasilapi.com.br/api/cnpj/v1";

const USER_AGENT =
  process.env.PROSPECTING_USER_AGENT ||
  "GerenciadorFornecedores/1.0 (troque-por-seu-email@exemplo.com)";

export type PlaceCategory = "todos" | "atacado" | "fabricas" | "lojas";

export type Place = {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  openingHours: string | null;
  cnpj: string | null;
  osmUrl: string;
};

type CacheEntry = { expires: number; value: unknown };
const cache = new Map<string, CacheEntry>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);

  if (!entry) return null;

  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

function setCache(key: string, value: unknown, ttlMs: number) {
  cache.set(key, { expires: Date.now() + ttlMs, value });

  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export function onlyDigits(value: string | null | undefined) {
  return (value || "").replace(/\D/g, "");
}

export function isValidCnpj(value: string) {
  return isValidCnpjAlpha(value);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------ Geocodificação ----------------------------- */

export async function geocode(query: string) {
  const key = `geo:${query.toLowerCase().trim()}`;
  const cached = getCache<Array<{ label: string; lat: number; lon: number }>>(key);

  if (cached) return cached;

  const url =
    `${NOMINATIM_URL}/search?` +
    new URLSearchParams({
      q: query,
      format: "jsonv2",
      countrycodes: "br",
      limit: "5",
      addressdetails: "0"
    }).toString();

  const response = await fetchWithTimeout(url, {}, 15000);

  if (!response.ok) {
    throw new Error(`Falha ao localizar a cidade (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
  }>;

  const results = data.map((item) => ({
    label: item.display_name,
    lat: Number(item.lat),
    lon: Number(item.lon)
  }));

  setCache(key, results, 24 * 60 * 60 * 1000);

  return results;
}

/* ------------------------------ Busca de lugares --------------------------- */

const CATEGORY_FILTERS: Record<PlaceCategory, string[]> = {
  atacado: ['["shop"="wholesale"]'],
  fabricas: ['["man_made"="works"]', '["industrial"="factory"]'],
  lojas: ['["shop"]'],
  todos: []
};

CATEGORY_FILTERS.todos = [
  ...CATEGORY_FILTERS.atacado,
  ...CATEGORY_FILTERS.fabricas,
  '["shop"]'
];

function buildOverpassQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  category: PlaceCategory
) {
  const filters = CATEGORY_FILTERS[category] || CATEGORY_FILTERS.todos;
  const body = filters
    .map((f) => `nwr${f}["name"](around:${radiusMeters},${lat},${lon});`)
    .join("\n");

  return `[out:json][timeout:20][maxsize:33554432];\n(\n${body}\n);\nout center tags 300;`;
}

function normalizeWebsite(value: string | undefined) {
  if (!value) return null;

  const trimmed = value.trim().split(";")[0].trim();

  if (!trimmed) return null;

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function describeCategory(tags: Record<string, string>) {
  if (tags.shop === "wholesale") return "Atacado";
  if (tags.man_made === "works" || tags.industrial === "factory") {
    return "Fábrica / indústria";
  }
  if (tags.craft) return `Artesão / oficina (${tags.craft.replace(/_/g, " ")})`;
  if (tags.shop) return `Loja (${tags.shop.replace(/_/g, " ")})`;
  return "Empresa";
}

function buildAddress(tags: Record<string, string>) {
  const street = [tags["addr:street"], tags["addr:housenumber"]]
    .filter(Boolean)
    .join(", ");
  const parts = [
    street,
    tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:state"]
  ].filter(Boolean);

  return parts.length ? parts.join(" - ") : null;
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export async function searchPlaces(params: {
  lat: number;
  lon: number;
  radiusKm: number;
  category: PlaceCategory;
}): Promise<Place[]> {
  const { lat, lon, category } = params;
  const radiusKm = Math.min(Math.max(params.radiusKm, 1), 50);
  const radiusMeters = Math.round(radiusKm * 1000);

  const key = `places:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusKm}:${category}`;
  const cached = getCache<Place[]>(key);

  if (cached) return cached;

  const query = buildOverpassQuery(lat, lon, radiusMeters, category);
  let elements: OverpassElement[] | null = null;
  let lastError = "";

  for (let round = 0; round < 2 && !elements; round++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ data: query }).toString()
          },
          22000
        );

        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }

        const data = (await response.json()) as { elements?: OverpassElement[] };
        elements = data.elements || [];
        break;
      } catch (error) {
        lastError =
          error instanceof Error && error.name === "AbortError"
            ? "tempo esgotado"
            : error instanceof Error
              ? error.message
              : "erro desconhecido";
      }
    }
  }

  if (!elements) {
    throw new Error(
      `O serviço de mapas está indisponível ou sobrecarregado (${lastError}). Tente novamente em instantes.`
    );
  }

  const places: Place[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(elLat) || !Number.isFinite(elLon)) continue;

    if (
      tags.shop &&
      /^(supermarket|convenience|hairdresser|beauty|car_repair|bakery|butcher|kiosk|massage|tattoo|laundry)$/.test(
        tags.shop
      )
    ) {
      continue;
    }

    const cnpjCandidate = onlyDigits(
      tags["ref:vatin"] || tags["ref:BR:CNPJ"] || tags["ref:cnpj"]
    );

    places.push({
      id: `${el.type}/${el.id}`,
      name: tags.name,
      category: describeCategory(tags),
      lat: elLat,
      lon: elLon,
      distanceKm: Number(haversineKm(lat, lon, elLat, elLon).toFixed(2)),
      address: buildAddress(tags),
      phone: tags.phone || tags["contact:phone"] || tags["contact:mobile"] || null,
      whatsapp: tags["contact:whatsapp"] || null,
      email: tags.email || tags["contact:email"] || null,
      website: normalizeWebsite(
        tags.website || tags["contact:website"] || tags.url
      ),
      openingHours: tags.opening_hours || null,
      cnpj: cnpjCandidate.length === 14 ? cnpjCandidate : null,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`
    });
  }

  places.sort((a, b) => a.distanceKm - b.distanceKm);

  setCache(key, places, 10 * 60 * 1000);

  return places;
}

/* ------------------------------- Consulta CNPJ ----------------------------- */

export async function lookupCnpj(rawCnpj: string) {
  const cnpj = normalizeCnpj(rawCnpj);

  if (!isValidCnpj(cnpj)) {
    throw new Error("CNPJ inválido. Confira os dígitos verificadores.");
  }

  const key = `cnpj:${cnpj}`;
  const cached = getCache<Record<string, unknown>>(key);
  if (cached) return cached;

  // A API BrasilAPI trabalha com o formato numérico tradicional. Para CNPJs
  // alfanuméricos, usamos a base local importada da Receita Federal.
  if (/[A-Z]/.test(cnpj)) {
    const local = await getCnpjEstablishment(cnpj);
    const result = {
      cnpj,
      razaoSocial: local.corporateName,
      nomeFantasia: local.fantasyName,
      situacao: local.registrationStatus,
      abertura: local.activityStartDate,
      cnae: `${local.mainCnaeCode} - ${local.mainCnaeDescription}`,
      porte: local.companySizeCode,
      naturezaJuridica: local.legalNatureCode,
      endereco: local.address,
      telefone: local.phone,
      email: local.email
    };
    setCache(key, result, 24 * 60 * 60 * 1000);
    return result;
  }

  const response = await fetchWithTimeout(`${BRASILAPI_CNPJ_URL}/${cnpj}`, {}, 20000);

  if (response.status === 404) {
    throw new Error("CNPJ não encontrado na base pública da Receita Federal.");
  }
  if (!response.ok) {
    throw new Error(`Falha ao consultar o CNPJ (HTTP ${response.status}).`);
  }

  const d = (await response.json()) as Record<string, any>;
  const address = [
    [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(" "),
    d.numero,
    d.complemento,
    d.bairro,
    [d.municipio, d.uf].filter(Boolean).join("/"),
    d.cep
  ].filter(Boolean).join(", ");

  const result = {
    cnpj,
    razaoSocial: d.razao_social || null,
    nomeFantasia: d.nome_fantasia || null,
    situacao: d.descricao_situacao_cadastral || null,
    abertura: d.data_inicio_atividade || null,
    cnae: d.cnae_fiscal_descricao ? `${d.cnae_fiscal} - ${d.cnae_fiscal_descricao}` : null,
    porte: d.porte || null,
    naturezaJuridica: d.natureza_juridica || null,
    endereco: address || null,
    telefone: d.ddd_telefone_1 || null,
    email: d.email || null
  };
  setCache(key, result, 24 * 60 * 60 * 1000);
  return result;
}
