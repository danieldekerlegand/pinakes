/**
 * Pinakes's egress + dialect policy — KGP (`koine/specs/grounding-pack.md`) §7.1/§7.2
 * and §5, as *this* project answers them.
 *
 * Koine holds the shape of the egress facet and stops there
 * (`koine/docs/self-describing-participant.md`, facet 3): the values — which record
 * classes may leave, what dialect the knowledge ports emit, which licences are
 * admitted — are Pinakes's instance data and live in this repo, on this repo's
 * release cadence. No central component holds them.
 *
 * The machine-readable source of truth is {@link ./egress-policy.json}. This module
 * imports it, pins its shape, and is the module the rest of `contracts/` reads the
 * policy *from* rather than restating it:
 *
 * - `capability-manifest.ts` validates every published knowledge port against
 *   {@link EgressPolicy.knowledgeDialect}, and the `finetune` capability's advertised
 *   egress against the `slm-training-corpora` record class;
 * - `kgp.ts` takes its `DEFAULT_DIALECT` from the same field.
 *
 * **This module is a leaf on purpose.** It imports no other contract, so the
 * capability manifest can depend on the policy (the manifest references the policy,
 * never the other way round) without a cycle. Keep it that way.
 */
import egressPolicyJson from "./egress-policy.json";

/**
 * KGP §5 dialect (portability) tiers — what logic a consumer of a knowledge port is
 * asked to be able to evaluate. Widening tiers, most restrictive first. Declared here
 * rather than in `capability-manifest.ts` because the policy is what fixes the tier a
 * port may claim; the manifest re-exports this type for its existing consumers.
 */
export type KnowledgeDialect = "grounding-only" | "horn-safe" | "full-prolog";

/** KGP §7.2 egress classes — whether a record may cross a project boundary at all. */
export type EgressClass = "exportable" | "local-only";

/** The KGP §7.1 licence classes, as the policy names them. */
export type LicenseClassName =
  | "public-domain"
  | "permissive"
  | "attribution"
  | "share-alike"
  | "non-commercial"
  | "proprietary";

/**
 * One class of record, and whether it may leave. The unit is deliberately a *class*
 * (a corpus, a queue, a training set), not a row: a per-row decision that cannot be
 * stated up front is a decision no peer can check.
 */
export interface EgressRecordClass {
  /** Stable id other contracts refer to the class by (e.g. `slm-training-corpora`). */
  readonly id: string;
  readonly egress: EgressClass;
  /** What the class covers, in enough detail to tell whether a new record is in it. */
  readonly records: string;
  /**
   * Repo-relative producers that emit this class. Empty is meaningful, not missing:
   * a `local-only` class with no producer is one nothing can emit.
   */
  readonly producedBy: readonly string[];
  readonly rationale: string;
}

/** Pointer to where per-relation egress is decided (the vendored registry mirror). */
export interface RelationEgressPointer {
  readonly source: string;
  readonly field: string;
  readonly note: string;
}

/** The KGP §7.1 admission allowlist (`licensePolicyFor` in `kgp.ts` reproduces it). */
export interface EgressLicensePolicy {
  /** SPDX families the exporters filter on — e.g. `CC0`, `CC-BY`. */
  readonly allowedSpdxClasses: readonly string[];
  /** The same filter in §7.1's class vocabulary, in `ALL_LICENSE_CLASSES` order. */
  readonly allowedClasses: readonly LicenseClassName[];
  readonly onViolation: "reject-with-report";
  readonly classifier: string;
  readonly note: string;
}

/** The published policy. */
export interface EgressPolicy {
  readonly policyVersion: string;
  readonly title: string;
  readonly description: string;
  readonly kgpVersion: string;
  /** Where enforcement happens; KGP §7.2 admits exactly one answer. */
  readonly enforcedAt: "pack-construction";
  readonly enforcedAtNote: string;
  /** The class applied to a record whose class is unstated (KGP §7.2 default). */
  readonly defaultEgress: EgressClass;
  /** The dialect every Pinakes knowledge port emits. The source of truth for it. */
  readonly knowledgeDialect: KnowledgeDialect;
  readonly dialectNote: string;
  readonly recordClasses: readonly EgressRecordClass[];
  readonly relationEgress: RelationEgressPointer;
  readonly licensePolicy: EgressLicensePolicy;
}

/** The live policy as authored in `egress-policy.json`. */
export const EGRESS_POLICY = egressPolicyJson as EgressPolicy;

/** The one conformant enforcement point (KGP §7.2, koine ADR-0007 decision 5). */
export const ENFORCED_AT = "pack-construction";

/**
 * Where this policy lives, repo-relative. The policy knows its own path so the two
 * documents that point *at* it — the capability manifest's `x_pinakes.egressPolicy`
 * and the participant declaration's `egress.policy` — are checked against one
 * constant rather than against each other's string literals.
 */
export const EGRESS_POLICY_PATH = "contracts/egress-policy.json";

/** The record class with this id, or `undefined`. */
export function egressRecordClass(
  id: string,
  policy: EgressPolicy = EGRESS_POLICY,
): EgressRecordClass | undefined {
  return policy.recordClasses.find((c) => c.id === id);
}

