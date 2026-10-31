import { prisma } from "../../lib/prisma";
import { isValidCnpj, normalizeCnpj } from "../../utils/cnpj";

export { isValidCnpj, normalizeCnpj } from "../../utils/cnpj";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const GEOCODER_USER_AGENT = process.env.PROSPECTING_USER_AGENT?.trim() || "";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function onlyString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result.length ? result : null;
}

function joinPhone(ddd: string | null, phone: string | null): string | null {
  if (!phone) return null;
  return `${ddd || ""}${phone}` || null;
}

function buildAddress(record: {
  streetType: string | null;
  streetName: string | null;
  streetNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  municipality: { name: string };
  uf: string;
}): string {
  const street = [record.streetType, record.streetName].filter(Boolean).join(" ");
  const parts = [
    street ? `${street}${record.streetNumber ? `, ${record.streetNumber}` : ""}` : null,
    record.addressComplement,
    record.neighborhood,
    record.municipality.name,
    record.uf,
    record.postalCode ? `CEP ${record.postalCode}` : null
  ].filter(Boolean);
  return parts.join(" - ");
}

async function getPublishedBatch() {
  const batch = await prisma.cnpjImportBatch.findFirst({
    where: { status: "PUBLISHED" },
    orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }]
  });
  if (!batch) throw new Error("A base da Receita ainda não foi importada. Execute o importador de CNPJ.");
  return batch;
}

export type CnpjSearchFilters = {
  uf?: string;
  municipalities?: string;
  cnae?: string;
  search?: string;
  onlyWithContact?: boolean;
  page?: number;
  limit?: number;
};

