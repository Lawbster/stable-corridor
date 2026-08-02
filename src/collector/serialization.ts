type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(
  value: unknown,
  ancestors: ReadonlySet<object>
): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values");
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    return value.map((entry) => canonicalize(entry, nextAncestors));
  }

  if (typeof value === "object") {
    if (ancestors.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values");
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON supports plain objects only");
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    const result: Record<string, JsonValue> = {};

    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) {
        throw new TypeError(
          `Canonical JSON does not support undefined at key ${key}`
        );
      }
      result[key] = canonicalize(entry, nextAncestors);
    }

    return result;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function canonicalJsonLine(value: unknown): string {
  return `${canonicalStringify(value)}\n`;
}
