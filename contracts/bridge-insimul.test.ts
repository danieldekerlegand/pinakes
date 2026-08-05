import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, it, expect } from "vitest";

import {
  BRIDGE_INSIMUL,
  BRIDGE_INSIMUL_PATH,
  BRIDGE_REGISTRY_PROJECT,
  assertPublicBridge,
  assertValidBridgeMapping,
  bridgeDirection,
  bridgeRowForCanonicalType,
  bridgeRows,
  bridgedCanonicalTypes,
  bridgedPredicates,
  registryEntryForRow,
  type BridgeMapping,
} from "./bridge-insimul";
import { CANONICAL_SCHEMA, type CanonicalSchema } from "./canonical-schema";
import { PREDICATE_MAPPING, type PredicateMappingRegistry } from "./predicate-mapping";
import { PARTICIPANT } from "./participant";
import { SEED_MAPPINGS } from "../scripts/export-insimul-pack";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Deep-clone the live mapping so a test can mutate one field in isolation. */
function cloneMapping(): BridgeMapping {
  return JSON.parse(JSON.stringify(BRIDGE_INSIMUL)) as BridgeMapping;
}

/** Mutable view of a clone (the published types are deeply readonly). */
type MutableMapping = {
  bridgeVersion: string;
  registry: { path: string; project: string };
  participants: { role: string; id: string; namespace: string; visibility: string }[];
  directions: {
    id: string;
    registryDirections: string[];
    requiredEgress?: string;
    implementedBy: string[];
  }[];
  rows: {
    direction: string;
    registryEntry: number;
    canonicalKind: string;
    canonicalTypes: string[];
    typeReuseOnly?: boolean;
    note: string;
  }[];
};

function mutable(mapping: BridgeMapping): MutableMapping {
  return mapping as unknown as MutableMapping;
}

function cloneSchema(): CanonicalSchema {
  return JSON.parse(JSON.stringify(CANONICAL_SCHEMA)) as CanonicalSchema;
}

function cloneRegistry(): PredicateMappingRegistry {
  return JSON.parse(JSON.stringify(PREDICATE_MAPPING)) as PredicateMappingRegistry;
}

