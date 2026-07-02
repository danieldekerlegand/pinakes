import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Swords } from "lucide-react";

interface Belligerent {
  name: string;
  civilization_id: string | null;
}

interface Battle {
  id: string;
  name: string;
  date: string | number;
  belligerents: Belligerent[];
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

interface Props {
  civilizationId: string | null;
  cultureName?: string;
}

function formatYear(year: string | number): string {
  const n = typeof year === "string" ? parseInt(year, 10) : year;
  if (!Number.isFinite(n)) return String(year);
  if (n < 0) return `${Math.abs(n)} BCE`;
  return `${n} CE`;
}

function getOutcomeStyle(outcome: string): string {
  const lower = outcome.toLowerCase();
  if (lower.includes("decisive") && lower.includes("victory"))
    return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (lower.includes("victory")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (lower.includes("stalemate") || lower.includes("inconclusive"))
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (lower.includes("defeat") || lower.includes("destruction"))
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
}

function BattleCard({ battle, civilizationId }: { battle: Battle; civilizationId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <Swords className="h-4 w-4 text-red-600 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {battle.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {formatYear(battle.date)}
            {battle.warName && ` · ${battle.warName}`}
          </div>
        </div>
        {battle.outcome && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getOutcomeStyle(battle.outcome)}`}
          >
            {battle.outcome}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 space-y-2 text-xs">
          <div>
            <span className="font-medium text-gray-600 dark:text-gray-400">Belligerents:</span>{" "}
            <span className="text-gray-700 dark:text-gray-300">
              {battle.belligerents
                .map((b) =>
                  b.civilization_id === civilizationId ? `${b.name} (this culture)` : b.name
                )
                .join(" vs. ")}
            </span>
          </div>
          {battle.casualtiesEstimate && (
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Casualties:</span>{" "}
              <span className="text-gray-700 dark:text-gray-300">{battle.casualtiesEstimate}</span>
            </div>
          )}
          {battle.significance && (
            <p className="text-gray-700 dark:text-gray-300">{battle.significance}</p>
          )}
          {battle.associatedLanguageChanges && (
            <div>
              <span className="font-medium text-gray-600 dark:text-gray-400">Linguistic impact:</span>{" "}
              <span className="text-gray-700 dark:text-gray-300">
                {battle.associatedLanguageChanges}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MilitaryWarfareSection({ civilizationId, cultureName }: Props) {
  const { data, isLoading } = useQuery<{ battles: Battle[] }>({
    queryKey: ["/api/battles"],
    enabled: !!civilizationId,
  });

  const matched = useMemo(() => {
    if (!data?.battles || !civilizationId) return [];
    return data.battles.filter((b) =>
      b.belligerents.some((bel) => bel.civilization_id === civilizationId)
    );
  }, [data, civilizationId]);

  if (!civilizationId) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
        This culture is not linked to a civilization, so no battle records can be scoped to it.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">Loading battles…</div>;
  }

  if (matched.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
        No recorded battles involve{" "}
        {cultureName ? <strong>{cultureName}</strong> : "this civilization"}.
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {matched.length} battle{matched.length === 1 ? "" : "s"} involving{" "}
        {cultureName ?? "this civilization"}
      </div>
      {matched
        .slice()
        .sort((a, b) => {
          const aN = typeof a.date === "string" ? parseInt(a.date, 10) : a.date;
          const bN = typeof b.date === "string" ? parseInt(b.date, 10) : b.date;
          return (Number.isFinite(aN) ? aN : 0) - (Number.isFinite(bN) ? bN : 0);
        })
        .map((b) => (
          <BattleCard key={b.id} battle={b} civilizationId={civilizationId} />
        ))}
    </div>
  );
}
