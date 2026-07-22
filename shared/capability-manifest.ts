/**
 * The KCB capability manifest — Pinakes's entry on the Koine capability bus
 * (`koine/specs/capability-bus.md` §2), which names Pinakes the *authority
 * provider*: "expose `resolve`/`reconcile`/`query` and KGP snapshot/delta as
 * capabilities".
 *
 * The machine-readable source of truth is {@link ./capability-manifest.json} — one
 * document, versioned on `x_pinakes.manifestVersion`, shaped exactly like KCB §2 so
 * it can be served verbatim. This module imports it, pins its shape, and exposes the
 * accessors the serving layer (`server/routes/capability-bus.ts`) and its tests use.
 *
 * **This is a surface wrapper, never an implementation.** Every capability's
 * `x_surfaces` point at already-built, already-merged code — the Wikidata
 * OpenRefine reconciler (`culturescrape/schema/reconcile.py`), the csid resolver
 * (`server/services/graph-resolver.ts`), the graph query routes, the canonical-TSV
 * and entity-grounding exporters. Nothing here re-implements a reconciler; the
 * manifest only makes those surfaces *discoverable* in KCB terms.
 *
 * Because KCB §3 is route-by-lookup rather than proxy, the registry is a cache over
 * this document and never a dependency: {@link capabilityManifestFor} + the routes
 * that serve it mean a consumer that cannot reach the registry reads the manifest
 * from Pinakes and invokes the same endpoints directly.
 *
 * Structural drift in the JSON breaks `npm run check`; vocabulary drift (an entity
 * port that no longer covers every canonical node type, a capability with no built
 * surface, a grant that names no capability) is caught at runtime by
 * {@link assertValidCapabilityManifest}, which the vitest suite exercises.
 */
import capabilityManifestJson from "./capability-manifest.json";
import { CANONICAL_SCHEMA, nodeTypeByName } from "./canonical-schema";

/** The three capabilities KCB §6 names for Pinakes. */
export type CapabilityName = "resolve" | "reconcile" | "query";

/** The capability names in their manifest order. */
export const CAPABILITY_NAMES: readonly CapabilityName[] = ["resolve", "reconcile", "query"] as const;

/** KGP dialect (portability) tiers a knowledge port may declare (`grounding-pack.md` §5). */
export type KnowledgeDialect = "grounding-only" | "horn-safe" | "full-prolog";

/** The default world for real-world knowledge (KINP §5). */
export const DEFAULT_WORLD = "pinakes:world:consensus-reality";

/** The entity-`types` wildcard — "every canonical node type" (KCB already uses `*` for `world_pattern`). */
export const ENTITY_TYPE_WILDCARD = "*";

/** A port on the knowledge plane — typed by KGP dialect + an optional payload shape. */
export interface KnowledgePort {
  readonly plane: "knowledge";
  readonly dialect?: string;
  readonly shape?: string;
  readonly worlds?: readonly string[];
  readonly x_produced_by?: string;
  readonly description?: string;
}

/** A port on the entity plane — typed by KINP entity types (or {@link ENTITY_TYPE_WILDCARD}). */
export interface EntityPort {
  readonly plane: "entity";
  readonly types: readonly string[];
  readonly description?: string;
}

/** A typed connection point (KCB §2.1). Pinakes declares no media ports. */
export type Port = KnowledgePort | EntityPort;

/** One already-built HTTP surface a capability is a wrapper over. */
export interface CapabilitySurface {
  readonly method: "GET" | "POST";
  /** Server-relative route path, e.g. `/api/graph/resolve`. */
  readonly path: string;
  /** Repo-relative path of the merged code that implements it. */
  readonly implementation: string;
  readonly description: string;
  /** Absolute URL — present only on a manifest built for an origin. */
  readonly url?: string;
}

/** One named, invocable unit (KCB §2). */
export interface Capability {
  readonly name: string;
  readonly description: string;
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
  readonly cost: { readonly tier: string; readonly est_units: number };
  /** The KCB §5 grant an invocation of this capability requires. */
  readonly x_grant: string;
  /** The built routes this capability wraps; the first is the primary. */
  readonly x_surfaces: readonly CapabilitySurface[];
}

/** Where the bus reaches Pinakes. `mcp`/`a2a` are null until those fronts exist. */
export interface CapabilityEndpoints {
  readonly http: string;
  readonly manifest: string;
  readonly mcp: string | null;
  readonly a2a: string | null;
}

/** Pinakes-local metadata carried alongside the spec fields. */
export interface CapabilityManifestMeta {
  readonly manifestVersion: string;
  readonly title: string;
  readonly description: string;
  readonly identityIri: string;
  readonly defaultWorld: string;
  readonly wildcardEntityTypes: string;
  readonly endpointNote: string;
  readonly authNote: string;
  readonly signingNote: string;
}