describe("pinakes ↔ insimul bridge mapping", () => {
  it("the live mapping validates against the in-repo canonical schema and registry", () => {
    expect(() => assertValidBridgeMapping()).not.toThrow();
  });

  it("covers both legs of the bridge with rows and an id-space rule", () => {
    for (const direction of ["export", "return"] as const) {
      expect(bridgeRows(direction).length).toBeGreaterThan(0);
      expect(BRIDGE_INSIMUL.idSpaces[direction].form).not.toBe("");
      expect(bridgeDirection(direction)?.implementedBy.length).toBeGreaterThan(0);
    }
  });

  it("names only in-repo implementations, and every one of them exists", () => {
    for (const direction of ["export", "return"] as const) {
      for (const path of bridgeDirection(direction)!.implementedBy) {
        expect(existsSync(join(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
      }
    }
    for (const path of [BRIDGE_INSIMUL.canonicalSchema.path!, BRIDGE_INSIMUL.registry.path!]) {
      expect(existsSync(join(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
    }
    expect(existsSync(join(REPO_ROOT, BRIDGE_INSIMUL_PATH))).toBe(true);
  });

  it("resolves nothing outside this repo — an escaping pointer is rejected", () => {
    const mapping = cloneMapping();
    mutable(mapping).registry.path = "../koine/registry/predicate-mapping.json";
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/relative to this repo/);
  });

  // --- AC4: an unmapped canonical type fails -------------------------------

  it("fails when a row maps a canonical node type the schema does not declare", () => {
    const mapping = cloneMapping();
    mutable(mapping).rows[0].canonicalTypes = ["nonexistent-node-type"];
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/does not declare/);
  });

  it("fails when a canonical type is dropped from the schema out from under a row", () => {
    const schema = cloneSchema();
    const mutableSchema = schema as unknown as { nodeTypes: { name: string }[] };
    mutableSchema.nodeTypes = mutableSchema.nodeTypes.filter((t) => t.name !== "character");
    expect(() => assertValidBridgeMapping(BRIDGE_INSIMUL, schema)).toThrow(
      /maps canonical node type "character"/,
    );
  });

  it("fails when an edge row names a node type (the kinds are checked separately)", () => {
    const mapping = cloneMapping();
    const edgeRow = mutable(mapping).rows.find((r) => r.canonicalKind === "edge")!;
    edgeRow.canonicalTypes = ["culture"];
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/does not declare/);
  });

  it("every canonical type it maps resolves in the canonical schema", () => {
    const nodeNames = new Set(CANONICAL_SCHEMA.nodeTypes.map((t) => t.name));
    const edgeNames = new Set(CANONICAL_SCHEMA.edgeTypes.map((t) => t.name));
    for (const row of BRIDGE_INSIMUL.rows) {
      for (const type of row.canonicalTypes) {
        expect(row.canonicalKind === "node" ? nodeNames : edgeNames).toContain(type);
      }
    }
  });

  // --- the registry authorizes, the mapping does not coin -------------------

  it("names no predicate in any structured field — every one comes from the registry entry", () => {
    // Prose `note`s may cite a predicate to explain a correspondence; what would be a fork
    // is a structured cell carrying one, so the check strips the notes and looks at the data.
    const structural = JSON.stringify(
      BRIDGE_INSIMUL.rows.map(({ note: _note, ...rest }) => rest),
    );
    for (const row of BRIDGE_INSIMUL.rows) {
      const entry = registryEntryForRow(row);
      expect(entry, `row #${row.registryEntry} resolves`).toBeDefined();
      for (const predicate of bridgedPredicates(row)) {
        // The predicate is readable THROUGH the mapping but stored nowhere in it.
        expect(structural).not.toContain(predicate);
      }
      expect(Object.keys(row)).not.toContain("external");
    }
  });

  it("fails when a row names a registry entry that does not exist", () => {
    const mapping = cloneMapping();
    mutable(mapping).rows[0].registryEntry = 9999;
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/names no entry/);
  });

  it("fails when a row maps a canonical type its registry entry does not cover", () => {
    const mapping = cloneMapping();
    mutable(mapping).rows[0].canonicalTypes = ["language"];
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/does not cover/);
  });

  it("fails when a registry entry goes pending on an unlanded schema addition", () => {
    const registry = cloneRegistry();
    const relations = registry.projects[BRIDGE_REGISTRY_PROJECT]!
      .relations as unknown as { id: number; pending: boolean }[];
    relations.find((r) => r.id === 9)!.pending = true;
    expect(() => assertValidBridgeMapping(BRIDGE_INSIMUL, CANONICAL_SCHEMA, registry)).toThrow(
      /pending/,
    );
  });

  it("fails when a local-only entry appears on the outbound leg", () => {
    const registry = cloneRegistry();
    const relations = registry.projects[BRIDGE_REGISTRY_PROJECT]!
      .relations as unknown as { id: number; egress: string }[];
    relations.find((r) => r.id === 1)!.egress = "local-only";
    expect(() => assertValidBridgeMapping(BRIDGE_INSIMUL, CANONICAL_SCHEMA, registry)).toThrow(
      /may not leave the machine/,
    );
  });

  // --- direction, and the one documented exemption --------------------------

  it("fails when a row uses an entry that does not cross on its leg", () => {
    const mapping = cloneMapping();
    // Entry 9 (`character`) crosses IN->LS only; claiming it seeds a world is the bug.
    mutable(mapping).rows.push({
      direction: "export",
      registryEntry: 9,
      canonicalKind: "node",
      canonicalTypes: ["character"],
      note: "bogus",
    });
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/does not cross on the export leg/);
  });

  it("admits a type-reuse row, and only a type-reuse row, past the direction check", () => {
    const reuse = BRIDGE_INSIMUL.rows.filter((r) => r.typeReuseOnly === true);
    // `place` (settlements back) and `myth-motif` (truths back) are the two documented ones.
    expect(reuse.map((r) => r.canonicalTypes.join())).toEqual(["place", "myth-motif"]);
    for (const row of reuse) expect(row.note.length).toBeGreaterThan(0);
  });

  it("fails when typeReuseOnly is set on an entry that already crosses", () => {
    const mapping = cloneMapping();
    mutable(mapping).rows.find((r) => r.registryEntry === 10)!.typeReuseOnly = true;
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/drop the flag/);
  });

  it("fails when the same canonical type is mapped twice on one leg", () => {
    const mapping = cloneMapping();
    mutable(mapping).rows.push({
      direction: "return",
      registryEntry: 9,
      canonicalKind: "node",
      canonicalTypes: ["character"],
      note: "duplicate",
    });
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/a second time on the same leg/);
  });

  // --- AC2: public endpoints only ------------------------------------------

  it("declares only public participants", () => {
    expect(() => assertPublicBridge()).not.toThrow();
    for (const participant of BRIDGE_INSIMUL.participants) {
      expect(participant.visibility).toBe("public");
    }
  });

  it("rejects a non-public participant rather than redacting it", () => {
    const mapping = cloneMapping();
    mutable(mapping).participants[1].visibility = "non-public";
    expect(() => assertValidBridgeMapping(mapping)).toThrow(/not represented in this repository/);
  });

  it("is the only bridge mapping in the repo, and it is the all-public one", () => {
    // A non-public far endpoint is absent, not redacted — so the set of bridge documents
    // IS the set of public integrations. Adding one means adding a file, which shows up here.
    const declared = (PARTICIPANT.translation?.mappings ?? [])
      .map((m) => m.location.path)
      .filter((p): p is string => p !== undefined);
    expect(declared).toContain(BRIDGE_INSIMUL_PATH);
    expect(declared.filter((p) => p.startsWith("contracts/bridge-"))).toEqual([
      BRIDGE_INSIMUL_PATH,
    ]);
  });

  // --- AC3: the exporter resolves THROUGH this document ---------------------

  it("covers every canonical node type the Insimul pack exporter seeds", () => {
    const seeded = SEED_MAPPINGS.map((m) => m.nodeType).sort();
    const exported = bridgedCanonicalTypes("export").sort();
    expect(exported).toEqual(seeded);
    for (const mapping of SEED_MAPPINGS) {
      expect(bridgeRowForCanonicalType(mapping.nodeType, "export")).toBeDefined();
    }
  });

  it("the participant declaration points at it as a translation mapping", () => {
    const entry = (PARTICIPANT.translation?.mappings ?? []).find(
      (m) => m.location.path === BRIDGE_INSIMUL_PATH,
    );
    expect(entry).toBeDefined();
    expect(entry!.direction).toBe("both");
    expect(entry!.plane).toBe("knowledge");
  });
});
