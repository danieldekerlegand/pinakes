/**
 * Confidence rubric — the single source of truth for per-provenance-class
 * confidence priors (tiered-trust corpus, US-001).
 *
 * Before this rubric, `confidence` was a blanket per-source constant scattered
 * across the acquire scripts and the export (Wikidata pulls stamped 1.0,
 * lexicon-derived rows a mid-scale default), so any probabilistic engine would
 * learn from fake uncertainty. This module exposes the machine-readable rubric
 * (`./confidence-rubric.json`) as typed accessors; acquisition, linkers, and the
 * canonical export name their {@link ConfidenceClass} instead of hard-coding a
 * literal, so the numbers are tuned in ONE place.
 *
 * The priors are chosen to preserve every historically-emitted confidence value,
 * so introducing the rubric is data-neutral (see `docs/canonical-schema.md` §4.4).
 */
import confidenceRubricJson from "./confidence-rubric.json";
import type { ConfidenceClassName } from "./generated/confidence-rubric";

export type { ConfidenceClassName } from "./generated/confidence-rubric";
export {
  CONFIDENCE_CLASS_ORDER,
  CONFIDENCE_PRIORS,
  CONFIDENCE_RUBRIC_VERSION,
} from "./generated/confidence-rubric";

/** One provenance class: its numeric prior in `[0, 1]` and the rationale. */
export interface ConfidenceClassEntry {
  readonly prior: number;
  readonly rationale: string;
}

/** The whole machine-readable rubric. */
export interface ConfidenceRubric {
  readonly version: string;
  readonly title: string;
  readonly description: string;
  /** Provenance classes ranked most- to least-trusted (informational ordering). */
  readonly order: readonly string[];
  readonly classes: Readonly<Record<string, ConfidenceClassEntry>>;
}

/** The confidence rubric. Structural drift in the JSON breaks `npm run check`. */
export const CONFIDENCE_RUBRIC = confidenceRubricJson as ConfidenceRubric;

/**
 * A known provenance class name. The generated literal union
 * (`./generated/confidence-rubric`), which is the same set the Python binding's
 * `ConfidenceClass` declares — one vocabulary, two languages.
 */
export type ConfidenceClass = ConfidenceClassName;

/**
 * The confidence prior for a provenance class, in `[0, 1]`. Pass `scale: 100`
 * to get the value on a lexicon's 0–100 scale (some lexicons store confidence
 * as a percentage; the export's {@link normaliseConfidence} converts back).
 */
export function confidenceForClass(
  cls: ConfidenceClass,
  opts: { scale?: 1 | 100 } = {},
): number {
  const entry = CONFIDENCE_RUBRIC.classes[cls];
  if (entry === undefined) {
    throw new Error(`confidence-rubric: unknown class "${cls}"`);
  }
  return entry.prior * (opts.scale ?? 1);
}

/**
 * The confidence prior as a string cell for a lexicon/TSV row. `scale: 100`
 * emits an integer percentage (e.g. `"90"`); the default 0–1 scale emits the
 * canonical decimal (e.g. `"0.8"`).
 */
export function confidenceCellForClass(
  cls: ConfidenceClass,
  opts: { scale?: 1 | 100 } = {},
): string {
  return String(confidenceForClass(cls, opts));
}

/**
 * Assert the rubric is well-formed: every ordered class resolves, every prior is
 * a finite number in `[0, 1]`, `order` covers exactly the defined classes, and
 * the ordering is monotonically non-increasing by prior. Throws on the first
 * violation. Runtime counterpart to the compile-time shape check on
 * {@link CONFIDENCE_RUBRIC}.
 */
export function assertValidConfidenceRubric(
  rubric: ConfidenceRubric = CONFIDENCE_RUBRIC,
): void {
  const classNames = Object.keys(rubric.classes);
  const ordered = new Set(rubric.order);
  if (ordered.size !== rubric.order.length) {
    throw new Error("confidence-rubric: order contains duplicates");
  }
  if (
    ordered.size !== classNames.length ||
    !classNames.every((c) => ordered.has(c))
  ) {
    throw new Error(
      "confidence-rubric: order must list exactly the defined classes",
    );
  }
  let previous = Number.POSITIVE_INFINITY;
  for (const name of rubric.order) {
    const entry = rubric.classes[name];
    if (entry === undefined) {
      throw new Error(`confidence-rubric: order names unknown class "${name}"`);
    }
    if (
      typeof entry.prior !== "number" ||
      !Number.isFinite(entry.prior) ||
      entry.prior < 0 ||
      entry.prior > 1
    ) {
      throw new Error(
        `confidence-rubric: class "${name}" prior must be a number in [0,1]`,
      );
    }
    if (entry.prior > previous) {
      throw new Error(
        `confidence-rubric: order is not monotonically non-increasing at "${name}"`,
      );
    }
    previous = entry.prior;
    if (typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
      throw new Error(`confidence-rubric: class "${name}" needs a rationale`);
    }
  }
}
