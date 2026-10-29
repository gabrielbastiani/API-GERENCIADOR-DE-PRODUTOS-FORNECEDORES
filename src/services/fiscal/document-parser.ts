import { xmlParser } from "./xml";

export type ParsedDocument =
  | {
      kind: "invoice" | "summary";
      accessKey: string;
      issuerCnpj: string;
      issuerName: string;
      number: string | null;
      series: string | null;
      issuedAt: Date | null;
      totalValue: number;
      cancelled: boolean;
    }
  | { kind: "cancellation"; accessKey: string }
  | { kind: "ignore" };

function toDate(value: unknown) {
  if (!value) {
    return null;
  }

  const date = new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDocument(xml: string): ParsedDocument {
  const root = xmlParser.parse(xml);

  if (root.nfeProc) {
    const inf = root.nfeProc.NFe?.infNFe;
    const prot = root.nfeProc.protNFe?.infProt;

    if (!inf) {
      return { kind: "ignore" };
    }

    const accessKey = String(
      prot?.chNFe ?? String(inf["@_Id"] ?? "").replace(/^NFe/, "")
    );

    return {
      kind: "invoice",
      accessKey,
      issuerCnpj: String(inf.emit?.CNPJ ?? inf.emit?.CPF ?? ""),
      issuerName: String(inf.emit?.xNome ?? ""),
      number: inf.ide?.nNF ? String(inf.ide.nNF) : null,
      series: inf.ide?.serie ? String(inf.ide.serie) : null,
      issuedAt: toDate(inf.ide?.dhEmi ?? inf.ide?.dEmi),
      totalValue: Number(inf.total?.ICMSTot?.vNF ?? 0),
      cancelled: false
    };
  }

  if (root.resNFe) {
    const res = root.resNFe;

    return {
      kind: "summary",
      accessKey: String(res.chNFe),
      issuerCnpj: String(res.CNPJ ?? res.CPF ?? ""),
      issuerName: String(res.xNome ?? ""),
      number: String(res.chNFe).slice(25, 34).replace(/^0+/, "") || null,
      series: String(res.chNFe).slice(22, 25).replace(/^0+/, "") || null,
      issuedAt: toDate(res.dhEmi),
      totalValue: Number(res.vNF ?? 0),
      cancelled: String(res.cSitNFe) === "3"
    };
  }

  const event = root.procEventoNFe?.evento?.infEvento ?? root.resEvento;

  if (event && String(event.tpEvento) === "110111") {
    return { kind: "cancellation", accessKey: String(event.chNFe) };
  }

  return { kind: "ignore" };
}