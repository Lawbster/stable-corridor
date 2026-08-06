import { normalizeDecimalString } from "../../collector/schema/primitives.js";

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

