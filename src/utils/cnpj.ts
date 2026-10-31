/**
 * Normaliza CNPJ sem destruir letras dos novos identificadores alfanuméricos.
 * O valor é armazenado sem pontuação, mas sempre como texto.
 */
export function normalizeCnpj(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cnpjCharacterValue(character: string): number {
  return character.charCodeAt(0) - 48;
}

function calculateCnpjDigit(base: string, weights: number[]): number {
  const sum = [...base].reduce(
    (total, character, index) => total + cnpjCharacterValue(character) * weights[index],
    0
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Valida CNPJ numérico e alfanumérico conforme a regra oficial módulo 11. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;

  const first = calculateCnpjDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateCnpjDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}
