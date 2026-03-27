import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X, Zap, ChevronRight, ChevronDown, Filter } from "lucide-react";
import VisualizationRecommendations from "@/components/VisualizationRecommendations";

interface SoundChange {
  id: string;
  name: string;
  familyId: string;
  sourceLanguageId: string;
  targetLanguageId: string;
  changeRule: string;
  environment: string;
  dateRange: string;
  examples: Array<{ before: string; after: string; meaning: string }>;
  relatedChanges: string[];
}

interface SoundChangesResponse {
  changes: SoundChange[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function parseDateRange(dateRange: string): { start: number; end: number } {
  const parts = dateRange.split(" to ");
  return {
    start: parseInt(parts[0]) || 0,
    end: parseInt(parts[1]) || 0,
  };
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export default function SoundChangesPanel({ isOpen, onClose }: Props) {
  const [selectedFamily, setSelectedFamily] = useState<string>("all");
  const [expandedChange, setExpandedChange] = useState<string | null>(null);
  const [selectedExample, setSelectedExample] = useState<{ changeId: string; idx: number } | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "timeline">("cards");

  const { data: soundChangesData } = useQuery<SoundChangesResponse>({
    queryKey: ["/api/sound-changes"],
    enabled: isOpen,
  });

  const changes = soundChangesData?.changes ?? [];

  const families = useMemo(() => {
    const fams = new Set<string>();
    changes.forEach((c) => fams.add(c.familyId));
    return Array.from(fams).sort();
  }, [changes]);

  const filteredChanges = useMemo(() => {
    if (selectedFamily === "all") return changes;
    return changes.filter((c) => c.familyId === selectedFamily);
  }, [changes, selectedFamily]);

  // Group by family for timeline view
  const timelineSorted = useMemo(() => {
    return [...filteredChanges].sort((a, b) => {
      const aStart = parseDateRange(a.dateRange).start;
      const bStart = parseDateRange(b.dateRange).start;
      return aStart - bStart;
    });
  }, [filteredChanges]);

  // Find related changes for chain visualization
  const getRelatedChanges = (change: SoundChange): SoundChange[] => {
    return change.relatedChanges
      .map((id) => changes.find((c) => c.id === id))
      .filter((c): c is SoundChange => c !== undefined);
  };

  // Timeline range
  const timelineRange = useMemo(() => {
    if (timelineSorted.length === 0) return { min: -3000, max: 2000 };
    let min = Infinity;
    let max = -Infinity;
    timelineSorted.forEach((c) => {
      const { start, end } = parseDateRange(c.dateRange);
      if (start < min) min = start;
      if (end > max) max = end;
    });
    return { min: min - 200, max: max + 200 };
  }, [timelineSorted]);

  if (!isOpen) return null;

  const yearToPercent = (year: number) => {
    const range = timelineRange.max - timelineRange.min;
    return ((year - timelineRange.min) / range) * 100;
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0">
          <div className="flex justify-between items-start">
            <div className="flex items-center space-x-3">
              <Zap className="h-6 w-6 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Sound Changes
                </h2>
                <p className="text-sm text-gray-600">
                  Explore historical sound shifts across language families
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-4 mt-4">
            {/* Family filter */}
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select
                className="text-sm border rounded px-2 py-1 bg-white"
                value={selectedFamily}
                onChange={(e) => setSelectedFamily(e.target.value)}
              >
                <option value="all">All Families ({changes.length})</option>
                {families.map((f) => (
                  <option key={f} value={f}>
                    {f} ({changes.filter((c) => c.familyId === f).length})
                  </option>
                ))}
              </select>
            </div>

            {/* View mode */}
            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1 text-sm ${viewMode === "cards" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600"}`}
                onClick={() => setViewMode("cards")}
              >
                Cards
              </button>
              <button
                className={`px-3 py-1 text-sm ${viewMode === "timeline" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600"}`}
                onClick={() => setViewMode("timeline")}
              >
                Timeline
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === "cards" ? (
            <div className="space-y-3">
              {filteredChanges.map((change) => {
                const isExpanded = expandedChange === change.id;
                const related = getRelatedChanges(change);
                const { start, end } = parseDateRange(change.dateRange);

                return (
                  <Card key={change.id} className="overflow-hidden">
                    {/* Card header */}
                    <button
                      className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
                      onClick={() =>
                        setExpandedChange(isExpanded ? null : change.id)
                      }
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-gray-900">
                            {change.name}
                          </h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            {change.familyId}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                          <span className="font-mono text-amber-700">
                            {change.changeRule}
                          </span>
                          <span>
                            {formatYear(start)} – {formatYear(end)}
                          </span>
                        </div>
                        {change.environment && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Environment: {change.environment}
                          </p>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      )}
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t bg-gray-50">
                        {/* Rule display */}
                        <div className="mt-3 p-3 bg-white rounded border">
                          <div className="text-sm font-medium text-gray-700 mb-1">
                            Sound Change Rule
                          </div>
                          <div className="text-lg font-mono text-amber-800">
                            {change.changeRule}
                          </div>
                          {change.environment && (
                            <div className="text-sm text-gray-500 mt-1">
                              in environment: {change.environment}
                            </div>
                          )}
                          <div className="text-xs text-gray-400 mt-1">
                            {change.sourceLanguageId} → {change.targetLanguageId}
                          </div>
                        </div>

                        {/* Examples */}
                        <div className="mt-3">
                          <div className="text-sm font-medium text-gray-700 mb-2">
                            Examples (click to highlight)
                          </div>
                          <div className="space-y-1">
                            {change.examples.map((ex, idx) => {
                              const isSelected =
                                selectedExample?.changeId === change.id &&
                                selectedExample?.idx === idx;
                              return (
                                <button
                                  key={idx}
                                  className={`w-full text-left px-3 py-2 rounded text-sm flex items-center space-x-3 transition-colors ${
                                    isSelected
                                      ? "bg-amber-100 border border-amber-300"
                                      : "bg-white border hover:bg-amber-50"
                                  }`}
                                  onClick={() =>
                                    setSelectedExample(
                                      isSelected
                                        ? null
                                        : { changeId: change.id, idx }
                                    )
                                  }
                                >
                                  <span className="font-mono text-red-600 line-through">
                                    {ex.before}
                                  </span>
                                  <ChevronRight className="h-4 w-4 text-gray-400" />
                                  <span className="font-mono text-green-700 font-medium">
                                    {ex.after}
                                  </span>
                                  <span className="text-gray-500 ml-auto">
                                    "{ex.meaning}"
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Related changes (chain) */}
                        {related.length > 0 && (
                          <div className="mt-3">
                            <div className="text-sm font-medium text-gray-700 mb-2">
                              Related Sound Changes
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {related.map((r) => (
                                <button
                                  key={r.id}
                                  className="text-xs px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 transition-colors"
                                  onClick={() => {
                                    setExpandedChange(r.id);
                                    // Scroll to the change
                                    setTimeout(() => {
                                      document
                                        .getElementById(`sc-${r.id}`)
                                        ?.scrollIntoView({
                                          behavior: "smooth",
                                          block: "center",
                                        });
                                    }, 100);
                                  }}
                                >
                                  {r.name}{" "}
                                  <span className="font-mono ml-1 text-amber-600">
                                    {r.changeRule}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div id={`sc-${change.id}`} />
                  </Card>
                );
              })}

              {filteredChanges.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No sound changes found for this filter.
                </div>
              )}
            </div>
          ) : (
            /* Timeline view */
            <div className="relative">
              {/* Timeline axis */}
              <div className="mb-6">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{formatYear(timelineRange.min)}</span>
                  <span>{formatYear(Math.round((timelineRange.min + timelineRange.max) / 2))}</span>
                  <span>{formatYear(timelineRange.max)}</span>
                </div>
                <div className="h-1 bg-gray-200 rounded relative">
                  <div
                    className="absolute h-full bg-amber-300 rounded"
                    style={{ left: `${yearToPercent(0)}%`, width: "1px" }}
                  />
                </div>
              </div>

              {/* Timeline entries */}
              <div className="space-y-2">
                {timelineSorted.map((change) => {
                  const { start, end } = parseDateRange(change.dateRange);
                  const left = yearToPercent(start);
                  const width = Math.max(
                    yearToPercent(end) - yearToPercent(start),
                    2
                  );

                  return (
                    <div key={change.id} className="relative">
                      <div className="flex items-center space-x-3">
                        <div className="w-40 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                          {change.name}
                        </div>
                        <div className="flex-1 relative h-6">
                          <div className="absolute inset-0 bg-gray-50 rounded" />
                          <button
                            className="absolute h-full rounded bg-amber-400 hover:bg-amber-500 transition-colors cursor-pointer"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              minWidth: "8px",
                            }}
                            title={`${change.name}: ${change.changeRule}\n${formatYear(start)} – ${formatYear(end)}`}
                            onClick={() =>
                              setExpandedChange(
                                expandedChange === change.id
                                  ? null
                                  : change.id
                              )
                            }
                          />
                        </div>
                        <div className="w-24 text-xs font-mono text-amber-700 flex-shrink-0 truncate">
                          {change.changeRule}
                        </div>
                      </div>

                      {expandedChange === change.id && (
                        <div className="ml-44 mt-1 mb-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
                          <div className="font-medium">{change.name}</div>
                          <div className="font-mono text-amber-800 mt-1">
                            {change.changeRule}
                          </div>
                          <div className="text-gray-500 text-xs mt-1">
                            {change.familyId} · {change.sourceLanguageId} →{" "}
                            {change.targetLanguageId} ·{" "}
                            {formatYear(start)} – {formatYear(end)}
                          </div>
                          {change.examples.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {change.examples.map((ex, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center space-x-2 text-xs"
                                >
                                  <span className="font-mono text-red-600">
                                    {ex.before}
                                  </span>
                                  <span className="text-gray-400">→</span>
                                  <span className="font-mono text-green-700">
                                    {ex.after}
                                  </span>
                                  <span className="text-gray-400">
                                    "{ex.meaning}"
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <VisualizationRecommendations panelType="sound-changes" onClose={onClose} />
        </div>
      </div>
    </>
  );
}
