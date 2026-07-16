/**
 * Trust tiers — the TypeScript mirror of culture-scrape's
 * `orchestrate/tiers.py` `classify_tier` (US-002, Phase 3 of
 * `NEUROSYMBOLIC_ROADMAP.md`). One pure function classifies a node or edge into
 * its trust tier from provenance columns that are **already** first-class and
 * queryable — `source`, `wikidata_qid`, `source_url` — so `tier` is *derived*,
 * never a new canonical column.
 *
 * This module is the single TS source of truth for that policy: the graph
 * explorer/detail panels (`client/src/lib/graph/provenance.ts`) and the
 * data-quality tier report (`server/services/data-quality-scorer.ts`) both call
 * {@link classifyTrustTier} so the app labels a fact the same way the Python
 * corpus build does. It is dependency-free and DOM-free so it unit-tests under
 * vitest's node environment and imports cleanly in both `client/` and `server/`.
 *
 * The precedence must stay byte-identical to `tiers.classify_tier` — a merged
 * row can carry several signals, so order matters (see {@link classifyTrustTier}).
 */

/** The trust tiers, most-to-least trusted. */
export type TrustTier = "curated" | "auto-admitted" | "quarantine" | "inferred";

/** The `source` token a row that came through the human-curated lexicon gate carries. */
export const PINAKES_SOURCE = "pinakes";

/** The `inferred:<linker>` provenance prefix a linker-minted row carries. */
const INFERRED_PREFIX = "inferred:";

/**
 * Delimiter `culturescrape.schema.merge` joins concatenated `source` values with,
 * so a reconciled row carries `"pinakes;wikidata"`.
 */
const SOURCE_DELIMITER = ";";

/** Every tier, most-to-least trusted — the stable order tier reports render in. */
export const ALL_TRUST_TIERS: readonly TrustTier[] = [
  "curated",
  "auto-admitted",
  "quarantine",
  "inferred",
] as const;

/** Human-facing metadata for one trust tier (label, description, sort order). */
export interface TrustTierMeta {
  tier: TrustTier;
  /** Short display label. */
  label: string;
  /** One-line explanation for a tooltip / detail row. */
  description: string;
  /** Stable order index (0 = most trusted). */
  order: number;
}

/** Per-tier display metadata, keyed by tier. */
export const TRUST_TIER_META: Record<TrustTier, TrustTierMeta> = {
  curated: {
    tier: "curated",
    label: "Curated",
    description: "Human-vetted through the pinakes lexicon curation gate.",
    order: 0,
  },
  "auto-admitted": {
    tier: "auto-admitted",
    label: "Auto-admitted",
    description:
      "QID-anchored and reference-backed — admitted to the graph corpus automatically with rubric confidence.",
    order: 1,
  },
  quarantine: {
    tier: "quarantine",
    label: "Quarantine",
    description:
      "Acquired but not both QID-anchored and reference-backed — awaiting curation.",
    order: 2,
  },
  inferred: {
    tier: "inferred",
    label: "Inferred",
    description: "Linker-minted hub or inferred edge — derived scaffolding, not an acquired fact.",
    order: 3,
  },
};

/** The provenance signals {@link classifyTrustTier} classifies a fact from. */
export interface TrustTierInput {
  /**
   * The `source` provenance value (may be a `;`-joined multi-source token, e.g.
   * `"pinakes;wikidata"`).
   */
  source?: string | null;
  /** The Wikidata QID, when the node carries one (edges have no QID column). */
  wikidataQid?: string | null;
  /** A resolvable citation URL, when the fact has one. */
  sourceUrl?: string | null;
  /** Whether the row is an edge (edges auto-admit on a citation alone). */
  isEdge?: boolean;
}

function trim(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The distinct `source` provenance tokens on a row (merge-split, non-empty). */
function sourceTokens(source: string | null | undefined): string[] {
  return trim(source)
    .split(SOURCE_DELIMITER)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Classify a node or edge into its trust tier (pure). Precedence — a merged row
 * can carry several signals, so order matters (mirrors `tiers.classify_tier`):
 *
 *  1. any `inferred:<linker>` `source` token → `inferred`;
 *  2. a `pinakes` `source` token → `curated` (a curated row that *also*
 *     reconciled to Wikidata stays curated — human vetting is the strongest signal);
 *  3. otherwise an acquired fact: `auto-admitted` iff it is QID-anchored (a node
 *     with a `wikidataQid`; edges have no QID so the requirement does not apply)
 *     **and** reference-backed (a non-empty `sourceUrl`), else `quarantine`.
 */
export function classifyTrustTier(input: TrustTierInput): TrustTier {
  const tokens = sourceTokens(input.source);
  if (tokens.some((t) => t.startsWith(INFERRED_PREFIX))) return "inferred";
  if (tokens.includes(PINAKES_SOURCE)) return "curated";
  const referenceBacked = trim(input.sourceUrl).length > 0;
  if (input.isEdge) return referenceBacked ? "auto-admitted" : "quarantine";
  const qidAnchored = trim(input.wikidataQid).length > 0;
  if (qidAnchored && referenceBacked) return "auto-admitted";
  return "quarantine";
}

/** Display metadata for a tier (label, description, order). */
export function trustTierMeta(tier: TrustTier): TrustTierMeta {
  return TRUST_TIER_META[tier];
}
