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
 * OpenRefine reconciler (`pinakes_engine/schema/reconcile.py`), the csid resolver
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
import { EGRESS_POLICY, EGRESS_POLICY_PATH, egressClassFor } from "./egress-policy";

/** The capabilities Pinakes declares — KCB §6's three plus the KFT `finetune` provider. */
export type CapabilityName = "resolve" | "reconcile" | "query" | "finetune";

/**
 * The three capabilities KCB §6 *requires* of Pinakes, in manifest order. `finetune`
 * is deliberately not here: KFT is multi-provider (§9/FT-K), so a `finetune` capability
 * is one Pinakes *may* advertise, not one the bus demands of the authority provider.
 */
export const CAPABILITY_NAMES: readonly CapabilityName[] = ["resolve", "reconcile", "query"] as const;

/** The KFT training capability (`koine/specs/fine-tuning.md` §2). */
export const FINETUNE_CAPABILITY = "finetune";

/**
 * KGP dialect (portability) tiers a knowledge port may declare (`grounding-pack.md` §5).
 * Defined by `egress-policy.ts` — the policy is what fixes the tier Pinakes may publish,
 * so the type travels with it; re-exported here for the modules that already import it
 * from the manifest.
 */
export type { KnowledgeDialect } from "./egress-policy";

/**
 * The record class the KFT `finetune` capability's training data belongs to. Its egress
 * is read out of the policy rather than restated here — see {@link assertFinetuneCapability}.
 */
export const FINETUNE_RECORD_CLASS = "slm-training-corpora";

/** The default world for real-world knowledge (KINP §5). */
export const DEFAULT_WORLD = "pinakes:world:consensus-reality";

/** The entity-`types` wildcard — "every canonical node type" (KCB already uses `*` for `world_pattern`). */
export const ENTITY_TYPE_WILDCARD = "*";

/**
 * KINP entity types that are registered in koine's shared registry
 * (`registry/entity-types.tsv`) but are **not** canonical csid node types, so they
 * resolve through neither `canonical-schema.json` nor the produced entity port.
 * `model` is KFT §5.1's model entity — the thing a `finetune` capability consumes and
 * produces. Keep this list tiny and koine-sourced: it is the escape hatch from the
 * "every entity type is a canonical node type" rule, not a second vocabulary.
 */
export const KINP_ENTITY_TYPES: readonly string[] = ["model"] as const;

/** The KFT §3.1 modality vocabulary (koine `registry/enums/modality.tsv`). */
export const KFT_MODALITIES: readonly string[] = [
  "text-generation",
  "image-text-to-text",
  "video-text-to-text",
  "text-to-image",
  "text-to-video",
] as const;

/** The KFT §3 `method` vocabulary. */
export const KFT_METHODS: readonly string[] = ["sft", "lora", "qlora", "full", "dpo"] as const;

/** The KMI media types a KFT provider may emit weights/exports as (§5.3). */
export const KFT_WEIGHT_MEDIA_TYPES: readonly string[] = [
  "application/vnd.koine.model+safetensors",
  "application/vnd.koine.model+gguf",
  "application/vnd.koine.model+onnx",
  "application/vnd.koine.model+coreml",
  "application/vnd.koine.model+tflite",
] as const;

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
  /** Payload shape, e.g. `base-model` / `finetuned-model` (KFT §2). */
  readonly shape?: string;
  readonly description?: string;
}

/**
 * A port on the media plane — typed by KMI media types (`koine/registry/media-types.tsv`).
 * Pinakes's only media ports are the `finetune` capability's weight/export outputs (KFT §5.3).
 */
export interface MediaPort {
  readonly plane: "media";
  readonly media_types: readonly string[];
  readonly shape?: string;
  readonly description?: string;
}

/** A typed connection point (KCB §2.1) — entity, knowledge, or media plane. */
export type Port = KnowledgePort | EntityPort | MediaPort;

/** One already-built HTTP surface a capability is a wrapper over. */
export interface CapabilitySurface {
  readonly method: "GET" | "POST";
  /** Server-relative route path, e.g. `/api/graph/resolve`. */
  readonly path: string;
  /** Repo-relative path of the merged code that implements it, or a `lugh:`-qualified
   * pointer when the implementation lives in the private lugh repo (the KFT trainer). */
  readonly implementation: string;
  readonly description: string;
  /** Absolute URL — present only on a manifest built for an origin. */
  readonly url?: string;
}

