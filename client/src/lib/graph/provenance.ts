/**
 * Pure, DOM-free helpers for surfacing where a shared-graph fact came from
 * (US-010). A graph node/edge carries the culture-scrape provenance columns as
 * plain properties (`source`, `source_url`, `retrieved_at`, `confidence`); this
 * module normalises them into a {@link Provenance} record, classifies a fact as
 * **sourced** (has an external citation) vs **derived/inferred** (produced by a
 * Datalog rule or otherwise uncited), and flags low-confidence data.
 *
 * Everything here is pure so it can be unit-tested under vitest's node
 * environment — the repo has no jsdom/testing-library, so the React components
 * in `components/graph/Provenance.tsx` stay thin wrappers over these functions
 * and the "component tests" exercise this module (see
 * `provenance.test.ts`), matching the existing transform-test convention.
 */

/** The provenance/confidence fields a graph fact may carry. */
export interface Provenance {
  /** Where the fact came from — a corpus/adapter id or an inference marker. */
  source: string | null;
  /** A citation URL, when the fact has one. */
  sourceUrl: string | null;
  /** When the source was retrieved (ISO string), when recorded. */
  retrievedAt: string | null;
  /** 0–1 confidence, when the fact carries one. */
  confidence: number | null;
}

/** Whether a fact is directly attributable or produced by inference. */
export type ProvenanceKind = "sourced" | "derived";

/**
 * `source` values that mark a fact as inferred/derived rather than cited. The
 * culture-scrape Datalog layer is a *derived* view of the TSV source of truth,
 * so edges/nodes it materialises are attributed to one of these instead of an
 * external citation.
 */
const INFERENCE_MARKERS = [
  "inference",
  "inferred",
  "datalog",
  "derived",
  "computed",
  "correlation",
] as const;

/** Confidence at or below this is surfaced as low-confidence and flagged. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * Normalise a graph fact's raw properties into a {@link Provenance}. Accepts the
 * common aliases so it works over both node and edge property bags.
 */
export function extractProvenance(
  properties: Record<string, unknown> | null | undefined,
): Provenance {
  const p = properties ?? {};
  return {
    source: str(p.source) ?? str(p.source_query),
    sourceUrl: str(p.source_url) ?? str(p.sourceUrl),
    retrievedAt: str(p.retrieved_at) ?? str(p.retrievedAt),
    confidence: num(p.confidence),
  };
}

/** True when none of the provenance fields carry a value. */
export function hasProvenance(prov: Provenance | null | undefined): boolean {
  if (!prov) return false;
  return (
    prov.source !== null ||
    prov.sourceUrl !== null ||
    prov.retrievedAt !== null ||
    prov.confidence !== null
  );
}

/**
 * Classify a fact as `sourced` (directly attributable) or `derived` (inferred /
 * uncited). A fact is sourced when it carries a citation URL, or a `source` that
 * is not an inference marker; otherwise it is derived — including facts with no
 * source at all, which have nothing to cite.
 */
export function classifyProvenance(
  prov: Provenance | null | undefined,
): ProvenanceKind {
  if (!prov) return "derived";
  const source = prov.source?.toLowerCase() ?? null;
  const isInferred =
    source !== null &&
    INFERENCE_MARKERS.some((m) => source.includes(m));
  if (isInferred) return "derived";
  if (prov.sourceUrl !== null) return "sourced";
  if (source !== null) return "sourced";
  return "derived";
}

/** True when a confidence is present and at/below the low-confidence threshold. */
export function isLowConfidence(
  confidence: number | null | undefined,
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): boolean {
  return typeof confidence === "number" && confidence <= threshold;
}

/** A `0.42` → `"42%"` label, or `null` when there is no confidence. */
export function formatConfidence(
  confidence: number | null | undefined,
): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Return the URL only when it is a safe `http(s)` link, else `null`. Guards the
 * external-link affordance against `javascript:`/`data:`/relative values so the
 * UI never renders an unsafe href.
 */
export function safeExternalUrl(
  url: string | null | undefined,
): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}
