/**
 * Pinakes as a **self-describing koine participant** — the in-repo source document
 * koine ADR-0007 decision 7 allows, in the shape
 * `koine/schemas/participant-self-description.schema.json` fixes.
 *
 * Koine has no central config store. Everything a peer needs in order to trust and
 * dial Pinakes — the namespace it mints and the fact that it is that namespace's sole
 * minting authority, where its capability manifest and agent-card are, what it will
 * and will not release, and how its vocabulary crosses into the shared one — is
 * published by Pinakes, from this repository and this deployment's own endpoints
 * (`koine/docs/self-describing-participant.md`). Nothing registers it on Pinakes's
 * behalf and no peer reads this file.
 *
 * **This is a source document, not a second manifest.** It carries pointers and
 * references only — never a manifest payload, a mapping's rows, or a node/edge
 * ontology, all of which live in the documents it points at. The *runtime*
 * self-description stays the served AgentCard and its KCB manifest extension; what
 * this document buys is that the served surface can be checked against a declared
 * intent instead of hand-maintained, which is what
 * {@link assertParticipantManifestAgreement} does.
 *
 * The machine-readable source of truth is {@link ./participant.json}. Structural
 * drift breaks `npm run check`; agreement with the capability manifest and the egress
 * policy is checked at runtime by the validators here, which `participant.test.ts`
 * exercises — and, when a sibling koine checkout is present, that suite also validates
 * the document against koine's own schema.
 */
import participantJson from "./participant.json";
import {
  CAPABILITY_MANIFEST,
  producedKnowledgePorts,
  type CapabilityManifest,
} from "./capability-manifest";
import {
  EGRESS_POLICY,
  EGRESS_POLICY_PATH,
  ENFORCED_AT,
  type EgressClass,
  type EgressPolicy,
} from "./egress-policy";

/** The roles a participant may claim (koine ADR-0007 decision 1 — role-scoped). */
export type ParticipantRole = "producer" | "consumer" | "authority" | "host" | "provider";

/** Which direction of data a bridge mapping governs. */
export type MappingDirection = "produces" | "consumes" | "both";

/** The KCB §2.1 port planes a mapping may cross into. */
export type MappingPlane = "knowledge" | "media" | "entity";

/**
 * A pointer to where an artifact lives — a path in *this* repo and/or the URL it is
 * served at. A pointer only: this document never carries the artifact. `note` is the
 * one free-text field, and it is load-bearing for the facts koine's `location` shape
 * has no field for (the well-known path a served surface answers on, say).
 */
export interface ArtifactLocation {
  readonly path?: string;
  readonly url?: string;
  readonly note?: string;
}

/** The identity facet (KINP §3.2–§3.4, §4.4, §6). */
export interface ParticipantIdentity {
  /** The prefix Pinakes mints under — registered by PR in KINP §3.4. */
  readonly namespace: string;
  /** Whether Pinakes is the SOLE minting authority for that prefix. */
  readonly minting_authority?: boolean;
  /** The KINP kinds minted under it (`ent`, `world`, `agent`, `model`). */
  readonly kinds?: readonly string[];
  /** External authority namespaces anchored to — never minted here (KINP §4.4). */
  readonly external_anchors?: readonly string[];
  /** Where the local-id scheme and reconciliation practice are recorded (KINP §6). */
  readonly minting_rules?: ArtifactLocation;
}

/** The capability facet — BY REFERENCE ONLY (KCB §2 owns the payload's shape). */
export interface ParticipantCapability {
  readonly agent_card: ArtifactLocation;
  /** The stable KCB extension URI identifying the manifest on the card. */
  readonly manifest_extension_uri: string;
  /** The in-repo source the served extension params are generated from. */
  readonly manifest_source?: ArtifactLocation;
  readonly mcp?: ArtifactLocation;
}

/** The egress facet (KGP §7.1, §7.2) — by reference; the values live in the policy. */
export interface ParticipantEgress {
  readonly policy: ArtifactLocation;
  readonly default_class?: EgressClass;
  readonly license_policy?: ArtifactLocation;
  readonly enforced_at?: "pack-construction";
}

