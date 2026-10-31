import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { PrismaClient } from "@prisma/client";
import { isValidCnpj } from "../utils/cnpj";

const prisma = new PrismaClient();
const BATCH_SIZE = 750;
const ACTIVE_STATUS_CODES = new Set(["2", "02"]);
const SOURCE_NAME = "RECEITA_FEDERAL";

type CsvRow = string[];
type ArchiveFile = { path: string; name: string };
type InsertFunction<T> = (rows: T[]) => Promise<unknown>;

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function normalizeUfList(value: string): string[] {
  const states = [...new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))];
  if (!states.length || states.some((state) => !/^[A-Z]{2}$/.test(state))) {
    throw new Error("Informe UFs válidas, por exemplo: --ufs RS ou --ufs RS,SC.");
  }
  return states;
}

function getCompetence(directory: string): string {
  const value = getArg("competence") || getArg("competencia") || path.basename(directory);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("A competência precisa estar no formato AAAA-MM, por exemplo 2026-10.");
  }
  return value;
}

function competenceEndDate(competence: string): string {
  const [year, month] = competence.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function valueAt(row: CsvRow, index: number): string {
  return (row[index] ?? "").trim();
}

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

function parseCapitalSocial(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(normalized) ? normalized : undefined;
}

function isActiveMei(row: CsvRow, referenceDate: string): boolean {
  const optedIntoMei = valueAt(row, 4).toUpperCase() === "S";
  if (!optedIntoMei) return false;

  const rawOptionDate = valueAt(row, 5);
  const rawExclusionDate = valueAt(row, 6);
  const optionDate = /^0+$/.test(rawOptionDate) ? "" : rawOptionDate;
  const exclusionDate = /^0+$/.test(rawExclusionDate) ? "" : rawExclusionDate;
  const optedByCompetence = !optionDate || optionDate <= referenceDate;
  const notExcludedByCompetence = !exclusionDate || exclusionDate > referenceDate;
  return optedByCompetence && notExcludedByCompetence;
}

function isActiveEstablishment(row: CsvRow, states: Set<string>): boolean {
  const status = valueAt(row, 5).padStart(2, "0");
  const uf = normalizedCode(valueAt(row, 19));
  return ACTIVE_STATUS_CODES.has(status) && states.has(uf);
}

async function flush<T>(buffer: T[], insert: InsertFunction<T>): Promise<void> {
  if (!buffer.length) return;
  const rows = buffer.splice(0, buffer.length);
  await insert(rows);
}

async function forEachCsvRow(
  stream: NodeJS.ReadableStream,
  onRow: (row: CsvRow) => Promise<void> | void
): Promise<void> {
  const decoder = new StringDecoder("latin1");
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let pendingQuote = false;

  const consume = async (chunk: string) => {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];

      if (inQuotes) {
        if (pendingQuote) {
          if (char === '"') {
            field += '"';
            pendingQuote = false;
            continue;
          }
          inQuotes = false;
          pendingQuote = false;
        } else if (char === '"') {
          pendingQuote = true;
          continue;
        } else {
          field += char;
          continue;
        }
      }

      if (char === '"' && field.length === 0) {
        inQuotes = true;
      } else if (char === ";") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        field = "";
        if (row.some((value) => value.length > 0)) await onRow(row);
        row = [];
      } else {
        field += char;
      }
    }
  };

  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    await consume(typeof chunk === "string" ? chunk : decoder.write(chunk));
  }
  await consume(decoder.end());

  if (pendingQuote) {
    inQuotes = false;
    pendingQuote = false;
  }
  if (inQuotes) throw new Error("Arquivo CSV terminou com um campo entre aspas sem fechamento.");

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value.length > 0)) await onRow(row);
  }
}

function getArchiveCommand(): { command: string; is7z: boolean } {
  const command = process.env.CNPJ_ARCHIVE_BIN || (process.platform === "win32" ? "7z" : "unzip");
  const is7z = /(^|[\\/])7z(?:\.exe)?$/i.test(command) || /7zz/i.test(command);
  return { command, is7z };
}

function listArchiveMembers(archivePath: string): string[] {
  const { command, is7z } = getArchiveCommand();
  try {
    if (is7z) {
      const output = execFileSync(command, ["l", "-slt", archivePath], {
        encoding: "utf8",
        maxBuffer: 12 * 1024 * 1024
      });
      return output
        .split(/\r?\n/)
        .filter((line) => line.startsWith("Path = "))
        .map((line) => line.slice(7).trim())
        .filter((name) => name && name !== archivePath && !name.endsWith("/"));
    }

    const output = execFileSync(command, ["-Z1", archivePath], {
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024
    });
    return output.split(/\r?\n/).map((name) => name.trim()).filter((name) => name && !name.endsWith("/"));
  } catch (error) {
    throw new Error(
      `Não foi possível listar o ZIP ${path.basename(archivePath)}. Verifique se ${command} está instalado e acessível. ${error instanceof Error ? error.message : ""}`
    );
  }
}

