/**
 * Reusable provenance UI (US-010) — shows where a shared-graph fact came from so
 * a researcher can trust or cite it. Two pieces:
 *
 *   - {@link ProvenanceBadge} — a compact pill distinguishing a **sourced** fact
 *     (external citation) from a **derived/inferred** one, and flagging
 *     low-confidence data.
 *   - {@link ProvenanceList} — the full breakdown (source, source URL as a safe
 *     external link, retrieved-at, confidence) for a detail panel.
 *
 * Both are thin wrappers over the pure helpers in `@/lib/graph/provenance`, which
 * hold the classification/formatting logic and carry the unit tests (the repo has
 * no jsdom, so the "component tests" live against that module).
 */
import { BookMarked, GitBranch, ExternalLink, AlertTriangle } from "lucide-react";
import {
  classifyProvenance,
  isLowConfidence,
  formatConfidence,
  safeExternalUrl,
  hasProvenance,
  type Provenance,
} from "@/lib/graph/provenance";

/**
 * Compact pill: `Sourced` (citation) vs `Derived` (inferred), plus a
 * confidence chip that turns amber-warning when confidence is low.
 */
export function ProvenanceBadge({
  provenance,
  className = "",
}: {
  provenance: Provenance | null | undefined;
  className?: string;
}) {
  if (!hasProvenance(provenance)) return null;
  const prov = provenance!;
  const kind = classifyProvenance(prov);
  const sourced = kind === "sourced";
  const conf = formatConfidence(prov.confidence);
  const low = isLowConfidence(prov.confidence);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        data-testid="provenance-kind"
        data-kind={kind}
        title={
          sourced
            ? "Sourced fact — has an external citation"
            : "Derived fact — inferred, not directly cited"
        }
        className={`inline-flex items-center gap-1 rounded-sm px-1 py-0 text-[10px] font-medium uppercase tracking-wide ${
          sourced
            ? "bg-emerald-100 text-emerald-700"
            : "bg-amber-100 text-amber-700"
        }`}
      >
        {sourced ? (
          <BookMarked className="h-2.5 w-2.5" />
        ) : (
          <GitBranch className="h-2.5 w-2.5" />
        )}
        {sourced ? "Sourced" : "Derived"}
      </span>
      {conf !== null && (
        <span
          data-testid="provenance-confidence"
          data-low={low ? "true" : "false"}
          title={low ? "Low-confidence data" : "Confidence"}
          className={`inline-flex items-center gap-0.5 rounded-sm px-1 py-0 text-[10px] font-medium tabular-nums ${
            low
              ? "bg-amber-100 text-amber-700"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {low && <AlertTriangle className="h-2.5 w-2.5" />}
          {conf}
        </span>
      )}
    </span>
  );
}

/**
 * Full provenance breakdown for a detail panel: the sourced/derived badge, the
 * source, a safe external link to the source URL, the retrieval time, and the
 * confidence. Renders nothing when the fact carries no provenance at all.
 */
export function ProvenanceList({
  provenance,
  className = "",
}: {
  provenance: Provenance | null | undefined;
  className?: string;
}) {
  if (!hasProvenance(provenance)) return null;
  const prov = provenance!;
  const href = safeExternalUrl(prov.sourceUrl);

  return (
    <div
      data-testid="provenance-list"
      className={`space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Provenance
        </span>
        <ProvenanceBadge provenance={prov} />
      </div>
      <dl className="space-y-1.5">
        {prov.source && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-400">
              Source
            </dt>
            <dd className="text-xs text-gray-700 dark:text-gray-300">
              {prov.source}
            </dd>
          </div>
        )}
        {prov.sourceUrl && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-400">
              Source URL
            </dt>
            <dd className="text-xs">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                  data-testid="provenance-source-link"
                >
                  <span className="truncate">{prov.sourceUrl}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <span className="break-all text-gray-500">{prov.sourceUrl}</span>
              )}
            </dd>
          </div>
        )}
        {prov.retrievedAt && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-400">
              Retrieved
            </dt>
            <dd className="text-xs text-gray-700 dark:text-gray-300">
              {prov.retrievedAt}
            </dd>
          </div>
        )}
        {formatConfidence(prov.confidence) !== null && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-400">
              Confidence
            </dt>
            <dd className="text-xs text-gray-700 dark:text-gray-300">
              {formatConfidence(prov.confidence)}
              {isLowConfidence(prov.confidence) && (
                <span className="ml-1 text-amber-600" data-testid="provenance-low-flag">
                  (low)
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