/**
 * How narrow a provider is, and along which axis (KFT §9/FT-K). The registry reads
 * this to break a tie between two providers that both match a job's modality: the
 * MORE specialized one wins. Absent on a general-purpose capability.
 */
export interface CapabilitySpecialization {
  /** `specialized` (a narrow leg) vs `general` (the catch-all provider). */
  readonly provider_class: "specialized" | "general";
  /** The single KFT §3.1 modality this provider accepts. */
  readonly modality: string;
  /** The KFT §3 methods it accepts within that modality. */
  readonly methods: readonly string[];
  /** The egress class every run resolves to (KFT §4.2). Pinakes is `local-only`. */
  readonly egress: string;
  /** What the provider is specialized *for* — the FT-K routing signal. */
  readonly domains: readonly string[];
  /** The general sibling a non-matching job belongs to. */
  readonly general_provider?: string;
  /**
   * Pointer to the admission code that enforces all of the above. A `lugh:` prefix
   * means the private lugh repo (`lugh:pinakes-train-slm`), not a path in this repo —
   * the trainer was extracted by 90-extract-lugh.
   */
  readonly admission?: string;
  readonly description?: string;
}

/** One named, invocable unit (KCB §2). */
export interface Capability {
  readonly name: string;
  readonly description: string;
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
  /** `meter` names the unit `est_units` counts (KFT §2 — `gpu-seconds` for training). */
  readonly cost: { readonly tier: string; readonly est_units: number; readonly meter?: string };
  /** The KCB §5 grant an invocation of this capability requires. */
  readonly x_grant: string;
  /** Present on a narrow provider; the KFT §9/FT-K routing signal. */
  readonly x_specialization?: CapabilitySpecialization;
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

/**
 * The KCB §5 manifest signature block. `alg` is fixed (`ed25519`); `key_id` is null
 * until a key is provisioned. `signature` is a detached base64 Ed25519 signature over
 * the canonical manifest with this `signature` field excluded — server-only code in
 * `server/services/manifest-signing.ts` attaches it, keeping `contracts/` node-builtin-free.
 */
export interface ManifestSigning {
  readonly key_id: string | null;
  readonly alg: string;
  /** Base64 Ed25519 signature; present only on a signed, served manifest. */
  readonly signature?: string;
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
  /**
   * Repo-relative pointer to the egress + dialect policy this manifest's ports are
   * validated against ({@link EGRESS_POLICY_PATH}) — a pointer, never a copy.
   */
  readonly egressPolicy: string;
  readonly egressNote: string;
  /** Repo-relative pointer to the participant self-description (`participant.json`). */
  readonly participantDeclaration: string;
  readonly authNote: string;
  /** Why the `finetune` capability is narrow, and what it complements (KFT §9/FT-K). */
  readonly specializationNote: string;
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
  readonly signing: ManifestSigning;
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

/** The KFT `finetune` capability, when this manifest advertises one. */
export function finetuneCapability(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): Capability | undefined {
  return manifest.capabilities.find((c) => c.name === FINETUNE_CAPABILITY);
}

/**
 * The specialization block a router breaks an FT-K tie on, or `undefined` for a
 * capability that declares none (which the registry reads as "general").
 */
export function capabilitySpecialization(
  name: string,
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): CapabilitySpecialization | undefined {
  return manifest.capabilities.find((c) => c.name === name)?.x_specialization;
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
  const { mcp, a2a } = CAPABILITY_MANIFEST.endpoints;
  return {
    ...CAPABILITY_MANIFEST,
    endpoints: {
      ...CAPABILITY_MANIFEST.endpoints,
      http: absolutize(origin, CAPABILITY_MANIFEST.endpoints.http),
      manifest: absolutize(origin, CAPABILITY_MANIFEST.endpoints.manifest),
      // The MCP tools surface and the A2A agent-card are dialable fronts too, so a
      // registry entry that lists them must carry absolute URLs — null stays null.
      mcp: mcp ? absolutize(origin, mcp) : mcp,
      a2a: a2a ? absolutize(origin, a2a) : a2a,
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
      // A koine-registered, non-canonical KINP type (`model`) resolves here rather
      // than through `canonical-schema.json` — see {@link KINP_ENTITY_TYPES}.
      if (KINP_ENTITY_TYPES.includes(type)) continue;
      if (!nodeTypeByName(type)) {
        throw new Error(`capability-manifest: ${where} entity port names unknown type "${type}"`);
      }
    }
    return;
  }
  if (port.plane === "media") {
    if (port.media_types.length === 0) {
      throw new Error(`capability-manifest: ${where} media port declares no media_types`);
    }
    for (const mediaType of port.media_types) {
      if (!isNonEmptyString(mediaType) || !mediaType.includes("/")) {
        throw new Error(
          `capability-manifest: ${where} media port names malformed media type "${String(mediaType)}"`,
        );
      }
    }
    return;
  }
  if (port.plane !== "knowledge") {
    throw new Error(`capability-manifest: ${where} port has unknown plane "${(port as Port).plane}"`);
  }
  // Pinakes emits and accepts reference data only; a horn-safe/full-prolog port would
  // cross the dialect tier this project publishes under (KGP §5). The tier is NOT a
  // literal here — it is read from the egress policy, which is the one in-repo source
  // of truth for it, so widening a port means changing the policy first.
  if (port.dialect !== undefined && port.dialect !== EGRESS_POLICY.knowledgeDialect) {
    throw new Error(
      `capability-manifest: ${where} knowledge port declares dialect "${port.dialect}" — ${EGRESS_POLICY_PATH} declares Pinakes ports ${EGRESS_POLICY.knowledgeDialect}`,
    );
  }
  for (const world of port.worlds ?? []) {
    if (!world.startsWith("pinakes:world:")) {
      throw new Error(`capability-manifest: ${where} knowledge port names foreign world "${world}"`);
    }
  }
}

function entityPortWith(ports: readonly Port[], type: string): EntityPort | undefined {
  return ports.find((p): p is EntityPort => p.plane === "entity" && p.types.includes(type));
}

/**
 * Validate the `finetune` capability against KFT §2 and the specialization the
 * program (§9/FT-K) assigns Pinakes: a NARROW provider, not a general trainer.
 *
 * The point of the extra checks is that a `finetune` entry which quietly widened —
 * a second modality, a `full`/`dpo` method lugh's admission code refuses, an
 * `exportable` egress the §4.2 gate would never grant — would make the registry
 * route jobs here that admission then rejects. Validate the advertisement against
 * what lugh's `pinakes-train-slm --kft-job` admission actually admits.
 */
function assertFinetuneCapability(cap: Capability): void {
  const where = `capability "${cap.name}"`;
  const spec = cap.x_specialization;
  if (!spec) {
    throw new Error(
      `capability-manifest: ${where} must declare x_specialization — KFT §9/FT-K breaks a multi-provider tie on it`,
    );
  }
  if (spec.provider_class !== "specialized") {
    throw new Error(
      `capability-manifest: ${where} must be a "specialized" provider (agora hosts the general trainer — KFT §9), got "${spec.provider_class}"`,
    );
  }
  if (!KFT_MODALITIES.includes(spec.modality)) {
    throw new Error(
      `capability-manifest: ${where} names unknown KFT §3.1 modality "${spec.modality}"`,
    );
  }
  if (spec.methods.length === 0) {
    throw new Error(`capability-manifest: ${where} declares no KFT §3 methods`);
  }
  for (const method of spec.methods) {
    if (!KFT_METHODS.includes(method)) {
      throw new Error(`capability-manifest: ${where} names unknown KFT §3 method "${method}"`);
    }
  }
  // The advertised egress is the egress policy's class for the training corpora, read
  // from the policy rather than restated: the SLM corpora are containment-gated there,
  // so the §4.2 gate refuses cross-boundary compute for every run.
  const trainingEgress = egressClassFor(FINETUNE_RECORD_CLASS);
  if (spec.egress !== trainingEgress) {
    throw new Error(
      `capability-manifest: ${where} must advertise egress "${trainingEgress}" — ${EGRESS_POLICY_PATH} classifies "${FINETUNE_RECORD_CLASS}" that way, got "${spec.egress}"`,
    );
  }
  if (spec.domains.length === 0) {
    throw new Error(
      `capability-manifest: ${where} declares no specialization domains — the FT-K routing signal would be empty`,
    );
  }
  if (cap.cost.meter !== "gpu-seconds") {
    throw new Error(
      `capability-manifest: ${where} must meter cost in "gpu-seconds" (KFT §2), got "${String(cap.cost.meter)}"`,
    );
  }
  // Ports: a base-model entity in, data in, a finetuned-model entity + weights out.
  if (!entityPortWith(cap.inputs, "model")) {
    throw new Error(`capability-manifest: ${where} needs a base-model entity input port (KFT §2)`);
  }
  if (!cap.inputs.some((p) => p.plane === "knowledge" || p.plane === "media")) {
    throw new Error(
      `capability-manifest: ${where} needs a knowledge or media training-set input port (KFT §2)`,
    );
  }
  if (!entityPortWith(cap.outputs, "model")) {
    throw new Error(
      `capability-manifest: ${where} needs a finetuned-model entity output port (KFT §5.1)`,
    );
  }
  const weights = cap.outputs.find((p): p is MediaPort => p.plane === "media");
  if (!weights) {
    throw new Error(`capability-manifest: ${where} needs a weights media output port (KFT §5.3)`);
  }
  for (const mediaType of weights.media_types) {
    if (!KFT_WEIGHT_MEDIA_TYPES.includes(mediaType)) {
      throw new Error(
        `capability-manifest: ${where} weights port names non-KMI media type "${mediaType}" (koine registry/media-types.tsv)`,
      );
    }
  }
}

/**
 * Validate the live manifest against the KCB §2 shape and the vocabularies it
 * borrows: canonical node types (totality on the produced entity port), the three
 * §6 capability names, one grant per capability, and at least one already-built
 * surface behind every capability — the check that keeps this a wrapper rather than
 * letting a capability be declared with nothing behind it. A declared `finetune`
 * capability gets the extra KFT §2/§9 narrowness checks on top.
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
  // The manifest does not decide its own egress/dialect — it names the policy that
  // does. A manifest pointing somewhere else would be advertising against a document
  // nothing validates it with.
  if (manifest.x_pinakes.egressPolicy !== EGRESS_POLICY_PATH) {
    throw new Error(
      `capability-manifest: x_pinakes.egressPolicy must be "${EGRESS_POLICY_PATH}", got "${String(manifest.x_pinakes.egressPolicy)}"`,
    );
  }
  for (const key of ["http", "manifest"] as const) {
    if (!isNonEmptyString(manifest.endpoints?.[key])) {
      throw new Error(`capability-manifest: endpoints.${key} must be a non-empty string`);
    }
  }
  // The MCP / A2A fronts are optional (null until stood up), but a *populated* one must be
  // a server-relative path (leading "/") — the same shape as an `x_surfaces` path, so the
  // serving layer can absolutize it against an origin. An absolute URL here would be
  // double-absolutized (or point off-origin) when a registry entry is built.
  for (const key of ["mcp", "a2a"] as const) {
    const value = manifest.endpoints?.[key];
    if (value === null || value === undefined) continue;
    if (!isNonEmptyString(value) || !value.startsWith("/")) {
      throw new Error(
        `capability-manifest: endpoints.${key} must be null or a server-relative path (leading "/"), got "${String(value)}"`,
      );
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
    if (cap.name === FINETUNE_CAPABILITY) assertFinetuneCapability(cap);
  }
  for (const grant of manifest.auth.grants_required) {
    if (!names.includes(grant.replace(/^invoke:/, ""))) {
      throw new Error(`capability-manifest: grant "${grant}" names no declared capability`);
    }
  }
  if (!isNonEmptyString(manifest.signing?.alg)) {
    throw new Error("capability-manifest: signing.alg must be a non-empty string");
  }
  // KCB §5 signing is optional (`key_id: null` = unsigned), but once a key is provisioned
  // the id must be a non-empty string paired with the (already-required) non-empty `alg`,
  // so a consumer can name the key it verifies against.
  if (manifest.signing.key_id !== null && !isNonEmptyString(manifest.signing.key_id)) {
    throw new Error(
      "capability-manifest: a populated signing.key_id must be a non-empty string paired with a non-empty alg",
    );
  }
}

/** Whether the manifest is signed — false until an Ed25519 key is provisioned (KCB §5). */
export function isManifestSigned(manifest: CapabilityManifest = CAPABILITY_MANIFEST): boolean {
  return isNonEmptyString(manifest.signing.key_id);
}
