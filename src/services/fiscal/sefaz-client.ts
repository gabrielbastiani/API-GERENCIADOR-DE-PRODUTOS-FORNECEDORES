import fs from "node:fs";
import https from "node:https";
import zlib from "node:zlib";
import { SignedXml } from "xml-crypto";
import type { LoadedCertificate } from "./certificate";
import { FiscalError } from "./errors";
import { findNode, xmlParser } from "./xml";

const DISTRIBUTION_URL: Record<number, string> = {
  1:
    process.env.SEFAZ_DFE_URL_PROD ??
    "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  2:
    process.env.SEFAZ_DFE_URL_HOM ??
    "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx"
};

const EVENT_URL: Record<number, string> = {
  1:
    process.env.SEFAZ_EVENT_URL_PROD ??
    "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  2:
    process.env.SEFAZ_EVENT_URL_HOM ??
    "https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx"
};

export type DistDoc = { nsu: string; schema: string; xml: string };

export type DistResult = {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  docs: DistDoc[];
};

export type ManifestKind = "CIENCIA" | "CONFIRMACAO";

const EVENTS: Record<ManifestKind, { code: string; description: string }> = {
  CIENCIA: { code: "210210", description: "Ciencia da Operacao" },
  CONFIRMACAO: { code: "210200", description: "Confirmacao da Operacao" }
};

function postSoap(
  url: string,
  action: string,
  body: string,
  certificate: LoadedCertificate
): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const caFile = process.env.SEFAZ_CA_FILE;

    // A cadeia ICP-Brasil não vem no Node por padrão. Sem SEFAZ_CA_FILE, a validação
    // do servidor é relaxada, mas a autenticação do cliente (certificado) continua valendo.
    const agent = new https.Agent({
      key: certificate.keyPem,
      cert: certificate.chainPem,
      ca: caFile ? fs.readFileSync(caFile) : undefined,
      rejectUnauthorized: Boolean(caFile) || process.env.SEFAZ_TLS_STRICT === "true"
    });

    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname,
        method: "POST",
        agent,
        timeout: 60_000,
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");

          if ((response.statusCode ?? 500) >= 400) {
            reject(
              new FiscalError(
                `A SEFAZ respondeu HTTP ${response.statusCode}. ${text.slice(0, 200)}`
              )
            );
            return;
          }

          resolve(text);
        });
      }
    );

    request.on("timeout", () =>
      request.destroy(new Error("Tempo esgotado ao consultar a SEFAZ."))
    );
    request.on("error", (error) =>
      reject(new FiscalError(`Falha de comunicação com a SEFAZ: ${error.message}`))
    );

    request.write(body);
    request.end();
  });
}

export async function distributionQuery(
  certificate: LoadedCertificate,
  params: {
    cnpj: string;
    ufCode: number;
    environment: number;
    ultNSU?: string;
    accessKey?: string;
  }
): Promise<DistResult> {
  const query = params.accessKey
    ? `<consChNFe><chNFe>${params.accessKey}</chNFe></consChNFe>`
    : `<distNSU><ultNSU>${params.ultNSU ?? "000000000000000"}</ultNSU></distNSU>`;

  const inner =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${params.environment}</tpAmb>` +
    `<cUFAutor>${params.ufCode}</cUFAutor>` +
    `<CNPJ>${params.cnpj}</CNPJ>${query}</distDFeInt>`;

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>${inner}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;

  const responseXml = await postSoap(
    DISTRIBUTION_URL[params.environment],
    "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse",
    envelope,
    certificate
  );

  const parsed = xmlParser.parse(responseXml);
  const ret = findNode(parsed, "retDistDFeInt");

  if (!ret) {
    const fault = findNode(parsed, "Text") ?? findNode(parsed, "faultstring");

    throw new FiscalError(
      `Resposta inesperada da SEFAZ${fault ? `: ${JSON.stringify(fault)}` : "."}`
    );
  }

  const zips: any[] = ret.loteDistDFeInt?.docZip ?? [];

  const docs: DistDoc[] = zips.map((item) => ({
    nsu: String(item["@_NSU"]),
    schema: String(item["@_schema"]),
    xml: zlib
      .gunzipSync(Buffer.from(String(item["#text"]), "base64"))
      .toString("utf8")
  }));

  return {
    cStat: String(ret.cStat),
    xMotivo: String(ret.xMotivo ?? ""),
    ultNSU: String(ret.ultNSU ?? ""),
    maxNSU: String(ret.maxNSU ?? ""),
    docs
  };
}

export async function sendManifestation(
  certificate: LoadedCertificate,
  params: {
    cnpj: string;
    environment: number;
    accessKey: string;
    kind: ManifestKind;
  }
): Promise<{ ok: boolean; cStat: string; message: string }> {
  const event = EVENTS[params.kind];
  const eventId = `ID${event.code}${params.accessKey}01`;
  const dhEvento =
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19) +
    "-03:00";

  const envEvento =
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${Date.now()}</idLote>` +
    `<evento versao="1.00"><infEvento Id="${eventId}">` +
    `<cOrgao>91</cOrgao><tpAmb>${params.environment}</tpAmb>` +
    `<CNPJ>${params.cnpj}</CNPJ><chNFe>${params.accessKey}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento><tpEvento>${event.code}</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>${event.description}</descEvento></detEvento>` +
    `</infEvento></evento></envEvento>`;

  const signature = new SignedXml({
    privateKey: certificate.keyPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificate.certBase64}</X509Certificate></X509Data>`
  });

  signature.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1"
  });

  signature.computeSignature(envEvento, {
    location: {
      reference: "//*[local-name(.)='evento']",
      action: "append"
    }
  });

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `${signature.getSignedXml()}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  const responseXml = await postSoap(
    EVENT_URL[params.environment],
    "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento",
    envelope,
    certificate
  );

  const parsed = xmlParser.parse(responseXml);
  const retEnv = findNode(parsed, "retEnvEvento");

  if (!retEnv) {
    throw new FiscalError("Resposta inesperada da SEFAZ ao registrar o evento.");
  }

  const retEvento = retEnv.retEvento?.[0]?.infEvento;
  const cStat = String(retEvento?.cStat ?? retEnv.cStat);
  const message = String(retEvento?.xMotivo ?? retEnv.xMotivo ?? "");

  // 135 = evento registrado, 136 = registrado sem vinculação, 573 = duplicidade (já manifestada)
  return { ok: ["135", "136", "573"].includes(cStat), cStat, message };
}