/** One bridge/predicate mapping document, by location. */
export interface ParticipantMapping {
  readonly direction: MappingDirection;
  readonly location: ArtifactLocation;
  readonly plane?: MappingPlane;
  readonly note?: string;
}

/** The translation facet (KGP §5, §7) — LOCATIONS ONLY, never mapping rows. */
export interface ParticipantTranslation {
  readonly mappings: readonly ParticipantMapping[];
  /** The shared koine relation files a mapping normalizes into. */
  readonly target_registries?: readonly string[];
}

/** How the participant is indexed, if it is (KCB §3 — index, never authority). */
export interface ParticipantDiscovery {
  readonly registries?: readonly ArtifactLocation[];
  /** Restates the invariant: discoverable without being dependent. Always `true`. */
  readonly registry_optional?: true;
}

/** The in-repo self-description. */
export interface ParticipantSelfDescription {
  readonly self_description_version: string;
  /** The KINP id this participant's AgentCard carries as its own agent id. */
  readonly participant: string;
  readonly roles: readonly ParticipantRole[];
  readonly identity: ParticipantIdentity;
  readonly capability: ParticipantCapability;
  readonly egress: ParticipantEgress;
  readonly translation?: ParticipantTranslation;
  readonly discovery?: ParticipantDiscovery;
}

// The JSON import widens every string cell to `string`, so the literal unions above
// (roles, direction, enforced_at) need the assertion + the runtime validator below.
/** The live declaration as authored in `participant.json`. */
export const PARTICIPANT: ParticipantSelfDescription =
  participantJson as ParticipantSelfDescription;

/** The KINP namespace prefix Pinakes mints under, and is the sole authority for. */
export const PINAKES_NAMESPACE = "pinakes";

/** Where the capability manifest lives, repo-relative. */
export const MANIFEST_SOURCE_PATH = "contracts/capability-manifest.json";

/** Where this declaration lives, repo-relative — what the manifest points back at. */
export const PARTICIPANT_PATH = "contracts/participant.json";

/** Every role koine's schema admits (ADR-0007 decision 1). */
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = [
  "producer",
  "consumer",
  "authority",
  "host",
  "provider",
];

/** KINP §3.4: an external authority is anchored to, never minted by a participant. */
const NAMESPACE_PREFIX_RE = /^[a-z0-9][a-z0-9-]*$/;

/** KINP §3.2 CURIE — `namespace:kind:local`. */
const KINP_ID_RE = /^([a-z0-9-]+):([a-z0-9-]+):(\S+)$/;

/** The KCB extension URI family that identifies a manifest on an AgentCard (KCB §2). */
const MANIFEST_EXTENSION_RE = /^https:\/\/koine\.dev\/kcb\/manifest\/\d+\.\d+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The `namespace` / `kind` of a KINP CURIE, or `undefined` when it is not one. */
export function kinpParts(id: string): { namespace: string; kind: string; local: string } | undefined {
  const match = KINP_ID_RE.exec(id);
  if (!match) return undefined;
  return { namespace: match[1], kind: match[2], local: match[3] };
}

/** Whether Pinakes claims a role. */
export function claimsRole(
  role: ParticipantRole,
  declaration: ParticipantSelfDescription = PARTICIPANT,
): boolean {
  return declaration.roles.includes(role);
}

/** The mappings governing a direction (`both` counts for either). */
export function mappingsFor(
  direction: Exclude<MappingDirection, "both">,
  declaration: ParticipantSelfDescription = PARTICIPANT,
): readonly ParticipantMapping[] {
  return (declaration.translation?.mappings ?? []).filter(
    (m) => m.direction === direction || m.direction === "both",
  );
}

function assertLocation(location: ArtifactLocation | undefined, where: string): void {
  if (!location) {
    throw new Error(`participant: ${where} is required`);
  }
  if (!isNonEmptyString(location.path) && !isNonEmptyString(location.url)) {
    throw new Error(`participant: ${where} needs a path or a url — a pointer to nowhere is not one`);
  }
  // ADR-0007 decision 4: no participant reads another participant's repository, so a
  // path here is always relative to THIS repo. An absolute path (or one that climbs
  // out) would be a shared-checkout dependency wearing a pointer's clothes.
  const path = location.path;
  if (path !== undefined && (path.startsWith("/") || path.startsWith("..") || path.includes("://"))) {
    throw new Error(
      `participant: ${where} path "${path}" must be relative to this repo's root — no participant reads another's repository`,
    );
  }
}

