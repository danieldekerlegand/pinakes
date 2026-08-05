import { describe, it, expect } from "vitest";

import { KCB_MANIFEST_EXTENSION_URI } from "../server/routes/a2a";
import { CAPABILITY_MANIFEST, type CapabilityManifest } from "./capability-manifest";
import { EGRESS_POLICY, EGRESS_POLICY_PATH } from "./egress-policy";
import { hasKoineSchema, validateAgainstKoineSchema } from "./koine-schema";
import {
  MANIFEST_SOURCE_PATH,
  PARTICIPANT,
  PARTICIPANT_PATH,
  PINAKES_NAMESPACE,
  assertParticipantManifestAgreement,
  assertValidParticipant,
  claimsRole,
  kinpParts,
  mappingsFor,
  type ParticipantSelfDescription,
} from "./participant";

const KOINE_SCHEMA = "participant-self-description.schema.json";
const hasSchema = hasKoineSchema(KOINE_SCHEMA);

/** Deep-clone the live declaration so a test can mutate one field in isolation. */
function clone(): ParticipantSelfDescription {
  return JSON.parse(JSON.stringify(PARTICIPANT)) as ParticipantSelfDescription;
}

/** Mutable view of the clone (the published type is deeply readonly). */
type Mutable = {
  self_description_version: string;
  participant: string;
  roles: string[];
  identity: {
    namespace: string;
    minting_authority?: boolean;
    kinds?: string[];
    external_anchors?: string[];
    minting_rules?: { path?: string; url?: string; note?: string };
  };
  capability: {
    agent_card: { path?: string; url?: string; note?: string };
    manifest_extension_uri: string;
    manifest_source?: { path?: string; note?: string };
    mcp?: { path?: string; note?: string };
  };
  egress: {
    policy: { path?: string; note?: string };
    default_class?: string;
    enforced_at?: string;
  };
  translation?: { mappings: { direction: string; location: { path?: string } }[] };
  discovery?: { registry_optional?: boolean };
};

function mutable(declaration: ParticipantSelfDescription): Mutable {
  return declaration as unknown as Mutable;
}

function cloneManifest(): CapabilityManifest {
  return JSON.parse(JSON.stringify(CAPABILITY_MANIFEST)) as CapabilityManifest;
}

