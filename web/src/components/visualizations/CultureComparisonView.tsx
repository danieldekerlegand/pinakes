import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X, Landmark, Plus, Search, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SideBySideComparisonTable,
  type SideBySideComparisonColumn,
  type ComparisonRow,
} from "@/components/ui/comparison-table";
import type { CultureProfile } from "@contracts/types";
import {
  COMPARISON_DIMENSIONS,
  MAX_COMPARE,
  MIN_COMPARE,
  computeSharedTraits,
  formatTimePeriod,
  getCategories,
  getDimensionsByCategory,
  rowMatchState,
  searchProfiles,
} from "./culture-comparison-utils";

interface CultureComparisonViewProps {
  isOpen: boolean;
  onClose: () => void;
  initialCultureIds?: string[];
}

const MATCH_COLORS: Record<string, string> = {
  "all-match":
    "bg-emerald-50 dark:bg-emerald-950/30 border-l-2 border-emerald-400",
  "all-differ": "bg-amber-50 dark:bg-amber-950/30 border-l-2 border-amber-400",
  partial: "bg-sky-50 dark:bg-sky-950/30 border-l-2 border-sky-400",
};

export default function CultureComparisonView({
  isOpen,
  onClose,
  initialCultureIds = [],
}: CultureComparisonViewProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialCultureIds);
  const [searchQuery, setSearchQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(initialCultureIds.length === 0);

  const { data: listData, isLoading: loadingList } = useQuery<{
    profiles: CultureProfile[];
    count: number;
  }>({
    queryKey: ["/api/culture-profiles"],
    queryFn: async () => {
      const response = await fetch("/api/culture-profiles");
      if (!response.ok) throw new Error("Failed to load culture profiles");
      return response.json();
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  const allProfiles = listData?.profiles ?? [];

  const selectedProfiles = useMemo(
    () =>
      selectedIds
        .map((id) => allProfiles.find((p) => p.id === id))
        .filter((p): p is CultureProfile => Boolean(p)),
    [selectedIds, allProfiles]
  );

  const searchResults = useMemo(
    () => searchProfiles(allProfiles, searchQuery),
    [allProfiles, searchQuery]
  );

  const sharedTraits = useMemo(
    () => computeSharedTraits(selectedProfiles),
    [selectedProfiles]
  );

  const totalSharedCount = useMemo(() => {
    return Object.values(sharedTraits).reduce((sum, arr) => sum + arr.length, 0);
  }, [sharedTraits]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  };

  const removeSelected = (id: string) => {
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const columns: SideBySideComparisonColumn<CultureProfile>[] = useMemo(
    () =>
      selectedProfiles.map((p) => ({
        key: p.id,
        label: p.name,
        data: p,
      })),
    [selectedProfiles]
  );

  const rowsByCategory = useMemo(() => {
    return getCategories().map((category) => {
      const dims = getDimensionsByCategory(category);
      const rows: ComparisonRow<CultureProfile>[] = dims.map((dim) => ({
        key: dim.key,
        label: dim.label,
        getValue: (p) => dim.getValue(p),
        renderCell: (value) => {
          const values = selectedProfiles.map((p) => dim.getValue(p));
          const state = rowMatchState(values);
          const matchClass = MATCH_COLORS[state] ?? "";
          const str = typeof value === "string" ? value : String(value ?? "");
          return (
            <div
              className={`px-2 py-1 rounded text-sm ${matchClass}`}
              data-testid={`cell-${dim.key}`}
              data-match-state={state}
            >
              {str}
            </div>
          );
        },
      }));
      return { category, rows };
    });
  }, [selectedProfiles]);

  if (!isOpen) return null;

  const canCompare = selectedProfiles.length >= MIN_COMPARE;

  return (
    <div
      className="fixed inset-0 z-50 bg-white dark:bg-gray-900 overflow-auto"
      data-testid="culture-comparison-view"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Culture Comparison</h2>
          <span className="text-sm text-gray-500" data-testid="selected-count">
            {selectedProfiles.length} of {MAX_COMPARE} selected
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="comparison-close"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Selected culture chips */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedProfiles.map((p) => (
            <Badge
              key={p.id}
              variant="secondary"
              className="pl-2 pr-1 py-1 gap-1"
              data-testid={`chip-${p.id}`}
            >
              <span>{p.name}</span>
              <button
                type="button"
                className="ml-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700 p-0.5"
                onClick={() => removeSelected(p.id)}
                aria-label={`Remove ${p.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {selectedProfiles.length < MAX_COMPARE && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-7"
              onClick={() => setPickerOpen((v) => !v)}
              data-testid="toggle-picker"
            >
              <Plus className="h-3.5 w-3.5" />
              Add culture
            </Button>
          )}
        </div>

        {/* Picker */}
        {pickerOpen && (
          <section
            className="border rounded-lg p-3 space-y-3 bg-gray-50 dark:bg-gray-800/50"
            data-testid="culture-picker"
          >
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search cultures by name or region…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-sm"
                data-testid="culture-search"
              />
            </div>
            {loadingList ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                <span className="ml-2 text-sm text-gray-500">
                  Loading cultures…
                </span>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
                {searchResults.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    No cultures match your search.
                  </p>
                ) : (
                  searchResults.slice(0, 50).map((p) => {
                    const isSelected = selectedIds.includes(p.id);
                    const disabled =
                      !isSelected && selectedIds.length >= MAX_COMPARE;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleSelected(p.id)}
                        className={`w-full text-left py-2 px-2 flex items-center justify-between hover:bg-white dark:hover:bg-gray-900 rounded ${
                          disabled ? "opacity-50 cursor-not-allowed" : ""
                        } ${isSelected ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}`}
                        data-testid={`picker-item-${p.id}`}
                      >
                        <div>
                          <div className="text-sm font-medium">{p.name}</div>
                          <div className="text-xs text-gray-500">
                            {p.region} · {formatTimePeriod(p.timePeriodStart, p.timePeriodEnd)}
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-indigo-600" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </section>
        )}

        {/* Legend */}
        {canCompare && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-200 border border-emerald-400" />
              All match
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-sky-200 border border-sky-400" />
              Partial match
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-200 border border-amber-400" />
              All differ
            </div>
          </div>
        )}

        {/* Shared traits summary */}
        {canCompare && totalSharedCount > 0 && (
          <section
            className="border rounded-lg p-3 bg-emerald-50/50 dark:bg-emerald-950/20"
            data-testid="shared-traits"
          >
            <h3 className="text-sm font-semibold mb-2">
              Shared Traits ({totalSharedCount})
            </h3>
            <div className="space-y-1 text-xs">
              {Object.entries(sharedTraits)
                .filter(([, arr]) => arr.length > 0)
                .map(([key, arr]) => (
                  <div key={key} className="flex gap-2">
                    <span className="font-medium capitalize text-gray-600 dark:text-gray-300 min-w-[140px]">
                      {key.replace(/([A-Z])/g, " $1").trim()}:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {arr.map((id) => (
                        <Badge
                          key={id}
                          variant="outline"
                          className="text-[10px] py-0"
                        >
                          {id}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Comparison table by category */}
        {!canCompare ? (
          <div
            className="text-sm text-gray-500 text-center py-12 border rounded-lg"
            data-testid="empty-state"
          >
            Select at least {MIN_COMPARE} cultures to start comparing.
          </div>
        ) : (
          <div className="space-y-6" data-testid="comparison-sections">
            {rowsByCategory.map(({ category, rows }) => (
              <section key={category} data-testid={`section-${category.toLowerCase().replace(/\s+/g, "-")}`}>
                <h3 className="text-sm font-semibold mb-2 text-indigo-700 dark:text-indigo-300">
                  {category}
                </h3>
                <SideBySideComparisonTable<CultureProfile>
                  columns={columns}
                  rows={rows}
                  attributeLabel="Dimension"
                  striped
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