/**
 * Validate the declaration against koine's `participant-self-description` shape and
 * the invariants that shape carries in prose: a KINP-shaped participant id, at least
 * one claimed role, a namespace prefix in KINP §3.4's grammar, a capability block that
 * points at the served card rather than restating it, and an egress block naming the
 * one conformant enforcement point.
 *
 * This is the shape check. Agreement with what Pinakes actually publishes is
 * {@link assertParticipantManifestAgreement}.
 */
export function assertValidParticipant(
  declaration: ParticipantSelfDescription = PARTICIPANT,
): void {
  if (!/^\d+\.\d+\.\d+$/.test(declaration.self_description_version ?? "")) {
    throw new Error(
      `participant: self_description_version must be semver, got "${declaration.self_description_version}"`,
    );
  }
  const participant = kinpParts(declaration.participant ?? "");
  if (!participant) {
    throw new Error(
      `participant: "${declaration.participant}" is not a KINP CURIE (namespace:kind:local)`,
    );
  }
  if (declaration.roles.length === 0) {
    throw new Error("participant: at least one role required — the facets are role-scoped");
  }
  for (const role of declaration.roles) {
    if (!PARTICIPANT_ROLES.includes(role)) {
      throw new Error(`participant: unknown role "${role}"`);
    }
  }
  if (new Set(declaration.roles).size !== declaration.roles.length) {
    throw new Error("participant: roles must be unique");
  }

  // --- identity ------------------------------------------------------------
  const identity = declaration.identity;
  if (!NAMESPACE_PREFIX_RE.test(identity?.namespace ?? "")) {
    throw new Error(
      `participant: identity.namespace "${identity?.namespace}" is not a KINP §3.4 prefix`,
    );
  }
  if (identity.namespace !== participant.namespace) {
    throw new Error(
      `participant: identity.namespace "${identity.namespace}" does not match the namespace of participant "${declaration.participant}"`,
    );
  }
  // A participant that mints ids under a prefix it does not own would be minting into
  // someone else's namespace — the one thing KINP §3.4's registry exists to prevent.
  if (identity.minting_authority === false && (identity.kinds ?? []).length > 0) {
    throw new Error(
      "participant: identity declares kinds minted under a namespace it is not the minting authority for",
    );
  }
  for (const kind of identity.kinds ?? []) {
    if (!NAMESPACE_PREFIX_RE.test(kind)) {
      throw new Error(`participant: identity.kinds names malformed kind "${kind}"`);
    }
  }
  if (!(identity.kinds ?? []).includes(participant.kind)) {
    throw new Error(
      `participant: identity.kinds does not include "${participant.kind}", the kind of its own participant id`,
    );
  }
  for (const anchor of identity.external_anchors ?? []) {
    if (!NAMESPACE_PREFIX_RE.test(anchor)) {
      throw new Error(`participant: identity.external_anchors names malformed prefix "${anchor}"`);
    }
    if (anchor === identity.namespace) {
      throw new Error(
        `participant: "${anchor}" cannot be both this participant's namespace and an external authority it anchors to`,
      );
    }
  }
  if (identity.minting_rules) assertLocation(identity.minting_rules, "identity.minting_rules");

  // --- capability ----------------------------------------------------------
  assertLocation(declaration.capability?.agent_card, "capability.agent_card");
  if (!MANIFEST_EXTENSION_RE.test(declaration.capability.manifest_extension_uri ?? "")) {
    throw new Error(
      `participant: capability.manifest_extension_uri "${declaration.capability.manifest_extension_uri}" is not a KCB §2 manifest extension URI`,
    );
  }
  if (declaration.capability.manifest_source) {
    assertLocation(declaration.capability.manifest_source, "capability.manifest_source");
  }
  if (declaration.capability.mcp) assertLocation(declaration.capability.mcp, "capability.mcp");

  // --- egress --------------------------------------------------------------
  assertLocation(declaration.egress?.policy, "egress.policy");
  if (declaration.egress.enforced_at !== undefined && declaration.egress.enforced_at !== ENFORCED_AT) {
    throw new Error(
      `participant: egress.enforced_at must be "${ENFORCED_AT}" (KGP §7.2 admits no other), got "${declaration.egress.enforced_at}"`,
    );
  }
  if (declaration.egress.license_policy) {
    assertLocation(declaration.egress.license_policy, "egress.license_policy");
  }

  // --- translation ---------------------------------------------------------
  const translation = declaration.translation;
  if (translation) {
    if (translation.mappings.length === 0) {
      throw new Error("participant: translation declares no mappings — omit the block instead");
    }
    translation.mappings.forEach((mapping, i) => {
      const where = `translation.mappings[${i}]`;
      if (!["produces", "consumes", "both"].includes(mapping.direction)) {
        throw new Error(`participant: ${where} has unknown direction "${mapping.direction}"`);
      }
      if (mapping.plane !== undefined && !["knowledge", "media", "entity"].includes(mapping.plane)) {
        throw new Error(`participant: ${where} names unknown plane "${mapping.plane}"`);
      }
      assertLocation(mapping.location, `${where}.location`);
    });
    for (const registry of translation.target_registries ?? []) {
      if (!isNonEmptyString(registry)) {
        throw new Error("participant: translation.target_registries names an empty file");
      }
    }
  }

  // --- discovery -----------------------------------------------------------
  const discovery = declaration.discovery;
  if (discovery) {
    // KCB §3 / ADR-0007 decision 3: a registry returns an ADDRESS to a
    // self-description, never the self-description. Declaring a mandatory registry
    // would make discovery a dependency, which is the whole failure mode.
    if (discovery.registry_optional !== undefined && discovery.registry_optional !== true) {
      throw new Error("participant: discovery.registry_optional may only be true");
    }
    (discovery.registries ?? []).forEach((registry, i) =>
      assertLocation(registry, `discovery.registries[${i}]`),
    );
  }
}