async function forEachZipRow(
  archive: ArchiveFile,
  onRow: (row: CsvRow) => Promise<void> | void
): Promise<void> {
  const members = listArchiveMembers(archive.path);
  const member = members.find((name) => !name.endsWith("/"));
  if (!member) throw new Error(`O ZIP ${archive.name} não contém um arquivo de dados.`);

  const { command, is7z } = getArchiveCommand();
  const args = is7z
    ? ["x", "-so", archive.path, member]
    : ["-p", archive.path, member];
  const child: ChildProcess = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  if (!child.stdout || !child.stderr) {
    child.kill();
    throw new Error(`Não foi possível abrir os fluxos de leitura do ZIP ${archive.name}.`);
  }

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  try {
    await forEachCsvRow(child.stdout, onRow);
  } catch (error) {
    child.kill();
    await closed.catch(() => undefined);
    throw error;
  }

  const result = await closed;
  if (result.code !== 0) {
    throw new Error(`Falha ao ler ${archive.name} (${result.code ?? result.signal}): ${stderr}`);
  }
}

async function findArchives(directory: string, matcher: RegExp): Promise<ArchiveFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => ({ name: entry.name, path: path.join(directory, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
}

async function requireSingleArchive(directory: string, name: string): Promise<ArchiveFile> {
  const exact = path.join(directory, name);
  const entries = await readdir(directory, { withFileTypes: true });
  const found = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`Arquivo obrigatório não encontrado: ${exact}`);
  return { name: found.name, path: path.join(directory, found.name) };
}

async function importReferenceFile(
  archive: ArchiveFile,
  insert: (rows: CsvRow[]) => Promise<unknown>
): Promise<number> {
  let count = 0;
  let buffer: CsvRow[] = [];
  await forEachZipRow(archive, async (row) => {
    if (row.length < 2 || !valueAt(row, 0) || !valueAt(row, 1)) return;
    buffer.push([valueAt(row, 0), valueAt(row, 1)]);
    count += 1;
    if (buffer.length >= BATCH_SIZE) await flush(buffer, insert);
  });
  await flush(buffer, insert);
  return count;
}

async function main(): Promise<void> {
  const directory = path.resolve(getArg("dir") || process.env.CNPJ_DATA_DIR || "./data/cnpj/2026-10");
  const competence = getCompetence(directory);
  const states = normalizeUfList(getArg("ufs") || process.env.CNPJ_UFS || "RS");
  const stateSet = new Set(states);
  const referenceDate = getArg("reference-date") || process.env.CNPJ_REFERENCE_DATE || competenceEndDate(competence);
  if (!/^\d{8}$/.test(referenceDate)) {
    throw new Error("A data de referência do MEI precisa estar no formato AAAAMMDD, por exemplo: 20261031.");
  }

  const companyArchives = await findArchives(directory, /^Empresas\d*\.zip$/i);
  const establishmentArchives = await findArchives(directory, /^Estabelecimentos\d*\.zip$/i);
  if (!companyArchives.length) throw new Error("Não encontrei Empresas*.zip na pasta informada.");
  if (!establishmentArchives.length) throw new Error("Não encontrei Estabelecimentos*.zip na pasta informada.");
  const simplesArchive = await requireSingleArchive(directory, "Simples.zip");
  const cnaeArchive = await requireSingleArchive(directory, "Cnaes.zip");
  const municipalityArchive = await requireSingleArchive(directory, "Municipios.zip");

  console.log(`Pasta: ${directory}`);
  console.log(`Competência: ${competence} | UFs: ${states.join(", ")} | referência MEI: ${referenceDate}`);
  console.log(`Arquivos: ${companyArchives.length} Empresas, ${establishmentArchives.length} Estabelecimentos.`);

  const batch = await prisma.cnpjImportBatch.create({
    data: { competence, states, status: "RUNNING", source: SOURCE_NAME }
  });

  let published = false;
  let activeCandidatesCount = 0;
  let meiExcludedCount = 0;
  let companiesCount = 0;
  let establishmentsCount = 0;
  let skippedMissingCompanyCount = 0;
  let skippedInvalidCnpjCount = 0;

  try {
    console.log("1/6 — Carregando tabelas de CNAE e municípios...");
    const cnaeReferenceCount = await importReferenceFile(cnaeArchive, async (rows) => {
      await prisma.cnaeReference.createMany({
        data: rows.map((row) => ({ code: row[0], description: row[1] })),
        skipDuplicates: true
      });
    });
    const municipalityReferenceCount = await importReferenceFile(municipalityArchive, async (rows) => {
      await prisma.municipalityReference.createMany({
        data: rows.map((row) => ({ code: row[0], name: row[1] })),
        skipDuplicates: true
      });
    });
    console.log(`Referências carregadas: ${cnaeReferenceCount} CNAEs e ${municipalityReferenceCount} municípios (incluindo códigos já existentes).`);

    console.log("2/6 — Identificando estabelecimentos ativos nas UFs selecionadas...");
    const targetRoots = new Set<string>();
    for (const archive of establishmentArchives) {
      await forEachZipRow(archive, (row) => {
        if (row.length < 30 || !isActiveEstablishment(row, stateSet)) return;
        const root = normalizedCode(valueAt(row, 0));
        if (!/^[A-Z0-9]{8}$/.test(root)) return;
        targetRoots.add(root);
        activeCandidatesCount += 1;
      });
      console.log(`  ${archive.name}: raízes acumuladas ${targetRoots.size.toLocaleString("pt-BR")}.`);
    }

    if (!targetRoots.size) {
      throw new Error(`Nenhum estabelecimento ativo encontrado para ${states.join(", ")}. Confira a pasta e a competência.`);
    }

    console.log("3/6 — Identificando MEIs atualmente optantes (sem excluir ex-MEIs já desenquadrados)...");
    const meiRoots = new Set<string>();
    await forEachZipRow(simplesArchive, (row) => {
      if (row.length < 7) return;
      const root = normalizedCode(valueAt(row, 0));
      if (targetRoots.has(root) && isActiveMei(row, referenceDate)) meiRoots.add(root);
    });
    meiExcludedCount = meiRoots.size;
    console.log(`Raízes MEI excluídas: ${meiExcludedCount.toLocaleString("pt-BR")}.`);

    console.log("4/6 — Importando dados das pessoas jurídicas elegíveis...");
    const importedRoots = new Set<string>();
    let companyBuffer: Array<{
      cnpjBase: string;
      batchId: string;
      corporateName: string;
      legalNatureCode?: string;
      responsibleQualificationCode?: string;
      capitalSocial?: string;
      companySizeCode?: string;
      federalEntity?: string;
    }> = [];

    const insertCompanies = async (rows: typeof companyBuffer) => {
      await prisma.cnpjCompany.createMany({ data: rows, skipDuplicates: true });
      companiesCount += rows.length;
    };

    for (const archive of companyArchives) {
      await forEachZipRow(archive, async (row) => {
        if (row.length < 7) return;
        const cnpjBase = normalizedCode(valueAt(row, 0));
        const corporateName = valueAt(row, 1);
        if (!/^[A-Z0-9]{8}$/.test(cnpjBase) || !corporateName || !targetRoots.has(cnpjBase) || meiRoots.has(cnpjBase)) return;

        importedRoots.add(cnpjBase);
        companyBuffer.push({
          cnpjBase,
          batchId: batch.id,
          corporateName,
          legalNatureCode: valueAt(row, 2) || undefined,
          responsibleQualificationCode: valueAt(row, 3) || undefined,
          capitalSocial: parseCapitalSocial(valueAt(row, 4)),
          companySizeCode: valueAt(row, 5) || undefined,
          federalEntity: valueAt(row, 6) || undefined
        });

        if (companyBuffer.length >= BATCH_SIZE) await flush(companyBuffer, insertCompanies);
      });
      console.log(`  ${archive.name}: empresas inseridas ${companiesCount.toLocaleString("pt-BR")}.`);
    }
    await flush(companyBuffer, insertCompanies);

    console.log("5/6 — Importando estabelecimentos ativos, já sem MEIs...");
    let establishmentBuffer: Array<Record<string, unknown>> = [];
    const insertEstablishments = async (rows: Array<Record<string, unknown>>) => {
      await prisma.cnpjEstablishment.createMany({ data: rows as never[], skipDuplicates: true });
      establishmentsCount += rows.length;
    };

    for (const archive of establishmentArchives) {
      await forEachZipRow(archive, async (row) => {
        if (row.length < 30 || !isActiveEstablishment(row, stateSet)) return;

        const cnpjBase = normalizedCode(valueAt(row, 0));
        if (!/^[A-Z0-9]{8}$/.test(cnpjBase) || meiRoots.has(cnpjBase)) return;
        if (!importedRoots.has(cnpjBase)) {
          skippedMissingCompanyCount += 1;
          return;
        }

        const rawCnpjOrder = normalizedCode(valueAt(row, 1));
        const cnpjOrder = rawCnpjOrder.padStart(4, "0");
        const cnpjDv = valueAt(row, 2);
        const cnpj = `${cnpjBase}${cnpjOrder}${cnpjDv}`;
        const mainCnaeCode = valueAt(row, 11);
        const municipalityCode = valueAt(row, 20);
        if (!/^[A-Z0-9]{1,4}$/.test(rawCnpjOrder) || !/^\d{2}$/.test(cnpjDv)) return;
        if (!isValidCnpj(cnpj)) {
          skippedInvalidCnpjCount += 1;
          return;
        }
        if (!/^\d{7}$/.test(mainCnaeCode) || !/^\d{4,7}$/.test(municipalityCode)) return;

        establishmentBuffer.push({
          cnpj,
          batchId: batch.id,
          cnpjBase,
          cnpjOrder,
          cnpjDv,
          establishmentType: valueAt(row, 3) || null,
          fantasyName: valueAt(row, 4) || null,
          registrationStatus: valueAt(row, 5).padStart(2, "0"),
          registrationStatusDate: valueAt(row, 6) || null,
          registrationReasonCode: valueAt(row, 7) || null,
          foreignCityName: valueAt(row, 8) || null,
          countryCode: valueAt(row, 9) || null,
          activityStartDate: valueAt(row, 10) || null,
          mainCnaeCode,
          secondaryCnaeCodes: valueAt(row, 12).split(",").map((code) => code.trim()).filter(Boolean),
          streetType: valueAt(row, 13) || null,
          streetName: valueAt(row, 14) || null,
          streetNumber: valueAt(row, 15) || null,
          addressComplement: valueAt(row, 16) || null,
          neighborhood: valueAt(row, 17) || null,
          postalCode: valueAt(row, 18) || null,
          uf: normalizedCode(valueAt(row, 19)),
          municipalityCode,
          ddd1: valueAt(row, 21) || null,
          phone1: valueAt(row, 22) || null,
          ddd2: valueAt(row, 23) || null,
          phone2: valueAt(row, 24) || null,
          faxDdd: valueAt(row, 25) || null,
          faxNumber: valueAt(row, 26) || null,
          email: valueAt(row, 27).toLowerCase() || null,
          specialStatus: valueAt(row, 28) || null,
          specialStatusDate: valueAt(row, 29) || null
        });

        if (establishmentBuffer.length >= BATCH_SIZE) await flush(establishmentBuffer, insertEstablishments);
      });
      console.log(`  ${archive.name}: estabelecimentos inseridos ${establishmentsCount.toLocaleString("pt-BR")}.`);
    }
    await flush(establishmentBuffer, insertEstablishments);

    if (!establishmentsCount) {
      throw new Error("A importação não gerou estabelecimentos. A publicação foi cancelada para preservar a base anterior.");
    }

    console.log("6/6 — Publicando a nova competência...");
    await prisma.$transaction([
      prisma.cnpjImportBatch.updateMany({
        where: { status: "PUBLISHED" },
        data: { status: "SUPERSEDED" }
      }),
      prisma.cnpjImportBatch.update({
        where: { id: batch.id },
        data: {
          status: "PUBLISHED",
          activeCandidatesCount,
          companiesCount,
          establishmentsCount,
          meiExcludedCount,
          skippedMissingCompanyCount,
          finishedAt: new Date()
        }
      })
    ]);
    published = true;

    // A competência anterior só é removida depois que a nova já está publicada.
    // O histórico do lote permanece, mas os registros antigos deixam de ocupar espaço.
    try {
      await prisma.cnpjEstablishment.deleteMany({ where: { batchId: { not: batch.id } } });
      await prisma.cnpjCompany.deleteMany({ where: { batchId: { not: batch.id } } });
    } catch (cleanupError) {
      console.warn("A nova competência foi publicada, mas a limpeza dos dados antigos não terminou:", cleanupError);
    }

    console.log("Importação concluída com sucesso.");
    console.log(JSON.stringify({
      batchId: batch.id,
      competence,
      states,
      activeCandidatesCount,
      meiExcludedCount,
      companiesCount,
      establishmentsCount,
      skippedMissingCompanyCount,
      skippedInvalidCnpjCount
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado durante a importação.";
    if (!published) {
      // Remove os registros parciais do lote com falha, mas mantém seu histórico.
      await prisma.cnpjEstablishment.deleteMany({ where: { batchId: batch.id } }).catch(() => undefined);
      await prisma.cnpjCompany.deleteMany({ where: { batchId: batch.id } }).catch(() => undefined);
      await prisma.cnpjImportBatch.update({
        where: { id: batch.id },
        data: { status: "FAILED", errorMessage: message.slice(0, 8000), finishedAt: new Date() }
      }).catch(() => undefined);
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error("Falha na importação do CNPJ:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
