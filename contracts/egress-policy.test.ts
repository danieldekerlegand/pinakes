import { describe, it, expect } from "vitest";

import { DEFAULT_LICENSE_CLASSES } from "../scripts/export-entity-grounding";
import {
  CAPABILITY_MANIFEST,
  FINETUNE_RECORD_CLASS,
  assertValidCapabilityManifest,
  finetuneCapability,
  producedKnowledgePorts,
  type CapabilityManifest,
} from "./capability-manifest";
import {
  EGRESS_POLICY,
  EGRESS_POLICY_PATH,
  ENFORCED_AT,
  assertValidEgressPolicy,
  egressClassFor,
  egressRecordClass,
  exportableRecordClasses,
  isDeclaredProducer,
  type EgressPolicy,
} from "./egress-policy";
import { DEFAULT_DIALECT, licensePolicyFor } from "./kgp";

/** Deep-clone the live policy so a test can mutate one field in isolation. */
function clonePolicy(): EgressPolicy {
  return JSON.parse(JSON.stringify(EGRESS_POLICY)) as EgressPolicy;
}

/** Mutable view of the clone (the published type is deeply readonly). */
type MutablePolicy = {
  enforcedAt: string;
  defaultEgress: string;
  knowledgeDialect: string;
  recordClasses: {
    id: string;
    egress: string;
    records: string;
    producedBy: string[];
    rationale: string;
  }[];
  licensePolicy: { allowedSpdxClasses: string[]; allowedClasses: string[]; onViolation: string };
};

function mutable(policy: EgressPolicy): MutablePolicy {
  return policy as unknown as MutablePolicy;
}

describe("egress policy", () => {
  it("is well-formed against KGP §5/§7 (the live policy validates)", () => {
    expect(() => assertValidEgressPolicy()).not.toThrow();
  });

  it("enforces at pack construction — the only conformant answer (KGP §7.2)", () => {
    expect(EGRESS_POLICY.enforcedAt).toBe(ENFORCED_AT);
    const policy = clonePolicy();
    mutable(policy).enforcedAt = "import";
    expect(() => assertValidEgressPolicy(policy)).toThrow(/enforcedAt/);
  });

  it("declares grounding-only as the dialect every knowledge port emits (KGP §5)", () => {
    expect(EGRESS_POLICY.knowledgeDialect).toBe("grounding-only");
    expect(EGRESS_POLICY.defaultEgress).toBe("exportable");
  });

  it("rejects a dialect tier outside KGP §5's vocabulary", () => {
    const policy = clonePolicy();
    mutable(policy).knowledgeDialect = "datalog";
    expect(() => assertValidEgressPolicy(policy)).toThrow(/not a KGP §5 dialect tier/);
  });

  it("classifies every record class, uniquely and with a rationale", () => {
    const ids = EGRESS_POLICY.recordClasses.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cls of EGRESS_POLICY.recordClasses) {
      expect(["exportable", "local-only"]).toContain(cls.egress);
      expect(cls.rationale.length).toBeGreaterThan(0);
    }
    const policy = clonePolicy();
    policy.recordClasses[0] && mutable(policy).recordClasses.push({ ...mutable(policy).recordClasses[0] });
    expect(() => assertValidEgressPolicy(policy)).toThrow(/duplicate record class/);
  });

  it("refuses an exportable class that names no producer — a crossing nothing performs", () => {
    const policy = clonePolicy();
    const exportable = mutable(policy).recordClasses.find((c) => c.egress === "exportable");
    expect(exportable).toBeDefined();
    exportable!.producedBy = [];
    expect(() => assertValidEgressPolicy(policy)).toThrow(/names no producer/);
  });

  it("names the exporters that perform each exportable crossing", () => {
    expect(isDeclaredProducer("scripts/export-for-engine.ts")).toBe(true);
    expect(isDeclaredProducer("scripts/export-entity-grounding.ts")).toBe(true);
    // The contribution queue is local-only precisely because nothing exports it.
    expect(egressRecordClass("contribution-queue")?.producedBy).toEqual([]);
    expect(exportableRecordClasses().length).toBeGreaterThan(0);
  });

  it("gives the training corpora a local-only class, and fails loudly on an unknown one", () => {
    expect(egressClassFor(FINETUNE_RECORD_CLASS)).toBe("local-only");
    expect(() => egressClassFor("no-such-class")).toThrow(/no record class/);
  });

  it("keeps its licence allowlist identical to what the exporters filter on", () => {
    // Two restatements of one policy would drift silently: the SPDX families here must
    // be the exporters' own default, and their KGP §7.1 classification must be kgp.ts's.
    expect(EGRESS_POLICY.licensePolicy.allowedSpdxClasses).toEqual([...DEFAULT_LICENSE_CLASSES]);
    expect(licensePolicyFor(EGRESS_POLICY.licensePolicy.allowedSpdxClasses).allowed_classes).toEqual(
      EGRESS_POLICY.licensePolicy.allowedClasses,
    );
    expect(EGRESS_POLICY.licensePolicy.onViolation).toBe("reject-with-report");
  });

  it("rejects a licence policy that silently drops instead of reporting (KGP §7.1)", () => {
    const policy = clonePolicy();
    mutable(policy).licensePolicy.onViolation = "drop";
    expect(() => assertValidEgressPolicy(policy)).toThrow(/reject-with-report/);
  });
});

describe("egress policy ↔ capability manifest", () => {
  /** Deep-clone the live manifest so a test can mutate one field in isolation. */
  function cloneManifest(): CapabilityManifest {
    return JSON.parse(JSON.stringify(CAPABILITY_MANIFEST)) as CapabilityManifest;
  }

  it("is the manifest's declared source of truth, by pointer", () => {
    expect(CAPABILITY_MANIFEST.x_pinakes.egressPolicy).toBe(EGRESS_POLICY_PATH);
  });

  it("blocks a manifest that points at some other policy", () => {
    const manifest = cloneManifest();
    (manifest.x_pinakes as { egressPolicy: string }).egressPolicy = "config/egress.yaml";
    expect(() => assertValidCapabilityManifest(manifest)).toThrow(/x_pinakes.egressPolicy/);
  });

  it("supplies the dialect every published knowledge port is validated against", () => {
    for (const port of producedKnowledgePorts()) {
      if (port.dialect !== undefined) expect(port.dialect).toBe(EGRESS_POLICY.knowledgeDialect);
    }
    const manifest = cloneManifest();
    const port = manifest.produces.find((p) => p.plane === "knowledge");
    expect(port).toBeDefined();
    (port as { dialect?: string }).dialect = "horn-safe";
    expect(() => assertValidCapabilityManifest(manifest)).toThrow(/egress-policy\.json/);
  });

  it("supplies the egress the finetune capability advertises (KFT §4.2)", () => {
    expect(finetuneCapability()?.x_specialization?.egress).toBe(
      egressClassFor(FINETUNE_RECORD_CLASS),
    );
    const manifest = cloneManifest();
    const finetune = manifest.capabilities.find((c) => c.name === "finetune");
    expect(finetune).toBeDefined();
    (finetune!.x_specialization as { egress: string }).egress = "exportable";
    expect(() => assertValidCapabilityManifest(manifest)).toThrow(/slm-training-corpora/);
  });

  it("is where kgp.ts takes its default dialect from, not a second literal", () => {
    expect(DEFAULT_DIALECT).toBe(EGRESS_POLICY.knowledgeDialect);
  });
});