/**
 * The egress class declared for a record class — the accessor other contracts use
 * instead of writing `"local-only"` a second time. Throws on an unknown id, so a
 * renamed class fails loudly rather than silently defaulting to `exportable`.
 */
export function egressClassFor(id: string, policy: EgressPolicy = EGRESS_POLICY): EgressClass {
  const found = egressRecordClass(id, policy);
  if (!found) {
    throw new Error(`egress-policy: no record class "${id}"`);
  }
  return found.egress;
}

/** Every record class that may cross a boundary. */
export function exportableRecordClasses(
  policy: EgressPolicy = EGRESS_POLICY,
): readonly EgressRecordClass[] {
  return policy.recordClasses.filter((c) => c.egress === "exportable");
}

/** Whether a producer path is named by any `exportable` record class. */
export function isDeclaredProducer(path: string, policy: EgressPolicy = EGRESS_POLICY): boolean {
  return exportableRecordClasses(policy).some((c) => c.producedBy.includes(path));
}

const EGRESS_CLASSES: readonly EgressClass[] = ["exportable", "local-only"];
const DIALECTS: readonly KnowledgeDialect[] = ["grounding-only", "horn-safe", "full-prolog"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validate the policy against the KGP §5/§7 shape: one dialect tier from the spec's
 * vocabulary, an egress class from the spec's two, exactly one enforcement point, and
 * a record-class table that is complete enough to check a record against — every class
 * uniquely identified, classified, described and justified, and every `exportable`
 * class naming the producer that emits it (an exportable class with no producer is a
 * boundary crossing nobody performs, and reads as a licence to add one later).
 */
export function assertValidEgressPolicy(policy: EgressPolicy = EGRESS_POLICY): void {
  for (const key of ["policyVersion", "title", "description", "kgpVersion"] as const) {
    if (!isNonEmptyString(policy[key])) {
      throw new Error(`egress-policy: ${key} must be a non-empty string`);
    }
  }
  if (policy.enforcedAt !== ENFORCED_AT) {
    throw new Error(
      `egress-policy: enforcedAt must be "${ENFORCED_AT}" (KGP §7.2 admits no other), got "${policy.enforcedAt}"`,
    );
  }
  if (!EGRESS_CLASSES.includes(policy.defaultEgress)) {
    throw new Error(`egress-policy: defaultEgress "${policy.defaultEgress}" is not a KGP §7.2 class`);
  }
  if (!DIALECTS.includes(policy.knowledgeDialect)) {
    throw new Error(
      `egress-policy: knowledgeDialect "${policy.knowledgeDialect}" is not a KGP §5 dialect tier`,
    );
  }

  if (policy.recordClasses.length === 0) {
    throw new Error("egress-policy: at least one record class required");
  }
  const seen = new Set<string>();
  for (const cls of policy.recordClasses) {
    const where = `record class "${cls.id}"`;
    if (!isNonEmptyString(cls.id)) {
      throw new Error("egress-policy: a record class has no id");
    }
    if (seen.has(cls.id)) {
      throw new Error(`egress-policy: duplicate ${where}`);
    }
    seen.add(cls.id);
    if (!EGRESS_CLASSES.includes(cls.egress)) {
      throw new Error(`egress-policy: ${where} declares non-KGP egress "${cls.egress}"`);
    }
    if (!isNonEmptyString(cls.records) || !isNonEmptyString(cls.rationale)) {
      throw new Error(`egress-policy: ${where} needs a records description and a rationale`);
    }
    if (!Array.isArray(cls.producedBy)) {
      throw new Error(`egress-policy: ${where} needs a producedBy list (empty is allowed)`);
    }
    if (cls.egress === "exportable" && cls.producedBy.length === 0) {
      throw new Error(
        `egress-policy: ${where} is exportable but names no producer — a crossing nothing performs`,
      );
    }
    for (const producer of cls.producedBy) {
      if (!isNonEmptyString(producer)) {
        throw new Error(`egress-policy: ${where} names an empty producer path`);
      }
    }
  }

  for (const key of ["source", "field", "note"] as const) {
    if (!isNonEmptyString(policy.relationEgress?.[key])) {
      throw new Error(`egress-policy: relationEgress.${key} must be a non-empty string`);
    }
  }

  const licence = policy.licensePolicy;
  if (!licence || licence.allowedSpdxClasses.length === 0) {
    throw new Error("egress-policy: licensePolicy must admit at least one SPDX class");
  }
  if (licence.allowedClasses.length === 0) {
    throw new Error("egress-policy: licensePolicy must name its KGP §7.1 classes");
  }
  if (licence.onViolation !== "reject-with-report") {
    throw new Error(
      `egress-policy: licensePolicy.onViolation must be "reject-with-report" (KGP §7.1 never silently drops), got "${licence.onViolation}"`,
    );
  }
  if (!isNonEmptyString(licence.classifier)) {
    throw new Error("egress-policy: licensePolicy.classifier must name the module that classifies");
  }
}
