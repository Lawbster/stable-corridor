import { normalizeDecimalString } from "../../collector/schema/primitives.js";

const exponentDecimalPattern =
  /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u;

export function atomicToDecimal(
  atomicAmount: string,
  decimals: number
): string {
  if (!/^\d+$/u.test(atomicAmount)) {
    throw new Error(`Invalid atomic amount: ${atomicAmount}`);
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error(`Invalid asset decimals: ${decimals}`);
  }
  if (decimals === 0) {
    return normalizeDecimalString(atomicAmount);
  }
  const padded = atomicAmount.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals);
  return normalizeDecimalString(`${integer}.${fraction}`);
}

export function numberToCanonicalDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid finite decimal: ${value}`);
  }
  const expanded = value.toFixed(18);
  return normalizeDecimalString(expanded);
}

export function normalizeJupiterDecimal(input: string): string {
  const match = exponentDecimalPattern.exec(input);
  if (match === null) {
    throw new Error(`Invalid Jupiter decimal string: ${input}`);
  }
  const [, sign = "", integer = "", fraction = "", rawExponent = "0"] =
    match;
  const exponent = Number.parseInt(rawExponent, 10);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 128) {
    throw new Error(`Jupiter decimal exponent is out of bounds: ${input}`);
  }

  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  let expanded: string;
  if (decimalIndex <= 0) {
    expanded = `0.${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    expanded = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  } else {
    expanded =
      `${digits.slice(0, decimalIndex)}.` +
      digits.slice(decimalIndex);
  }
  const normalized = normalizeDecimalString(
    `${sign === "-" ? "-" : ""}${expanded}`
  );
  if (normalized.length > 256) {
    throw new Error(`Jupiter decimal expansion is too long: ${input}`);
  }
  return normalized;
}
