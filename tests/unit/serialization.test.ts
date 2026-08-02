import { describe, expect, it } from "vitest";

import {
  canonicalJsonLine,
  canonicalStringify
} from "../../src/collector/serialization.js";

describe("canonical JSON serialization", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalStringify({
        z: 1,
        a: {
          d: 4,
          b: 2
        },
        list: [{ y: 2, x: 1 }, 3]
      })
    ).toBe('{"a":{"b":2,"d":4},"list":[{"x":1,"y":2},3],"z":1}');
  });

  it("emits exactly one newline for journal records", () => {
    expect(canonicalJsonLine({ b: 2, a: 1 })).toBe('{"a":1,"b":2}\n');
  });

  it("rejects undefined, non-finite, and circular values", () => {
    expect(() => canonicalStringify({ value: undefined })).toThrow();
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalStringify(circular)).toThrow();
  });
});
