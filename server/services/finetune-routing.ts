/**
 * FT-K provider selection — which `finetune` provider a job routes to (90-US-4).
 *
 * KFT (`koine/specs/fine-tuning.md`) is deliberately **multi-provider** (§9): agora
 * hosts the *general* trainer and Pinakes runs its own **narrow, specialized** one
 * (`server/services/finetune-provider.ts`). §8/FT-K states the tiebreak the discovery
 * registry applies when more than one provider matches a job:
 *
 *   > The registry disambiguates by preferring the more **specialized** matching
 *   > provider, then lower `cost` (KCB §3); a job MAY name a target provider
 *   > explicitly; an unbroken tie is **surfaced to the caller**, not resolved silently.
 *
 * This module is that rule, written down and executable. It is **pure** — manifests and
 * a job in, a decision out; no fs, no network, no registry client — so the conformance
 * test drives it with Pinakes's real manifest plus a stub agora general-trainer manifest
 * and no live bus.
 *
 * **Pinakes does not own the registry.** The routing decision is agora's to make at
 * runtime (KFT §8 reuses the KCB §3 discovery registry). What lives here is the
 * *provider side* of the contract: proof that Pinakes's advertisement carries enough
 * signal to be routed to correctly, and a reference implementation of the tiebreak that
 * goes red if the manifest ever widens past what `ml/src/pinakes_ml/kft.py` admits. A
 * router that sends a job here which admission then refuses is the exact failure FT-K
 * exists to prevent, so **admissibility and preference are kept apart**:
 *
 * - {@link ProviderRejection} is *admissibility* — would this provider refuse the job at
 *   the door? Its codes deliberately mirror `kft.py`'s (`unsupported-modality` /
 *   `unsupported-method` / `unsupported-dataset-plane`), so a refusal at routing reads
 *   the same as a refusal at admission.
 * - {@link CandidateRank} is *preference* — of the providers that would accept, which one
 *   should the registry pick? A narrow provider with no matching signal is admissible but
 *   ranked `fallback`, which is how a generic job is left to the general trainer without
 *   ever claiming the narrow provider would have refused it.
 *
 * **Where the specialization signal comes from.** `finetune-job.schema.json` (KFT 0.3.0)
 * is `additionalProperties: false` and carries no `domain` or `provider` field, so the
 * job cannot state "I am an SLM rule-authoring job" directly. It states it through the
 * data: the dataset's `header.datasetKind` (the koine `dataset-jsonl-header` — `rule-sft`,
 * `lore-qa`, …) is what the ecosystem's own emitters already stamp, and it is what
 * {@link DATASET_KIND_DOMAINS} maps onto the `x_specialization.domains` vocabulary.
 * Explicit targeting (FT-K's "a job MAY name a target provider") likewise has no home in
 * the 0.3.0 schema, so it rides **out of band** on the invoke envelope
 * ({@link RoutableJob.target}) rather than being smuggled into the manifest as an unknown
 * key — which admission would reject. Both are worth proposing upstream as KFT §3
 * additions; until then this is the honest reading of the contract as published.
 */
import {
  FINETUNE_CAPABILITY,
  type Capability,
  type CapabilitySpecialization,
} from "@contracts/capability-manifest";

/** The subset of a KCB manifest routing reads — a foreign provider's document fits too. */
export interface ProviderManifest {
  /** The provider's KINP agent id (`pinakes:agent:resolver`, `agora:agent:trainer`). */
  readonly identity: string;
  readonly capabilities: readonly Capability[];
}

/**
 * `dataset-jsonl-header.datasetKind` → the `x_specialization.domains` a job signals.
 *
 * Kinds are the ones koine's header schema names and this repo's own builders emit
 * (`ml/src/pinakes_ml/insimul_datasets.py`, `verbalize.py`, `kgqa.py`). A kind absent
 * from this table carries **no** specialization signal — which is the point: a generic
 * `text-generation` job is left to the general trainer rather than being guessed into a
 * narrow provider.
 */
export const DATASET_KIND_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  "rule-sft": ["slm-rule-authoring"],
  "rule-preferences": ["slm-rule-authoring"],
  "lore-qa": ["neurosymbolic"],
  kgqa: ["neurosymbolic"],
  verbalizations: ["neurosymbolic"],
};

