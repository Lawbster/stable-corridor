import { describe, expect, it } from "vitest";

import {
  canonicalDecimalStringSchema,
  nonNegativeDecimalStringSchema,
  normalizeDecimalString,
  positiveDecimalStringSchema
} from "../../src/collector/schema/primitives.js";

describe("decimal persistence primitives", () => {
  it.each([
    ["0001.2300", "1.23"],
    ["+001", "1"],
    ["-000.5000", "-0.5"],
    ["-0.000", "0"],
    ["0", "0"],
    ["100", "100"]
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeDecimalString(input)).toBe(expected);
  });

  it.each(["1e-3", ".5", "1.", "NaN", "Infinity", ""])(
    "rejects non-plain decimal input %s",
    (input) => {
      expect(() => normalizeDecimalString(input)).toThrow();
    }
  );

  it.each(["0", "1", "-1", "1.23", "-0.5"])(
    "accepts canonical value %s",
    (value) => {
      expect(canonicalDecimalStringSchema.parse(value)).toBe(value);
    }
  );

  it.each(["01", "+1", "1.0", "-0", "1e3"])(
    "rejects non-canonical persisted value %s",
    (value) => {
      expect(canonicalDecimalStringSchema.safeParse(value).success).toBe(false);
    }
  );

  it("distinguishes non-negative and positive values", () => {
    expect(nonNegativeDecimalStringSchema.safeParse("0").success).toBe(true);
    expect(nonNegativeDecimalStringSchema.safeParse("-0.1").success).toBe(
      false
    );
    expect(positiveDecimalStringSchema.safeParse("0").success).toBe(false);
    expect(positiveDecimalStringSchema.safeParse("0.1").success).toBe(true);
  });
});
