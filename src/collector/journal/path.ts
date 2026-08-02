import { isAbsolute, relative, resolve } from "node:path";

import type { NormalizedEventType } from "../schema/events.js";

const safeSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface JournalRoute {
  readonly venue: string;
  readonly product: string;
  readonly eventType: NormalizedEventType;
}

export function assertSafePathSegment(
  value: string,
  label: string
): string {
  if (
    value === "." ||
    value === ".." ||
    !safeSegmentPattern.test(value)
  ) {
    throw new Error(`Unsafe ${label} path segment: ${value}`);
  }
  return value;
}

export function resolveContainedPath(
  root: string,
  ...segments: readonly string[]
): string {
  if (!isAbsolute(root)) {
    throw new Error(`Data root must be absolute: ${root}`);
  }

  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, ...segments);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);

  if (
    relativeTarget === ".." ||
    relativeTarget.startsWith("../") ||
    relativeTarget.startsWith("..\\") ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(`Resolved path escapes data root: ${resolvedTarget}`);
  }

  return resolvedTarget;
}

export function formatUtcDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${timestampMs}`);
  }
  return date.toISOString().slice(0, 10);
}

export function journalDirectory(
  dataRoot: string,
  date: string,
  route: JournalRoute
): string {
  assertSafePathSegment(date, "date");
  assertSafePathSegment(route.venue, "venue");
  assertSafePathSegment(route.product, "product");
  assertSafePathSegment(route.eventType, "event type");

  return resolveContainedPath(
    dataRoot,
    "normalized",
    date,
    route.venue,
    route.product
  );
}

export function journalPartBaseName(
  eventType: NormalizedEventType,
  part: number
): string {
  assertSafePathSegment(eventType, "event type");
  if (!Number.isSafeInteger(part) || part < 1 || part > 999_999) {
    throw new Error(`Invalid journal part number: ${part}`);
  }

  return `${eventType}-${part.toString().padStart(6, "0")}.jsonl`;
}