/** What routing reads out of a KFT finetune-job manifest. */
export interface FinetuneJobSignals {
  readonly modality: string;
  readonly method: string;
  /** How many KMI assets the dataset names — a non-zero count is a multimodal job. */
  readonly mediaCount: number;
  readonly datasetKind: string | null;
  /** The emitting project (`pinakes`, `insimul`, `analyzer`) — recorded, never routed on. */
  readonly source: string | null;
  /** The specialization domains {@link DATASET_KIND_DOMAINS} resolves the kind to. */
  readonly domains: readonly string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Read a job's routing signals. Deliberately tolerant: a malformed job is not this
 * module's to reject — `ml/src/pinakes_ml/kft.py` owns admission, and a job that routes
 * here and is then refused with a report is the intended flow, not a routing bug.
 */
export function jobSignals(job: unknown): FinetuneJobSignals {
  const manifest = record(job);
  const dataset = record(manifest.dataset);
  const header = record(dataset.header);
  const datasetKind = str(header.datasetKind) || null;
  return {
    modality: str(manifest.modality),
    method: str(manifest.method),
    mediaCount: Array.isArray(dataset.media) ? dataset.media.length : 0,
    datasetKind,
    source: str(header.source) || null,
    domains: datasetKind ? (DATASET_KIND_DOMAINS[datasetKind] ?? []) : [],
  };
}

/**
 * Preference tiers, best first. `specialized` is FT-K's "more specialized matching
 * provider"; `fallback` is a narrow provider the job gave no reason to prefer — it would
 * accept the work, but the general trainer should get it.
 */
export type CandidateRank = "specialized" | "general" | "fallback";

const RANK_ORDER: Readonly<Record<CandidateRank, number>> = {
  specialized: 2,
  general: 1,
  fallback: 0,
};

/** A provider that would accept the job, with the keys FT-K ranks on. */
export interface ProviderCandidate {
  readonly identity: string;
  readonly rank: CandidateRank;
  readonly specialization?: CapabilitySpecialization;
  /**
   * How many dimensions the provider narrows on (modality, methods, domains, egress).
   * FT-K's "more specialized" — a general provider scores 0.
   */
  readonly specificity: number;
  /** `cost.est_units`, the KCB §3 second key. */
  readonly cost: number;
  /** The job domains this provider is specialized for; empty unless `rank` is specialized. */
  readonly matchedDomains: readonly string[];
}

/**
 * A provider that would **refuse** the job at admission. The codes are
 * `ml/src/pinakes_ml/kft.py`'s, so the registry and the provider speak one vocabulary.
 */
export interface ProviderRejection {
  readonly identity: string;
  readonly code:
    | "no-finetune-capability"
    | "unsupported-modality"
    | "unsupported-method"
    | "unsupported-dataset-plane";
  readonly reason: string;
}

export type RoutingOutcome = "routed" | "tie" | "unroutable";

export interface RoutingDecision {
  readonly outcome: RoutingOutcome;
  /** The chosen provider's identity; null on a tie or when nothing matches. */
  readonly provider: string | null;
  readonly reason: string;
  /** Every provider that would accept the job, best first. */
  readonly candidates: readonly ProviderCandidate[];
  readonly rejected: readonly ProviderRejection[];
  readonly signals: FinetuneJobSignals;
}

/** The job as handed to the registry: the KFT manifest plus the out-of-band envelope. */
export interface RoutableJob {
  /** The KFT finetune-job manifest (`koine/schemas/finetune-job.schema.json`). */
  readonly job: unknown;
  /**
   * FT-K's explicit target, by provider identity. Carried on the invoke envelope
   * because KFT 0.3.0's job schema has nowhere to put it (see the module docstring).
   */
  readonly target?: string;
}

function finetuneCapabilityOf(manifest: ProviderManifest): Capability | undefined {
  return manifest.capabilities.find((c) => c.name === FINETUNE_CAPABILITY);
}

/** Whether the capability declares a `media`-plane **input** port (a multimodal trainer). */
function acceptsMediaDatasets(capability: Capability): boolean {
  return capability.inputs.some((port) => port.plane === "media");
}

/**
 * How narrow the advertisement is. Each declared constraint is one dimension the
 * provider will refuse a job on, so counting them ranks "more specialized" without
 * hard-coding either provider's identity.
 */
export function specificityOf(spec: CapabilitySpecialization | undefined): number {
  if (!spec || spec.provider_class === "general") return 0;
  let score = 0;
  if (spec.modality) score += 1;
  if (spec.methods.length > 0) score += 1;
  if (spec.domains.length > 0) score += 1;
  if (spec.egress === "local-only") score += 1;
  return score;
}

/**
 * Evaluate one provider against one job — a candidate or a rejection, never both.
 *
 * A provider with **no** `x_specialization` is the general case: "general" means it
 * declares no narrowing, so there is nothing to mismatch on. A provider that declares one
 * is held to its modality and methods, and earns the `specialized` rank only when the job
 * signals one of its domains.
 */
function evaluate(
  manifest: ProviderManifest,
  signals: FinetuneJobSignals,
): ProviderCandidate | ProviderRejection {
  const capability = finetuneCapabilityOf(manifest);
  if (!capability) {
    return {
      identity: manifest.identity,
      code: "no-finetune-capability",
      reason: `${manifest.identity} advertises no \`${FINETUNE_CAPABILITY}\` capability`,
    };
  }

  if (signals.mediaCount > 0 && !acceptsMediaDatasets(capability)) {
    return {
      identity: manifest.identity,
      code: "unsupported-dataset-plane",
      reason:
        `${manifest.identity} declares no media-plane input port, so it cannot train on ` +
        `the ${signals.mediaCount} KMI asset(s) this job names (KFT §4.1)`,
    };
  }

  const spec = capability.x_specialization;
  if (spec) {
    if (spec.modality && signals.modality && spec.modality !== signals.modality) {
      return {
        identity: manifest.identity,
        code: "unsupported-modality",
        reason:
          `${manifest.identity} is a ${spec.modality} provider and the job is ` +
          `${signals.modality}`,
      };
    }
    if (spec.methods.length > 0 && signals.method && !spec.methods.includes(signals.method)) {
      return {
        identity: manifest.identity,
        code: "unsupported-method",
        reason:
          `${manifest.identity} implements ${spec.methods.join(", ")} and the job asks ` +
          `for ${signals.method}`,
      };
    }
  }

  const declaredDomains = spec?.domains ?? [];
  const matchedDomains = signals.domains.filter((domain) => declaredDomains.includes(domain));
  const narrow = spec !== undefined && spec.provider_class === "specialized";
  const rank: CandidateRank = !narrow
    ? "general"
    : matchedDomains.length > 0
      ? "specialized"
      : "fallback";

  return {
    identity: manifest.identity,
    rank,
    ...(spec ? { specialization: spec } : {}),
    specificity: specificityOf(spec),
    cost: capability.cost.est_units,
    matchedDomains,
  };
}

function isRejection(result: ProviderCandidate | ProviderRejection): result is ProviderRejection {
  return "code" in result;
}

function tiedWith(best: ProviderCandidate): (c: ProviderCandidate) => boolean {
  return (c) => c.rank === best.rank && c.specificity === best.specificity && c.cost === best.cost;
}

function routedReason(best: ProviderCandidate, only: boolean): string {
  if (best.rank === "specialized") {
    return `${best.identity} is the more specialized match (${best.matchedDomains.join(", ")})`;
  }
  if (best.rank === "fallback") {
    return (
      `${best.identity} is a specialized provider and this job signals none of its ` +
      `domains (${best.specialization?.domains.join(", ") ?? "none declared"}), but it is ` +
      "the only provider that would accept the job — the general trainer is not registered"
    );
  }
  return only
    ? `${best.identity} is the only general provider that accepts this job`
    : `${best.identity} is the cheapest general provider that accepts this job (cost ${best.cost})`;
}

/**
 * Apply the FT-K tiebreak: explicit target › more specialized › lower cost › surface the
 * tie. Never picks silently between equals, and never picks a provider whose advertised
 * contract says it would refuse the job — routing to a provider that then refuses is the
 * failure this exists to prevent.
 */
export function selectFinetuneProvider(
  input: RoutableJob,
  manifests: readonly ProviderManifest[],
): RoutingDecision {
  const signals = jobSignals(input.job);
  const results = manifests.map((manifest) => evaluate(manifest, signals));
  const rejected = results.filter(isRejection);
  const candidates = results
    .filter((r): r is ProviderCandidate => !isRejection(r))
    .sort(
      (a, b) =>
        RANK_ORDER[b.rank] - RANK_ORDER[a.rank] ||
        b.specificity - a.specificity ||
        a.cost - b.cost,
    );

  const base = { candidates, rejected, signals };
  const target = input.target?.trim();
  if (target) {
    const chosen = candidates.find((c) => c.identity === target);
    if (chosen) {
      return {
        ...base,
        outcome: "routed",
        provider: chosen.identity,
        reason: `the job named ${target} explicitly (KFT §8, FT-K)`,
      };
    }
    const why = rejected.find((r) => r.identity === target);
    return {
      ...base,
      outcome: "unroutable",
      provider: null,
      reason: why
        ? `the job named ${target} explicitly, but it would refuse the job: ${why.reason}`
        : `the job named ${target} explicitly, but no such provider is registered`,
    };
  }

  if (candidates.length === 0) {
    return {
      ...base,
      outcome: "unroutable",
      provider: null,
      reason: `no registered provider accepts this job (${rejected.length} would refuse it)`,
    };
  }

  const [best] = candidates;
  const tied = candidates.filter(tiedWith(best));
  if (tied.length > 1) {
    return {
      ...base,
      outcome: "tie",
      provider: null,
      reason:
        `${tied.map((c) => c.identity).join(" and ")} match equally (rank ${best.rank}, ` +
        `specificity ${best.specificity}, cost ${best.cost}); KFT §8 surfaces an unbroken ` +
        "tie to the caller rather than resolving it silently",
    };
  }

  return {
    ...base,
    outcome: "routed",
    provider: best.identity,
    reason: routedReason(best, candidates.length === 1),
  };
}
