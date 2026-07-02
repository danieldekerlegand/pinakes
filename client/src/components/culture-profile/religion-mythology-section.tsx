import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Sparkles } from "lucide-react";

interface Religion {
  id: string;
  name: string;
  nativeName: string;
  religionType: string;
  originRegion: string;
  timeOrigin: number | null;
  timeEnd: number | null;
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

function ReligionCard({ religion }: { religion: Religion }) {
  const [expanded, setExpanded] = useState(false);
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
          {religion.description && (
            <p className="text-gray-700 dark:text-gray-300">{religion.description}</p>
          )}
          {religion.deityPantheon.length > 0 && (
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Pantheon:</span>{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {religion.deityPantheon.join(", ")}
              </span>
            </div>
          )}
          {religion.sacredTexts.length > 0 && (
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Sacred texts:</span>{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {religion.sacredTexts.join(", ")}
              </span>
            </div>
          )}
          {religion.ritualPractices.length > 0 && (
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Practices:</span>{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {religion.ritualPractices.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReligionMythologySection({ religionIds, cultureName }: Props) {
  const { data, isLoading } = useQuery<{ religions: Religion[] }>({
    queryKey: ["/api/religions"],
    enabled: religionIds.length > 0,
  });

  const matched = useMemo(() => {
    if (!data?.religions) return [];
    const idSet = new Set(religionIds);
    return data.religions.filter((r) => idSet.has(r.id));
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
