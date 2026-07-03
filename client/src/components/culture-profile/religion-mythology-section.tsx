import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Sparkles } from "lucide-react";

import {
  useEntitySummaries,
  useEntityDetail,
} from "@/hooks/use-progressive-entity";
import { RelatedEntities } from "@/components/shared/RelatedEntities";

/**
 * Progressive summary/detail loading (US-004): the collapsed card renders from a
 * lightweight `/api/summaries/religions` row (header fields only); the heavy
 * detail (description, pantheon, sacred texts, practices) is hydrated from
 * `/api/religions/:id` only when a card is expanded, behind a skeleton.
 */

/** Lightweight row from `/api/summaries/religions` — enough for the collapsed header. */
interface ReligionSummary {
  id: string;
  name: string;
  nativeName?: string | null;
  religionType: string;
  originRegion: string;
  timeOrigin: number | null;
  timeEnd: number | null;
}

/** Full record from `/api/religions/:id` — hydrated lazily on expand. */
interface ReligionDetail extends ReligionSummary {
  sacredTexts: string[];
  deityPantheon: string[];
  ritualPractices: string[];
  description: string;
}

interface Props {
  religionIds: string[];
  cultureName?: string;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

/** Pulse skeleton shown while a card's full detail is being fetched. */
function ReligionDetailSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
    </div>
  );
}

function ReligionCard({ religion }: { religion: ReligionSummary }) {
  const [expanded, setExpanded] = useState(false);
  // Detail-on-demand: fetches only once the card is expanded (US-004).
  const { data: detail, isLoading: isLoadingDetail } = useEntityDetail<ReligionDetail>(
    "religions",
    religion.id,
    { enabled: expanded },
  );

  const period =
    religion.timeOrigin !== null
      ? `${formatYear(religion.timeOrigin)} – ${
          religion.timeEnd !== null ? formatYear(religion.timeEnd) : "present"
        }`
      : null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <Sparkles className="h-4 w-4 text-indigo-600 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {religion.name}
            {religion.nativeName && (
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                {religion.nativeName}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {religion.religionType} · {religion.originRegion}
            {period && ` · ${period}`}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 space-y-2 text-xs">
          {isLoadingDetail || !detail ? (
            <ReligionDetailSkeleton />
          ) : (
            <>
              {detail.description && (
                <p className="text-gray-700 dark:text-gray-300">{detail.description}</p>
              )}
              {detail.deityPantheon.length > 0 && (
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">Pantheon:</span>{" "}
                  <span className="text-gray-700 dark:text-gray-300">
                    {detail.deityPantheon.join(", ")}
                  </span>
                </div>
              )}
              {detail.sacredTexts.length > 0 && (
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">
                    Sacred texts:
                  </span>{" "}
                  <span className="text-gray-700 dark:text-gray-300">
                    {detail.sacredTexts.join(", ")}
                  </span>
                </div>
              )}
              {detail.ritualPractices.length > 0 && (
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">Practices:</span>{" "}
                  <span className="text-gray-700 dark:text-gray-300">
                    {detail.ritualPractices.join(", ")}
                  </span>
                </div>
              )}
              {/* Related entities from the shared graph (US-006) */}
              <RelatedEntities
                entity={{
                  type: "religion",
                  id: religion.id,
                  name: religion.name,
                  region: religion.originRegion,
                }}
                limit={6}
                className="pt-2"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReligionMythologySection({ religionIds, cultureName }: Props) {
  // Fetch lightweight summaries first (US-004); detail is hydrated per-card on expand.
  const { data, isLoading } = useEntitySummaries<ReligionSummary>("religions", {
    enabled: religionIds.length > 0,
  });

  const matched = useMemo(() => {
    if (!data?.summaries) return [];
    const idSet = new Set(religionIds);
    return data.summaries.filter((r) => idSet.has(r.id));
  }, [data, religionIds]);

  if (religionIds.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
        No religions are associated with{" "}
        {cultureName ? <strong>{cultureName}</strong> : "this culture"}.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">Loading religions…</div>;
  }

  if (matched.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
        Could not find religion records for the {religionIds.length} associated id
        {religionIds.length === 1 ? "" : "s"}.
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {matched.length} religion{matched.length === 1 ? "" : "s"} associated with{" "}
        {cultureName ?? "this culture"}
      </div>
      {matched.map((r) => (
        <ReligionCard key={r.id} religion={r} />
      ))}
    </div>
  );
}