/** The published KCB §2 manifest. */
export interface CapabilityManifest {
  readonly kcb_version: string;
  readonly identity: string;
  readonly x_pinakes: CapabilityManifestMeta;
  readonly endpoints: CapabilityEndpoints;
  readonly produces: readonly Port[];
  readonly consumes: readonly Port[];
  readonly capabilities: readonly Capability[];
  readonly auth: { readonly scheme: string; readonly grants_required: readonly string[] };
  readonly signing: { readonly key_id: string | null; readonly alg: string };
}

/** The live manifest as authored in `capability-manifest.json`. */
export const CAPABILITY_MANIFEST = capabilityManifestJson as CapabilityManifest;

/** The KINP agent id this manifest publishes under. */
export const RESOLVER_IDENTITY = "pinakes:agent:resolver";

/** Look up one capability by name; `undefined` when absent. */
export function capability(name: string): Capability | undefined {
  return CAPABILITY_MANIFEST.capabilities.find((c) => c.name === name);
}

/** The primary (first) built surface of a capability. */
export function primarySurface(name: string): CapabilitySurface | undefined {
  return capability(name)?.x_surfaces[0];
}

/** Every knowledge port on `produces` (the grounding data Pinakes emits). */
export function producedKnowledgePorts(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): KnowledgePort[] {
  return manifest.produces.filter((p): p is KnowledgePort => p.plane === "knowledge");
}

/** The single entity port on `produces` (the canonical csid namespace). */
export function producedEntityPort(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): EntityPort | undefined {
  return manifest.produces.find((p): p is EntityPort => p.plane === "entity");
}

/** Canonical node type names, in schema order — what the entity port must cover. */
export function canonicalEntityTypes(): string[] {
  return CANONICAL_SCHEMA.nodeTypes.map((t) => t.name);
}

