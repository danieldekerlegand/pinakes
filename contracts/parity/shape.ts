/**
 * Structural response shapes for the Express → FastAPI parity baseline
 * (tasks/chief/30-api-shell-parity.json US-1).
 *
 * A parity fixture records what a response *looks like*, not what it *contains*:
 * the corpus grows, ids churn, and counts drift, so asserting on values would make
 * the gate a liability. `describeShape` reduces a JSON body to a `TypeShape` tree
 * and `matchShape` checks a candidate body against it.
 *
 * The rules are deliberately asymmetric — this is a *port* gate, not an equality
 * check, so a ported handler may return MORE than the baseline but never less:
 *
 * - extra object properties pass (a client reading the baseline's keys still works);
 * - a property the baseline always carried is REQUIRED;
 * - a property the baseline carried only sometimes (`optional`) may be absent;
 * - an empty array passes against a baseline array with items (that is a data
 *   difference, not a shape difference) unless `requireNonEmptyArrays` is set;
 * - a baseline `null` matches anything, because a recorded null tells us nothing
 *   about the field's type.
 *
 * Pure: no fs, no network, no clock. Unit-tested in `shape.test.ts`.
 */

export type TypeShape =
  | { kind: "null" }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "unknown" }
  | { kind: "array"; items: TypeShape | null }
  | { kind: "object"; properties: Record<string, TypeShape>; optional?: string[] }
  | { kind: "union"; of: TypeShape[] };

export interface MatchOptions {
  /** Fail when the baseline recorded a non-empty array and the candidate returns `[]`. */
  requireNonEmptyArrays?: boolean;
  /** Report properties the candidate adds beyond the baseline (never a failure). */
  reportExtraProperties?: boolean;
}

export interface ShapeMismatch {
  /** JSON-pointer-ish path into the body, e.g. `$.results[].name`. */
  path: string;
  expected: string;
  actual: string;
  /** `extra` findings are informational — they never fail a comparison. */
  severity: "error" | "info";
}

const PRIMITIVE_KINDS = new Set(["string", "number", "boolean"]);

/** Reduce a parsed JSON value to its structural shape. */
export function describeShape(value: unknown): TypeShape {
  if (value === null || value === undefined) return { kind: "null" };
  if (Array.isArray(value)) {
    let items: TypeShape | null = null;
    for (const entry of value) {
      const shape = describeShape(entry);
      items = items === null ? shape : mergeShapes(items, shape);
    }
    return { kind: "array", items };
  }
  if (typeof value === "object") {
    const properties: Record<string, TypeShape> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = describeShape(entry);
    }
    return { kind: "object", properties };
  }
  if (typeof value === "string") return { kind: "string" };
  if (typeof value === "number") return { kind: "number" };
  if (typeof value === "boolean") return { kind: "boolean" };
  return { kind: "unknown" };
}

/**
 * Combine two observed shapes into one that describes both — how a heterogeneous
 * array (or a repeated recording of the same endpoint) collapses to a single
 * baseline. Keys present in only one side become `optional`.
 */
export function mergeShapes(a: TypeShape, b: TypeShape): TypeShape {
  if (a.kind === "unknown") return b;
  if (b.kind === "unknown") return a;
  if (a.kind === "null") return b.kind === "null" ? a : unionOf([a, b]);
  if (b.kind === "null") return unionOf([a, b]);

  if (a.kind === "union" || b.kind === "union") {
    const branches = [...branchesOf(a), ...branchesOf(b)];
    return unionOf(branches);
  }
  if (a.kind !== b.kind) return unionOf([a, b]);

  if (a.kind === "array" && b.kind === "array") {
    if (a.items === null) return b;
    if (b.items === null) return a;
    return { kind: "array", items: mergeShapes(a.items, b.items) };
  }

  if (a.kind === "object" && b.kind === "object") {
    const properties: Record<string, TypeShape> = {};
    const optional = new Set<string>([...(a.optional ?? []), ...(b.optional ?? [])]);
    const keys = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
    for (const key of keys) {
      const left = a.properties[key];
      const right = b.properties[key];
      if (left && right) {
        properties[key] = mergeShapes(left, right);
      } else {
        properties[key] = (left ?? right) as TypeShape;
        optional.add(key);
      }
    }
    const merged: TypeShape = { kind: "object", properties };
    if (optional.size > 0) merged.optional = [...optional].sort();
    return merged;
  }

  return a;
}

function branchesOf(shape: TypeShape): TypeShape[] {
  return shape.kind === "union" ? shape.of : [shape];
}

function unionOf(branches: TypeShape[]): TypeShape {
  const flat: TypeShape[] = [];
  for (const branch of branches.flatMap(branchesOf)) {
    // Collapse structurally identical branches so a union stays readable.
    const existingIndex = flat.findIndex((entry) => entry.kind === branch.kind);
    if (existingIndex === -1) {
      flat.push(branch);
      continue;
    }
    const existing = flat[existingIndex];
    if (existing.kind === "object" || existing.kind === "array") {
      flat[existingIndex] = mergeShapes(existing, branch);
    }
  }
  if (flat.length === 1) return flat[0];
  return { kind: "union", of: flat };
}