/**
 * The drift check that makes this a *source* document rather than a second manifest:
 * every fact the declaration states about Pinakes's identity, namespace, ports and
 * egress must agree with what Pinakes actually publishes — the KCB capability manifest
 * (`capability-manifest.json`) and the egress policy (`egress-policy.json`).
 *
 * Without this, the declaration would be exactly the hand-maintained second copy koine
 * ADR-0007 decision 7 bounds it against: it would keep validating while the served card
 * moved out from under it.
 */
export function assertParticipantManifestAgreement(
  declaration: ParticipantSelfDescription = PARTICIPANT,
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
  policy: EgressPolicy = EGRESS_POLICY,
): void {
  // Identity: the declaration describes the agent the card publishes as.
  if (declaration.participant !== manifest.identity) {
    throw new Error(
      `participant: declares "${declaration.participant}" but the capability manifest publishes as "${manifest.identity}"`,
    );
  }
  const defaultWorld = kinpParts(manifest.x_pinakes.defaultWorld);
  if (!defaultWorld) {
    throw new Error(
      `participant: the manifest's default world "${manifest.x_pinakes.defaultWorld}" is not a KINP CURIE`,
    );
  }
  if (defaultWorld.namespace !== declaration.identity.namespace) {
    throw new Error(
      `participant: the manifest's default world is in namespace "${defaultWorld.namespace}", not the declared "${declaration.identity.namespace}"`,
    );
  }
  if (!(declaration.identity.kinds ?? []).includes(defaultWorld.kind)) {
    throw new Error(
      `participant: identity.kinds does not include "${defaultWorld.kind}", the kind of the manifest's default world`,
    );
  }
  // Pinakes is the canonical authority for real-world entities (KINP §6), which is a
  // claim about minting: it cannot be made by a participant that is not the minting
  // authority for its own namespace.
  if (claimsRole("authority", declaration) && declaration.identity.minting_authority !== true) {
    throw new Error(
      "participant: claims the authority role without claiming minting authority for its own namespace",
    );
  }

  // Roles vs the published ports: a claimed role must be reachable through the bus.
  if (claimsRole("producer", declaration) && manifest.produces.length === 0) {
    throw new Error("participant: claims the producer role but the manifest publishes no ports");
  }
  if (claimsRole("consumer", declaration) && manifest.consumes.length === 0) {
    throw new Error("participant: claims the consumer role but the manifest consumes nothing");
  }
  if (claimsRole("provider", declaration) && manifest.capabilities.length === 0) {
    throw new Error("participant: claims the provider role but the manifest declares no capability");
  }

  // Capability facet: pointers must resolve to the documents actually served.
  if (declaration.capability.manifest_source?.path !== MANIFEST_SOURCE_PATH) {
    throw new Error(
      `participant: capability.manifest_source must point at "${MANIFEST_SOURCE_PATH}", got "${String(declaration.capability.manifest_source?.path)}"`,
    );
  }
  if (!manifest.x_pinakes.endpointNote.includes(declaration.capability.manifest_extension_uri)) {
    throw new Error(
      `participant: the manifest does not name extension URI "${declaration.capability.manifest_extension_uri}" — the card would carry a different extension than the one declared`,
    );
  }
  // koine's `location` shape has path/url/note and nothing else, and Pinakes ships no
  // fixed public origin, so the well-known path a front answers on rides in `note`.
  // Checking it is what keeps a moved endpoint from silently orphaning the declaration.
  assertNoteNamesEndpoint(declaration.capability.agent_card, manifest.endpoints.a2a, "agent_card");
  assertNoteNamesEndpoint(declaration.capability.mcp, manifest.endpoints.mcp, "mcp");

  // Egress facet: one policy, pointed at from both documents.
  if (declaration.egress.policy.path !== EGRESS_POLICY_PATH) {
    throw new Error(
      `participant: egress.policy must point at "${EGRESS_POLICY_PATH}", got "${String(declaration.egress.policy.path)}"`,
    );
  }
  if (manifest.x_pinakes.egressPolicy !== EGRESS_POLICY_PATH) {
    throw new Error(
      `participant: the capability manifest points at egress policy "${manifest.x_pinakes.egressPolicy}", not "${EGRESS_POLICY_PATH}" — two policies is one too many`,
    );
  }
  if (manifest.x_pinakes.participantDeclaration !== PARTICIPANT_PATH) {
    throw new Error(
      `participant: the capability manifest points back at "${manifest.x_pinakes.participantDeclaration}", not "${PARTICIPANT_PATH}"`,
    );
  }
  if (
    declaration.egress.default_class !== undefined &&
    declaration.egress.default_class !== policy.defaultEgress
  ) {
    throw new Error(
      `participant: declares default egress "${declaration.egress.default_class}" but the policy defaults to "${policy.defaultEgress}"`,
    );
  }
  if (
    declaration.egress.enforced_at !== undefined &&
    declaration.egress.enforced_at !== policy.enforcedAt
  ) {
    throw new Error(
      `participant: declares enforcement at "${declaration.egress.enforced_at}" but the policy enforces at "${policy.enforcedAt}"`,
    );
  }

  // The dialect claim, tied to the ports that make it: the policy says grounding-only,
  // so no published knowledge port may say anything else.
  for (const port of producedKnowledgePorts(manifest)) {
    if (port.dialect !== undefined && port.dialect !== policy.knowledgeDialect) {
      throw new Error(
        `participant: a produced knowledge port emits "${port.dialect}" but the egress policy declares "${policy.knowledgeDialect}"`,
      );
    }
  }
}

/**
 * Assert a location's `note` names the endpoint the manifest publishes for it. A null
 * endpoint (a front that is not stood up) requires no location at all; a populated one
 * must be findable in the note, so moving `/mcp` breaks the declaration loudly.
 */
function assertNoteNamesEndpoint(
  location: ArtifactLocation | undefined,
  endpoint: string | null,
  where: string,
): void {
  if (endpoint === null) return;
  if (!location) {
    throw new Error(`participant: the manifest publishes ${where} at "${endpoint}" but none is declared`);
  }
  const haystack = `${location.note ?? ""} ${location.url ?? ""}`;
  if (!haystack.includes(endpoint)) {
    throw new Error(
      `participant: capability.${where} does not name the published endpoint "${endpoint}"`,
    );
  }
}
