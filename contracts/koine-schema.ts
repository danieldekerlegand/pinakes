/**
 * A tiny JSON Schema (draft 2020-12 subset) checker for validating this repo's
 * documents against koine's published schemas.
 *
 * Koine deliberately ships **shape without validators** ("Validators live downstream
 * per ADR-0001, NOT in koine"), so a participant that wants to prove its
 * self-description conforms has to run the check itself. This is that check. It is
 * intentionally small and reads only the constructs koine's schemas actually use —
 * `type`, `properties`, `additionalProperties`, `required`, `enum`, `const`,
 * `pattern`, `minLength`, `items`, `minItems`, `uniqueItems`, `anyOf`, and `$ref`
 * (local `#/$defs/...` and sibling-file `other.schema.json#/$defs/...`). An unknown
 * keyword is ignored rather than guessed at; a schema that grew one this does not
 * understand is caught by {@link assertSupportedKeywords}, so the checker can never
 * quietly pass a document by not looking.
 *
 * **Test support only.** Like `parity/harness.ts` this touches `node:fs`, so it must
 * never be imported from `web/src` or from a module the client bundles. It is used by
 * the `skipIf`-gated koine-conformance tests, which skip when no sibling checkout is
 * present (`KOINE_ROOT`, else `~/Development/koine`) — the same pattern as the
 * registry-mirror drift gate.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The sibling koine checkout holding the published schemas. */
export function koineRoot(): string {
  return process.env.KOINE_ROOT ?? join(homedir(), "Development", "koine");
}

/** Absolute path of a koine schema, e.g. `participant-self-description.schema.json`. */
export function koineSchemaPath(name: string): string {
  return resolve(koineRoot(), "schemas", name);
}

/** Whether a koine schema is available to validate against. */
export function hasKoineSchema(name: string): boolean {
  return existsSync(koineSchemaPath(name));
}

/** A parsed JSON Schema node. Deliberately untyped beyond "a JSON object". */
type Schema = Record<string, unknown>;

/** The keywords this checker implements. Anything else is a reason to fail loudly. */
const SUPPORTED = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "default",
  "type",
  "properties",
  "additionalProperties",
  "required",
  "enum",
  "const",
  "pattern",
  "minLength",
  "items",
  "minItems",
  "uniqueItems",
  "anyOf",
]);

/** Loads schema files on demand so a `$ref` into a sibling file resolves. */
class SchemaLoader {
  private readonly cache = new Map<string, Schema>();

  constructor(private readonly dir: string) {}

  load(file: string): Schema {
    const abs = resolve(this.dir, file);
    const cached = this.cache.get(abs);
    if (cached) return cached;
    const parsed = JSON.parse(readFileSync(abs, "utf8")) as Schema;
    this.cache.set(abs, parsed);
    return parsed;
  }
}

/** Resolve a `$ref` — `#/$defs/x` in `root`, or `file.json#/$defs/x` in a sibling. */
function deref(ref: string, root: Schema, loader: SchemaLoader): Schema {
  const [file, pointer = ""] = ref.split("#");
  const target = file === "" ? root : loader.load(file);
  let node: unknown = target;
  for (const raw of pointer.split("/").filter(Boolean)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = (node as Record<string, unknown> | undefined)?.[key];
    if (node === undefined) throw new Error(`koine-schema: unresolvable $ref "${ref}"`);
  }
  return node as Schema;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
}

/**
 * Walk a schema and collect every keyword it uses, so a document is never declared
 * conformant against constraints this checker silently skipped.
 */
export function assertSupportedKeywords(schema: Schema, where = "#"): void {
  for (const [key, value] of Object.entries(schema)) {
    if (!SUPPORTED.has(key)) {
      throw new Error(
        `koine-schema: ${where} uses unsupported keyword "${key}" — extend the checker rather than skipping the constraint`,
      );
    }
    if (key === "properties" || key === "$defs") {
      for (const [name, sub] of Object.entries(value as Record<string, Schema>)) {
        assertSupportedKeywords(sub, `${where}/${key}/${name}`);
      }
    } else if (key === "items" || (key === "additionalProperties" && typeof value === "object")) {
      assertSupportedKeywords(value as Schema, `${where}/${key}`);
    } else if (key === "anyOf") {
      (value as Schema[]).forEach((sub, i) => assertSupportedKeywords(sub, `${where}/anyOf/${i}`));
    }
  }
}

function validate(
  value: unknown,
  schema: Schema,
  root: Schema,
  loader: SchemaLoader,
  path: string,
  errors: string[],
): void {
  if (typeof schema.$ref === "string") {
    validate(value, deref(schema.$ref, root, loader), root, loader, path, errors);
    return;
  }

  if (typeof schema.type === "string" && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (typeof value === "string") {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: "${value}" does not match /${schema.pattern}/`);
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: has ${value.length} items, minItems is ${schema.minItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = value.map((v) => JSON.stringify(v));
      if (new Set(seen).size !== seen.length) errors.push(`${path}: items must be unique`);
    }
    if (schema.items) {
      value.forEach((item, i) =>
        validate(item, schema.items as Schema, root, loader, `${path}[${i}]`, errors),
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in object)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(object)) {
      const propertySchema = properties[key];
      if (propertySchema) {
        validate(sub, propertySchema, root, loader, `${path}/${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: additional property "${key}" is not allowed`);
      } else if (typeof schema.additionalProperties === "object") {
        validate(sub, schema.additionalProperties as Schema, root, loader, `${path}/${key}`, errors);
      }
    }
  }
  if (Array.isArray(schema.anyOf)) {
    const branchErrors = (schema.anyOf as Schema[]).map((branch) => {
      const collected: string[] = [];
      validate(value, branch, root, loader, path, collected);
      return collected;
    });
    if (branchErrors.every((e) => e.length > 0)) {
      errors.push(`${path}: matched no anyOf branch (${branchErrors.flat().join("; ")})`);
    }
  }
}

/**
 * Validate a document against a koine schema by file name. Returns every violation,
 * in document order — an empty array is conformance.
 */
export function validateAgainstKoineSchema(document: unknown, schemaName: string): string[] {
  const path = koineSchemaPath(schemaName);
  const loader = new SchemaLoader(dirname(path));
  const schema = loader.load(path);
  assertSupportedKeywords(schema);
  const errors: string[] = [];
  validate(document, schema, schema, loader, "#", errors);
  return errors;
}
