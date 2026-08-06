import { describe, expect, it } from "vitest";

import {
  normalizeJupiterDecimal
} from "../../src/venues/jupiter/amounts.js";

describe("Jupiter decimal normalization", () => {
  it.each([
    ["2.8e-7", "0.00000028"],
    ["-2.8E-7", "-0.00000028"],
    ["1.2300e+2", "123"],
    ["0001e-2", "0.01"],
    ["0e-100", "0"]
  ])("expands %s exactly as %s", (input, expected) => {
    expect(normalizeJupiterDecimal(input)).toBe(expected);
  });

  it("rejects malformed and unbounded exponents", () => {
    expect(() => normalizeJupiterDecimal("NaN")).toThrow();
    expect(() => normalizeJupiterDecimal("1e1000")).toThrow(
      /out of bounds/iu
    );
  });
});