/** Human-readable one-liner for a shape, used in mismatch reports. */
export function formatShape(shape: TypeShape): string {
  switch (shape.kind) {
    case "array":
      return `array<${shape.items ? formatShape(shape.items) : "unknown"}>`;
    case "object": {
      const keys = Object.keys(shape.properties).sort();
      const preview = keys.slice(0, 6).join(", ");
      return `object{${preview}${keys.length > 6 ? ", …" : ""}}`;
    }
    case "union":
      return shape.of.map(formatShape).join(" | ");
    default:
      return shape.kind;
  }
}

/**
 * Check a candidate value against a baseline shape. An empty result means the
 * candidate satisfies the baseline; `info` entries never fail a comparison.
 */
export function matchShape(
  expected: TypeShape,
  actual: unknown,
  options: MatchOptions = {},
  path = "$",
): ShapeMismatch[] {
  if (expected.kind === "unknown" || expected.kind === "null") return [];

  if (expected.kind === "union") {
    if (actual === null || actual === undefined) {
      return expected.of.some((branch) => branch.kind === "null")
        ? []
        : [mismatch(path, formatShape(expected), "null")];
    }
    // A `null` branch inside a union means "nullable", not "anything" — testing it
    // against a non-null value would let every union match everything.
    for (const branch of expected.of.filter((entry) => entry.kind !== "null")) {
      if (matchShape(branch, actual, options, path).every((m) => m.severity !== "error")) {
        return [];
      }
    }
    return [mismatch(path, formatShape(expected), describeActual(actual))];
  }

  if (actual === null || actual === undefined) {
    return [mismatch(path, formatShape(expected), "null")];
  }

  if (expected.kind === "array") {
    if (!Array.isArray(actual)) {
      return [mismatch(path, formatShape(expected), describeActual(actual))];
    }
    if (actual.length === 0) {
      return expected.items !== null && options.requireNonEmptyArrays
        ? [mismatch(path, `non-empty ${formatShape(expected)}`, "empty array")]
        : [];
    }
    if (expected.items === null) return [];
    const mismatches: ShapeMismatch[] = [];
    for (const [index, entry] of actual.entries()) {
      mismatches.push(...matchShape(expected.items, entry, options, `${path}[${index}]`));
    }
    return mismatches;
  }

  if (expected.kind === "object") {
    if (typeof actual !== "object" || Array.isArray(actual)) {
      return [mismatch(path, formatShape(expected), describeActual(actual))];
    }
    const candidate = actual as Record<string, unknown>;
    const optional = new Set(expected.optional ?? []);
    const mismatches: ShapeMismatch[] = [];
    for (const [key, propertyShape] of Object.entries(expected.properties)) {
      const present = Object.prototype.hasOwnProperty.call(candidate, key);
      if (!present) {
        if (!optional.has(key)) {
          mismatches.push(mismatch(`${path}.${key}`, formatShape(propertyShape), "missing"));
        }
        continue;
      }
      mismatches.push(...matchShape(propertyShape, candidate[key], options, `${path}.${key}`));
    }
    if (options.reportExtraProperties) {
      for (const key of Object.keys(candidate)) {
        if (!Object.prototype.hasOwnProperty.call(expected.properties, key)) {
          mismatches.push({
            path: `${path}.${key}`,
            expected: "absent in baseline",
            actual: describeActual(candidate[key]),
            severity: "info",
          });
        }
      }
    }
    return mismatches;
  }

  const actualKind = describeActual(actual);
  if (PRIMITIVE_KINDS.has(expected.kind) && actualKind !== expected.kind) {
    return [mismatch(path, expected.kind, actualKind)];
  }
  return [];
}

function mismatch(path: string, expected: string, actual: string): ShapeMismatch {
  return { path, expected, actual, severity: "error" };
}

function describeActual(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Shrink a recorded body to a committable sample: arrays are capped, long strings
 * truncated. The sample is documentation for a porter — the assertion runs off the
 * `shape`, never off this.
 */
export function truncateSample(
  value: unknown,
  options: { maxArrayItems?: number; maxStringLength?: number; maxDepth?: number } = {},
  depth = 0,
): unknown {
  const maxArrayItems = options.maxArrayItems ?? 2;
  const maxStringLength = options.maxStringLength ?? 200;
  const maxDepth = options.maxDepth ?? 6;

  if (depth >= maxDepth) return "…";
  if (typeof value === "string") {
    return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}…` : value;
  }
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, maxArrayItems)
      .map((entry) => truncateSample(entry, options, depth + 1));
    if (value.length > maxArrayItems) kept.push(`…${value.length - maxArrayItems} more`);
    return kept;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = truncateSample(entry, options, depth + 1);
    }
    return out;
  }
  return value;
}
