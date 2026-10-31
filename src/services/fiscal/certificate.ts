import forge from "node-forge";
import { FiscalError } from "./errors";
import { isValidCnpj, normalizeCnpj } from "../../utils/cnpj";

export type LoadedCertificate = {
  keyPem: string;
  certPem: string;
  chainPem: string;
  certBase64: string;
  subjectName: string;
  cnpj: string | null;
  validFrom: Date;
  validTo: Date;
};

export function loadPfx(pfx: Buffer, password: string): LoadedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;

  try {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(pfx.toString("binary"))
    );

    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new FiscalError(
      "Não foi possível abrir o certificado. Verifique o arquivo .pfx e a senha."
    );
  }

  const shrouded =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? [];
  const plain =
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ??
    [];
  const privateKey = [...shrouded, ...plain][0]?.key as
    | forge.pki.rsa.PrivateKey
    | undefined;

  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] ?? [];
  const certs = certBags
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));

  if (!privateKey || certs.length === 0) {
    throw new FiscalError(
      "O arquivo não contém chave privada e certificado válidos."
    );
  }

  const leaf = certs.find(
    (cert) =>
      (cert.publicKey as any).n.toString(16) === (privateKey as any).n.toString(16)
  );

  if (!leaf) {
    throw new FiscalError(
      "Não foi possível identificar o certificado da chave privada."
    );
  }

  const others = certs.filter((cert) => cert !== leaf);
  const commonName = String(leaf.subject.getField("CN")?.value ?? "");
  const normalizedCommonName = normalizeCnpj(commonName);
  const cnpjCandidates = normalizedCommonName.match(/[A-Z0-9]{12}\d{2}/g) ?? [];
  const cnpjMatch = cnpjCandidates.find((candidate) => isValidCnpj(candidate));

  return {
    keyPem: forge.pki.privateKeyToPem(privateKey),
    certPem: forge.pki.certificateToPem(leaf),
    chainPem: [leaf, ...others]
      .map((cert) => forge.pki.certificateToPem(cert))
      .join(""),
    certBase64: forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes()
    ),
    subjectName: commonName,
    cnpj: cnpjMatch ?? null,
    validFrom: leaf.validity.notBefore,
    validTo: leaf.validity.notAfter
  };
}