import { z } from "zod";

const rawDecimalPattern = /^[+-]?\d+(?:\.\d+)?$/u;
const canonicalDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;
const assetPattern = /^[A-Z0-9][A-Z0-9._]{0,31}$/u;
const canonicalProductPattern =
  /^[A-Z0-9][A-Z0-9._]{0,31}-[A-Z0-9][A-Z0-9._]{0,31}$/u;

export function normalizeDecimalString(input: string): string {
  if (!rawDecimalPattern.test(input)) {
    throw new Error(`Invalid plain decimal string: ${input}`);
  }

  const isNegative = input.startsWith("-");
  const unsigned = input.replace(/^[+-]/u, "");
  const [rawInteger = "0", rawFraction] = unsigned.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/u, "");
  const fraction = rawFraction?.replace(/0+$/u, "");
  const magnitude =
    fraction === undefined || fraction.length === 0
      ? integer
      : `${integer}.${fraction}`;

  if (/^0(?:\.0*)?$/u.test(magnitude)) {
    return "0";
  }

  return isNegative ? `-${magnitude}` : magnitude;
}

function isCanonicalDecimal(value: string): boolean {
  if (!canonicalDecimalPattern.test(value)) {
    return false;
  }

  try {
    return normalizeDecimalString(value) === value;
  } catch {
    return false;
  }
}

export const schemaVersionSchema = z.literal(1);

export const utcEpochMillisecondsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const canonicalDecimalStringSchema = z
  .string()
  .max(256)
  .refine(isCanonicalDecimal, "Expected a canonical plain decimal string");

export const nonNegativeDecimalStringSchema =
  canonicalDecimalStringSchema.refine(
    (value) => !value.startsWith("-"),
    "Expected a non-negative decimal string"
  );

export const positiveDecimalStringSchema =
  nonNegativeDecimalStringSchema.refine(
    (value) => value !== "0",
    "Expected a positive decimal string"
  );

export const assetSchema = z.string().regex(assetPattern);
export const canonicalProductSchema = z
  .string()
  .regex(canonicalProductPattern);
export const nativeProductSchema = z.string().min(1).max(128);
export const venueSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/u);
export const collectorRunIdSchema = z.uuid();
export const connectionIdSchema = z.uuid();
export const venueSequenceSchema = z.string().min(1).max(128).nullable();
export const checksumSchema = z.string().min(1).max(256).nullable();

export type CanonicalDecimalString = z.infer<
  typeof canonicalDecimalStringSchema
>;