export async function searchCnpjEstablishments(filters: CnpjSearchFilters) {
  const batch = await getPublishedBatch();
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(filters.limit) || DEFAULT_LIMIT)));
  const uf = onlyString(filters.uf)?.toUpperCase();
  const municipalities = (filters.municipalities || "").split(",").map((item) => item.trim()).filter(Boolean);
  const cnaes = (filters.cnae || "").split(",").map((item) => item.trim()).filter(Boolean);
  const search = onlyString(filters.search);

  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new Error("UF inválida.");
  if (municipalities.some((code) => !/^\d{4,7}$/.test(code))) throw new Error("Código de município inválido.");
  if (cnaes.some((code) => !/^\d{1,7}$/.test(code))) throw new Error("Código CNAE inválido.");

  const and: any[] = [{ batchId: batch.id }];
  if (uf) and.push({ uf });
  if (municipalities.length) and.push({ municipalityCode: { in: municipalities } });
  if (cnaes.length) {
    and.push({
      OR: cnaes.flatMap((code) => [
        { mainCnaeCode: code },
        { secondaryCnaeCodes: { has: code } }
      ])
    });
  }
  if (search) {
    const normalizedSearch = normalizeCnpj(search);
    const cnpjFilter = /^\d+$/.test(normalizedSearch) || /[A-Z]/.test(normalizedSearch)
      ? (normalizedSearch.length === 14 ? { cnpj: normalizedSearch } : { cnpj: { startsWith: normalizedSearch } })
      : null;
    and.push({
      OR: [
        ...(cnpjFilter ? [cnpjFilter] : []),
        { fantasyName: { contains: search, mode: "insensitive" } },
        { company: { corporateName: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  if (filters.onlyWithContact) {
    and.push({
      OR: [
        { email: { not: null } },
        { phone1: { not: null } },
        { phone2: { not: null } }
      ]
    });
  }

  const where = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.cnpjEstablishment.count({ where }),
    prisma.cnpjEstablishment.findMany({
      where,
      include: {
        company: true,
        mainCnae: true,
        municipality: true
      },
      orderBy: [
        { uf: "asc" },
        { municipalityCode: "asc" },
        { fantasyName: "asc" }
      ],
      skip: (page - 1) * limit,
      take: limit
    })
  ]);

  const cnpjs = rows.map((row) => row.cnpj);
  const geoRows = cnpjs.length
    ? await prisma.cnpjGeoCache.findMany({ where: { cnpj: { in: cnpjs } } })
    : [];
  const geoByCnpj = new Map(geoRows.map((geo) => [geo.cnpj, geo] as const));

  return {
    data: rows.map((row) => {
      const cachedGeo = geoByCnpj.get(row.cnpj);
      const addressFingerprint = makeAddressFingerprint(buildAddress(row));
      const geo = cachedGeo?.addressFingerprint === addressFingerprint ? cachedGeo : null;
      const phone1 = joinPhone(row.ddd1, row.phone1);
      const phone2 = joinPhone(row.ddd2, row.phone2);
      return {
        cnpj: row.cnpj,
        cnpjBase: row.cnpjBase,
        name: row.fantasyName || row.company.corporateName,
        fantasyName: row.fantasyName,
        corporateName: row.company.corporateName,
        registrationStatus: row.registrationStatus,
        registrationStatusDate: row.registrationStatusDate,
        activityStartDate: row.activityStartDate,
        establishmentType: row.establishmentType,
        uf: row.uf,
        municipalityCode: row.municipalityCode,
        municipality: row.municipality.name,
        address: buildAddress(row),
        street: [row.streetType, row.streetName, row.streetNumber].filter(Boolean).join(" "),
        postalCode: row.postalCode,
        phone: phone1 || phone2,
        phone2,
        email: row.email,
        mainCnaeCode: row.mainCnaeCode,
        mainCnaeDescription: row.mainCnae.description,
        secondaryCnaeCodes: row.secondaryCnaeCodes,
        companySizeCode: row.company.companySizeCode,
        legalNatureCode: row.company.legalNatureCode,
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
        geocodedAt: geo?.geocodedAt ?? null
      };
    }),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    competence: batch.competence,
    states: batch.states
  };
}

export async function getCnpjEstablishment(cnpjInput: string) {
  const cnpj = normalizeCnpj(cnpjInput);
  if (!isValidCnpj(cnpj)) throw new Error("Informe um CNPJ válido com 14 caracteres.");
  const batch = await getPublishedBatch();
  const row = await prisma.cnpjEstablishment.findFirst({
    where: { cnpj, batchId: batch.id },
    include: { company: true, mainCnae: true, municipality: true }
  });
  if (!row) throw new Error("CNPJ não encontrado na base importada. Confirme se pertence a uma UF importada e se está ativo.");

  const cachedGeo = await prisma.cnpjGeoCache.findUnique({ where: { cnpj } });
  const currentAddressFingerprint = makeAddressFingerprint(buildAddress(row));
  const geo = cachedGeo?.addressFingerprint === currentAddressFingerprint ? cachedGeo : null;
  const phone = joinPhone(row.ddd1, row.phone1) || joinPhone(row.ddd2, row.phone2);
  return {
    cnpj: row.cnpj,
    cnpjBase: row.cnpjBase,
    name: row.fantasyName || row.company.corporateName,
    fantasyName: row.fantasyName,
    corporateName: row.company.corporateName,
    registrationStatus: row.registrationStatus,
    registrationStatusDate: row.registrationStatusDate,
    activityStartDate: row.activityStartDate,
    establishmentType: row.establishmentType,
    uf: row.uf,
    municipalityCode: row.municipalityCode,
    municipality: row.municipality.name,
    address: buildAddress(row),
    street: [row.streetType, row.streetName, row.streetNumber].filter(Boolean).join(" "),
    postalCode: row.postalCode,
    phone,
    email: row.email,
    mainCnaeCode: row.mainCnaeCode,
    mainCnaeDescription: row.mainCnae.description,
    secondaryCnaeCodes: row.secondaryCnaeCodes,
    companySizeCode: row.company.companySizeCode,
    legalNatureCode: row.company.legalNatureCode,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null
  };
}

export async function searchCnaes(query = "") {
  const term = query.trim();
  const codeTerm = term.replace(/\D/g, "");
  return prisma.cnaeReference.findMany({
    where: term
      ? { OR: [
          ...(codeTerm ? [{ code: { contains: codeTerm } }] : []),
          { description: { contains: term, mode: "insensitive" } }
        ] }
      : undefined,
    orderBy: { code: "asc" },
    take: 80
  });
}

export async function searchMunicipalities(ufInput = "", query = "") {
  const uf = ufInput.trim().toUpperCase();
  const term = query.trim();
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new Error("UF inválida.");
  const batch = await getPublishedBatch();
  return prisma.municipalityReference.findMany({
    where: {
      ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
      establishments: {
        some: {
          batchId: batch.id,
          ...(uf ? { uf } : {})
        }
      }
    },
    select: { code: true, name: true },
    orderBy: { name: "asc" },
    take: 200
  });
}

export async function getCnpjImportStatus() {
  const [published, lastRun] = await Promise.all([
    prisma.cnpjImportBatch.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }]
    }),
    prisma.cnpjImportBatch.findFirst({ orderBy: { startedAt: "desc" } })
  ]);
  return {
    published: published ? {
      id: published.id,
      competence: published.competence,
      states: published.states,
      companiesCount: published.companiesCount,
      establishmentsCount: published.establishmentsCount,
      meiExcludedCount: published.meiExcludedCount,
      finishedAt: published.finishedAt
    } : null,
    lastRun: lastRun ? {
      id: lastRun.id,
      competence: lastRun.competence,
      states: lastRun.states,
      status: lastRun.status,
      errorMessage: lastRun.errorMessage,
      startedAt: lastRun.startedAt,
      finishedAt: lastRun.finishedAt
    } : null
  };
}

let lastNominatimRequestAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();
async function respectNominatimRateLimit() {
  const next = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastNominatimRequestAt = Date.now();
  });
  nominatimQueue = next.catch(() => undefined);
  await next;
}

function makeAddressFingerprint(address: string): string {
  return address.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function geocodeCnpjEstablishment(cnpjInput: string) {
  const cnpj = normalizeCnpj(cnpjInput);
  const establishment = await getCnpjEstablishment(cnpj);
  const address = establishment.address;
  if (!address || establishment.street.trim().length < 4) {
    throw new Error("O estabelecimento não possui logradouro suficiente para localizar sua posição com precisão.");
  }

  const fingerprint = makeAddressFingerprint(address);
  const cached = await prisma.cnpjGeoCache.findUnique({ where: { cnpj } });
  if (cached && cached.addressFingerprint === fingerprint) {
    return { cnpj, latitude: cached.latitude, longitude: cached.longitude, cached: true };
  }

  if (!GEOCODER_USER_AGENT || /exemplo|example|seudominio/i.test(GEOCODER_USER_AGENT)) {
    throw new Error("Configure PROSPECTING_USER_AGENT com o nome da aplicação e um contato válido antes de usar a geocodificação.");
  }

  await respectNominatimRateLimit();
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    street: establishment.street,
    city: establishment.municipality,
    state: establishment.uf,
    ...(establishment.postalCode ? { postalcode: establishment.postalCode } : {}),
    country: "Brasil",
    countrycodes: "br",
    format: "jsonv2",
    limit: "1"
  })}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": GEOCODER_USER_AGENT,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Falha na geocodificação (HTTP ${response.status}).`);
  const result = (await response.json()) as Array<{ lat: string; lon: string }>;
  if (!result.length || !Number.isFinite(Number(result[0].lat)) || !Number.isFinite(Number(result[0].lon))) {
    throw new Error("O endereço não foi localizado pelo serviço de geocodificação.");
  }

  const latitude = Number(result[0].lat);
  const longitude = Number(result[0].lon);
  await prisma.cnpjGeoCache.upsert({
    where: { cnpj },
    create: { cnpj, latitude, longitude, addressFingerprint: fingerprint, provider: "NOMINATIM" },
    update: { latitude, longitude, addressFingerprint: fingerprint, provider: "NOMINATIM", geocodedAt: new Date() }
  });
  return { cnpj, latitude, longitude, cached: false };
}

export async function importCnpjEstablishmentAsSupplier(cnpjInput: string) {
  const establishment = await getCnpjEstablishment(cnpjInput);
  const existingByDocument = await prisma.supplier.findMany({
    select: { id: true, name: true, document: true }
  });
  const normalizedCompanyName = establishment.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const duplicate = existingByDocument.find((supplier) => {
    const sameDocument = normalizeCnpj(supplier.document || "") === establishment.cnpj;
    const normalizedSupplierName = supplier.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return sameDocument || normalizedSupplierName === normalizedCompanyName;
  });
  if (duplicate) {
    return { duplicate: true as const, supplierId: duplicate.id, supplierName: duplicate.name };
  }

  const addressLines = [
    `Origem: Dados Abertos do CNPJ da Receita Federal.`,
    `CNPJ: ${establishment.cnpj}`,
    `Razão social: ${establishment.corporateName}`,
    `CNAE principal: ${establishment.mainCnaeCode} - ${establishment.mainCnaeDescription}`,
    `Situação cadastral: ${establishment.registrationStatus}`,
    `Endereço: ${establishment.address}`
  ];
  const supplier = await prisma.supplier.create({
    data: {
      name: establishment.name,
      document: establishment.cnpj,
      phone: establishment.phone || undefined,
      email: establishment.email || undefined,
      notes: addressLines.join("\n")
    }
  });
  return { duplicate: false as const, supplier };
}