/** Join an origin and a server-relative path into an absolute URL. */
function absolutize(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/**
 * The manifest as published to a registry (or served to a consumer) from `origin`.
 *
 * Endpoints and every capability surface gain an absolute `url`, so a registry entry
 * is directly dialable — KCB §3 hands out *addresses*, and peers then connect
 * straight to them without the registry in the path. With `origin` null the manifest
 * is returned as authored (server-relative), which is what a same-origin client wants.
 */
export function capabilityManifestFor(origin: string | null): CapabilityManifest {
  if (!origin) return CAPABILITY_MANIFEST;
  return {
    ...CAPABILITY_MANIFEST,
    endpoints: {
      ...CAPABILITY_MANIFEST.endpoints,
      http: absolutize(origin, CAPABILITY_MANIFEST.endpoints.http),
      manifest: absolutize(origin, CAPABILITY_MANIFEST.endpoints.manifest),
    },
    capabilities: CAPABILITY_MANIFEST.capabilities.map((c) => ({
      ...c,
      x_surfaces: c.x_surfaces.map((s) => ({ ...s, url: absolutize(origin, s.path) })),
    })),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function assertPort(port: Port, where: string): void {
  if (port.plane === "entity") {
    if (port.types.length === 0) {
      throw new Error(`capability-manifest: ${where} entity port declares no types`);
    }
    for (const type of port.types) {
      if (type === ENTITY_TYPE_WILDCARD) continue;
      if (!nodeTypeByName(type)) {
        throw new Error(`capability-manifest: ${where} entity port names unknown type "${type}"`);
      }
    }
    return;
  }
  if (port.plane !== "knowledge") {
    throw new Error(`capability-manifest: ${where} port has unknown plane "${(port as Port).plane}"`);
  }
  if (port.dialect !== undefined && port.dialect !== "grounding-only") {
    // Pinakes emits and accepts reference data only; a horn-safe/full-prolog port
    // would cross the dialect tier this project is allowed to publish (KGP §5).
    throw new Error(
      `capability-manifest: ${where} knowledge port declares dialect "${port.dialect}" — Pinakes ports are grounding-only`,
    );
  }
  for (const world of port.worlds ?? []) {
    if (!world.startsWith("pinakes:world:")) {
      throw new Error(`capability-manifest: ${where} knowledge port names foreign world "${world}"`);
    }
  }
}

/**
 * Validate the live manifest against the KCB §2 shape and the vocabularies it
 * borrows: canonical node types (totality on the produced entity port), the three
 * §6 capability names, one grant per capability, and at least one already-built
 * surface behind every capability — the check that keeps this a wrapper rather than
 * letting a capability be declared with nothing behind it.
 */
export function assertValidCapabilityManifest(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): void {
  if (!isNonEmptyString(manifest.kcb_version)) {
    throw new Error("capability-manifest: kcb_version must be a non-empty string");
  }
  if (manifest.identity !== RESOLVER_IDENTITY) {
    throw new Error(
      `capability-manifest: identity must be "${RESOLVER_IDENTITY}" (KINP agent id), got "${manifest.identity}"`,
    );
  }
  for (const key of ["manifestVersion", "title", "description", "identityIri"] as const) {
    if (!isNonEmptyString(manifest.x_pinakes?.[key])) {
      throw new Error(`capability-manifest: x_pinakes.${key} must be a non-empty string`);
    }
  }
  if (manifest.x_pinakes.defaultWorld !== DEFAULT_WORLD) {
    throw new Error(`capability-manifest: default world must be "${DEFAULT_WORLD}"`);
  }
  for (const key of ["http", "manifest"] as const) {
    if (!isNonEmptyString(manifest.endpoints?.[key])) {
      throw new Error(`capability-manifest: endpoints.${key} must be a non-empty string`);
    }
  }

  if (manifest.produces.length === 0) {
    throw new Error("capability-manifest: at least one produced port required");
  }
  manifest.produces.forEach((p, i) => assertPort(p, `produces[${i}]`));
  manifest.consumes.forEach((p, i) => assertPort(p, `consumes[${i}]`));

  // The grounding-only knowledge port scoped to consensus reality is the whole point
  // of Pinakes on the bus — a consumer discovers grounding data by matching it.
  const grounding = producedKnowledgePorts(manifest).find((p) =>
    (p.worlds ?? []).includes(DEFAULT_WORLD),
  );
  if (!grounding || grounding.dialect !== "grounding-only") {
    throw new Error(
      `capability-manifest: produces must include a grounding-only knowledge port for ${DEFAULT_WORLD}`,
    );
  }

  // Totality: the produced entity port is the canonical csid namespace, so it must
  // name every canonical node type — a schema addition that is not published here is
  // an entity nobody on the bus can discover.
  const entityPort = producedEntityPort(manifest);
  if (!entityPort) {
    throw new Error("capability-manifest: produces must include the canonical entity port");
  }
  const declared = new Set(entityPort.types);
  for (const type of canonicalEntityTypes()) {
    if (!declared.has(type)) {
      throw new Error(
        `capability-manifest: produced entity port is missing canonical node type "${type}"`,
      );
    }
  }

  const names = manifest.capabilities.map((c) => c.name);
  for (const required of CAPABILITY_NAMES) {
    if (!names.includes(required)) {
      throw new Error(`capability-manifest: KCB §6 requires the "${required}" capability`);
    }
  }
  for (const cap of manifest.capabilities) {
    if (!isNonEmptyString(cap.description)) {
      throw new Error(`capability-manifest: capability "${cap.name}" needs a description`);
    }
    if (cap.inputs.length === 0 || cap.outputs.length === 0) {
      throw new Error(`capability-manifest: capability "${cap.name}" needs inputs and outputs`);
    }
    cap.inputs.forEach((p, i) => assertPort(p, `${cap.name}.inputs[${i}]`));
    cap.outputs.forEach((p, i) => assertPort(p, `${cap.name}.outputs[${i}]`));
    if (!Number.isFinite(cap.cost?.est_units) || !isNonEmptyString(cap.cost?.tier)) {
      throw new Error(`capability-manifest: capability "${cap.name}" needs a {tier, est_units} cost`);
    }
    if (cap.x_grant !== `invoke:${cap.name}`) {
      throw new Error(
        `capability-manifest: capability "${cap.name}" must require grant "invoke:${cap.name}"`,
      );
    }
    if (!manifest.auth.grants_required.includes(cap.x_grant)) {
      throw new Error(`capability-manifest: auth.grants_required is missing "${cap.x_grant}"`);
    }
    if (cap.x_surfaces.length === 0) {
      throw new Error(
        `capability-manifest: capability "${cap.name}" declares no built surface — a manifest entry may only wrap code that exists`,
      );
    }
    for (const surface of cap.x_surfaces) {
      if (!surface.path.startsWith("/")) {
        throw new Error(
          `capability-manifest: "${cap.name}" surface path "${surface.path}" must be server-relative`,
        );
      }
      if (!isNonEmptyString(surface.implementation) || !isNonEmptyString(surface.description)) {
        throw new Error(
          `capability-manifest: "${cap.name}" surface ${surface.path} needs an implementation + description`,
        );
      }
    }
  }
  for (const grant of manifest.auth.grants_required) {
    if (!names.includes(grant.replace(/^invoke:/, ""))) {
      throw new Error(`capability-manifest: grant "${grant}" names no declared capability`);
    }
  }
  if (!isNonEmptyString(manifest.signing?.alg)) {
    throw new Error("capability-manifest: signing.alg must be a non-empty string");
  }
}

/** Whether the manifest is signed — false until an Ed25519 key is provisioned (KCB §5). */
export function isManifestSigned(manifest: CapabilityManifest = CAPABILITY_MANIFEST): boolean {
  return isNonEmptyString(manifest.signing.key_id);
}