describe("participant self-description", () => {
  it("is well-formed against the koine convention (the live declaration validates)", () => {
    expect(() => assertValidParticipant()).not.toThrow();
  });

  it("names Pinakes's KINP participant identity", () => {
    expect(PARTICIPANT.participant).toBe("pinakes:agent:resolver");
    expect(kinpParts(PARTICIPANT.participant)).toEqual({
      namespace: "pinakes",
      kind: "agent",
      local: "resolver",
    });
  });

  it("claims the canonical namespace and asserts sole minting authority for it", () => {
    expect(PARTICIPANT.identity.namespace).toBe(PINAKES_NAMESPACE);
    expect(PARTICIPANT.identity.minting_authority).toBe(true);
    // The kinds minted under it — `ent` is the csid entity space (docs/canonical-schema.md
    // §3.1), `world` carries the default real-world world, `agent` is this participant.
    expect(PARTICIPANT.identity.kinds).toEqual(["ent", "world", "agent", "model"]);
    expect(claimsRole("authority")).toBe(true);
  });

  it("anchors to external authorities without claiming to mint them (KINP §4.4)", () => {
    expect(PARTICIPANT.identity.external_anchors).toContain("wikidata");
    expect(PARTICIPANT.identity.external_anchors).not.toContain(PINAKES_NAMESPACE);
    const declaration = clone();
    mutable(declaration).identity.external_anchors = [PINAKES_NAMESPACE];
    expect(() => assertValidParticipant(declaration)).toThrow(/external authority/);
  });

  it("refuses a declaration whose namespace is not its own participant id's", () => {
    const declaration = clone();
    mutable(declaration).identity.namespace = "insimul";
    expect(() => assertValidParticipant(declaration)).toThrow(/does not match the namespace/);
  });

  it("refuses kinds minted under a namespace it does not own", () => {
    const declaration = clone();
    mutable(declaration).identity.minting_authority = false;
    expect(() => assertValidParticipant(declaration)).toThrow(/minting authority/);
  });

  it("points at the egress policy rather than restating it (koine facet 3)", () => {
    expect(PARTICIPANT.egress.policy.path).toBe(EGRESS_POLICY_PATH);
    expect(PARTICIPANT.egress.default_class).toBe(EGRESS_POLICY.defaultEgress);
    expect(PARTICIPANT.egress.enforced_at).toBe(EGRESS_POLICY.enforcedAt);
  });

  it("keeps every pointer inside this repo — no participant reads another's (ADR-0007)", () => {
    const declaration = clone();
    mutable(declaration).egress.policy = { path: "../koine/policy/egress.json" };
    expect(() => assertValidParticipant(declaration)).toThrow(/relative to this repo's root/);
  });

  it("carries pointers, never payloads — a location must resolve somewhere", () => {
    const declaration = clone();
    mutable(declaration).capability.agent_card = { note: "served somewhere" };
    expect(() => assertValidParticipant(declaration)).toThrow(/a pointer to nowhere/);
  });

  it("names the KCB manifest extension the served card actually carries", () => {
    expect(PARTICIPANT.capability.manifest_extension_uri).toBe(KCB_MANIFEST_EXTENSION_URI);
    const declaration = clone();
    mutable(declaration).capability.manifest_extension_uri = "https://example.test/kcb/0.3";
    expect(() => assertValidParticipant(declaration)).toThrow(/manifest extension URI/);
  });

  it("declares the mapping that governs both directions of knowledge it bridges", () => {
    expect(mappingsFor("produces").length).toBeGreaterThan(0);
    expect(mappingsFor("consumes").length).toBeGreaterThan(0);
    expect(PARTICIPANT.translation?.mappings[0].location.path).toBe(
      "contracts/predicate-mapping.json",
    );
  });

  it("keeps the discovery registry optional — an index, never an authority (KCB §3)", () => {
    expect(PARTICIPANT.discovery?.registry_optional).toBe(true);
    const declaration = clone();
    (mutable(declaration).discovery as { registry_optional?: boolean }).registry_optional = false;
    expect(() => assertValidParticipant(declaration)).toThrow(/registry_optional/);
  });
});

describe("participant ↔ capability manifest (drift check)", () => {
  it("agrees with what Pinakes actually publishes", () => {
    expect(() => assertParticipantManifestAgreement()).not.toThrow();
  });

  it("fails when the declaration and the manifest publish as different agents", () => {
    const declaration = clone();
    mutable(declaration).participant = "pinakes:agent:other";
    expect(() => assertParticipantManifestAgreement(declaration)).toThrow(
      /but the capability manifest publishes as/,
    );
  });

  it("fails when the manifest's default world leaves the declared namespace", () => {
    const manifest = cloneManifest();
    (manifest.x_pinakes as { defaultWorld: string }).defaultWorld = "insimul:world:seed";
    expect(() => assertParticipantManifestAgreement(PARTICIPANT, manifest)).toThrow(
      /not the declared "pinakes"/,
    );
  });

  it("fails when a declared kind stops covering an id the manifest mints", () => {
    const declaration = clone();
    mutable(declaration).identity.kinds = ["ent", "agent", "model"];
    expect(() => assertParticipantManifestAgreement(declaration)).toThrow(
      /kind of the manifest's default world/,
    );
  });

  it("fails when the manifest_source stops pointing at the served manifest", () => {
    const declaration = clone();
    mutable(declaration).capability.manifest_source = { path: "config/kcb-manifest.yaml" };
    expect(() => assertParticipantManifestAgreement(declaration)).toThrow(/manifest_source/);
    expect(PARTICIPANT.capability.manifest_source?.path).toBe(MANIFEST_SOURCE_PATH);
  });

  it("fails when a served front moves out from under the declaration", () => {
    const manifest = cloneManifest();
    (manifest.endpoints as { mcp: string | null }).mcp = "/api/mcp";
    expect(() => assertParticipantManifestAgreement(PARTICIPANT, manifest)).toThrow(
      /does not name the published endpoint/,
    );
  });

  it("fails when the two documents name different egress policies", () => {
    const manifest = cloneManifest();
    (manifest.x_pinakes as { egressPolicy: string }).egressPolicy = "config/egress.yaml";
    expect(() => assertParticipantManifestAgreement(PARTICIPANT, manifest)).toThrow(
      /two policies is one too many/,
    );
  });

  it("is pointed back at by the manifest, so neither document is orphaned", () => {
    expect(CAPABILITY_MANIFEST.x_pinakes.participantDeclaration).toBe(PARTICIPANT_PATH);
    const manifest = cloneManifest();
    (manifest.x_pinakes as { participantDeclaration: string }).participantDeclaration = "none";
    expect(() => assertParticipantManifestAgreement(PARTICIPANT, manifest)).toThrow(
      /points back at/,
    );
  });

  it("fails when a published port's dialect contradicts the egress policy", () => {
    const manifest = cloneManifest();
    const port = manifest.produces.find((p) => p.plane === "knowledge");
    expect(port).toBeDefined();
    (port as { dialect?: string }).dialect = "full-prolog";
    expect(() => assertParticipantManifestAgreement(PARTICIPANT, manifest)).toThrow(
      /the egress policy declares "grounding-only"/,
    );
  });
});

// koine ships shape without validators ("Validators live downstream per ADR-0001"), so
// conformance is proved here, against the published schema in a sibling checkout. Skips
// when that checkout is absent — the same rule the registry-mirror gate follows: a check
// that cannot run is no signal, and a check that fails on every machine without koine is
// a check everyone learns to ignore.
describe("koine schema conformance", () => {
  it.skipIf(!hasSchema)("validates against koine's participant-self-description schema", () => {
    expect(validateAgainstKoineSchema(PARTICIPANT, KOINE_SCHEMA)).toEqual([]);
  });

  it.skipIf(!hasSchema)("the checker actually rejects — a non-conformant document fails", () => {
    const declaration = clone();
    // `roles` is an enum in the schema; a value outside it must be caught, or the
    // "validates" assertion above would be vacuous.
    mutable(declaration).roles = ["archivist"];
    expect(validateAgainstKoineSchema(declaration, KOINE_SCHEMA).length).toBeGreaterThan(0);
    // So must a payload smuggled into a facet block (additionalProperties: false).
    const smuggled = clone();
    (mutable(smuggled).egress as Record<string, unknown>).rules = [{ relation: "x" }];
    expect(validateAgainstKoineSchema(smuggled, KOINE_SCHEMA).length).toBeGreaterThan(0);
  });
});
