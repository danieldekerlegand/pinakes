import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Filter,
  ChevronRight,
  ChevronDown,
  MapPin,
  Clock,
  Landmark,
  Link2,
  Dna,
  Package,
  Users,
} from "lucide-react";
import VisualizationRecommendations from "@/components/VisualizationRecommendations";

interface ArchaeologicalCulture {
  id: string;
  name: string;
  timeOrigin: number;
  timeEnd: number;
  region: string;
  originCoordinates: [number, number];
  description: string;
  associatedLanguageIds: string[];
  associatedHaplogroupIds: string[];
  materialCultureIds: string[];
  predecessorCultureIds: string[];
  successorCultureIds: string[];
  characteristics: string[];
  sources: string[];
}

interface ArchaeologicalCulturesResponse {
  cultures: ArchaeologicalCulture[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

const REGION_COLORS: Record<string, string> = {
  "pontic-caspian steppe": "#dc2626",
  "northern europe": "#2563eb",
  "western europe": "#7c3aed",
  "central europe": "#d97706",
  "southeast europe": "#16a34a",
  "eastern europe": "#0891b2",
  "central asia": "#db2777",
  "south asia": "#ea580c",
  "east china": "#65a30d",
  "central china": "#c026d3",
  "northwest china": "#0d9488",
  "japan": "#e11d48",
  "southeast asia": "#4f46e5",
  "oceania": "#06b6d4",
  "north america": "#84cc16",
  "south america": "#f59e0b",
  "mesoamerica": "#10b981",
  "west africa": "#8b5cf6",
  "east africa": "#f43f5e",
  "nubia": "#6366f1",
  "mesopotamia": "#14b8a6",
  "levant": "#a855f7",
  "egypt": "#eab308",
  "eurasian steppe": "#ef4444",
  "korean peninsula": "#3b82f6",
};

function getRegionColor(region: string): string {
  return REGION_COLORS[region.toLowerCase()] || "#6b7280";
}

function CultureDetail({
  culture,
  allCultures,
  onSelectCulture,
}: {
  culture: ArchaeologicalCulture;
  allCultures: ArchaeologicalCulture[];
  onSelectCulture: (id: string) => void;
}) {
  const predecessors = allCultures.filter((c) =>
    culture.predecessorCultureIds?.includes(c.id)
  );
  const successors = allCultures.filter((c) =>
    culture.successorCultureIds?.includes(c.id)
  );

  return (
    <Card className="mt-2 ml-47 mr-20 p-4 border-l-4 border-l-amber-400 bg-amber-50/50">
      <p className="text-sm text-gray-700 mb-3">{culture.description}</p>

      <div className="grid grid-cols-2 gap-4">
        {/* Temporal span */}
        <div>
          <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
            <Clock className="h-3 w-3" />
            <span>Time Period</span>
          </div>
          <p className="text-sm">
            {formatYear(culture.timeOrigin)} – {formatYear(culture.timeEnd)}
          </p>
        </div>

        {/* Geographic origin */}
        <div>
          <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
            <MapPin className="h-3 w-3" />
            <span>Region</span>
          </div>
          <p className="text-sm">{culture.region}</p>
        </div>

        {/* Associated languages */}
        {culture.associatedLanguageIds.length > 0 && (
          <div>
            <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
              <Users className="h-3 w-3" />
              <span>Probable Languages</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {culture.associatedLanguageIds.map((lang) => (
                <Badge key={lang} variant="outline" className="text-xs">
                  {lang}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Haplogroups */}
        {culture.associatedHaplogroupIds.length > 0 && (
          <div>
            <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
              <Dna className="h-3 w-3" />
              <span>Haplogroups</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {culture.associatedHaplogroupIds.map((h) => (
                <Badge
                  key={h}
                  variant="outline"
                  className="text-xs bg-green-50 border-green-200"
                >
                  {h}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Material culture */}
        {culture.materialCultureIds.length > 0 && (
          <div>
            <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
              <Package className="h-3 w-3" />
              <span>Material Culture</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {culture.materialCultureIds.map((mc) => (
                <Badge
                  key={mc}
                  variant="outline"
                  className="text-xs bg-orange-50 border-orange-200"
                >
                  {mc}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Characteristics */}
        {culture.characteristics.length > 0 && (
          <div className="col-span-2">
            <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
              <Landmark className="h-3 w-3" />
              <span>Key Characteristics</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {culture.characteristics.map((ch) => (
                <Badge
                  key={ch}
                  variant="outline"
                  className="text-xs bg-blue-50 border-blue-200"
                >
                  {ch}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Predecessor / Successor links */}
      {(predecessors.length > 0 || successors.length > 0) && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-2">
            <Link2 className="h-3 w-3" />
            <span>Cultural Lineage</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {predecessors.map((p) => (
              <button
                key={p.id}
                className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                onClick={() => onSelectCulture(p.id)}
              >
                {p.name}
              </button>
            ))}
            {predecessors.length > 0 && (
              <span className="text-gray-400">→</span>
            )}
            <span className="px-2 py-1 rounded bg-amber-200 font-medium">
              {culture.name}
            </span>
            {successors.length > 0 && (
              <span className="text-gray-400">→</span>
            )}
            {successors.map((s) => (
              <button
                key={s.id}
                className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                onClick={() => onSelectCulture(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      {culture.sources.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <p className="text-xs text-gray-400">
            Sources: {culture.sources.join("; ")}
          </p>
        </div>
      )}
    </Card>
  );
}

export default function ArchaeologicalCulturesPanel({
  isOpen,
  onClose,
  embedded,
}: Props) {
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [expandedCulture, setExpandedCulture] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("timeline");

  const { data } = useQuery<ArchaeologicalCulturesResponse>({
    queryKey: ["/api/archaeological-cultures"],
    enabled: isOpen || !!embedded,
  });

  const cultures = data?.cultures ?? [];

  const regions = useMemo(() => {
    const r = new Set<string>();
    cultures.forEach((c) => r.add(c.region));
    return Array.from(r).sort();
  }, [cultures]);

  const filteredCultures = useMemo(() => {
    if (selectedRegion === "all") return cultures;
    return cultures.filter((c) => c.region === selectedRegion);
  }, [cultures, selectedRegion]);

  const timelineSorted = useMemo(() => {
    return [...filteredCultures].sort((a, b) => a.timeOrigin - b.timeOrigin);
  }, [filteredCultures]);

  const timelineRange = useMemo(() => {
    if (timelineSorted.length === 0) return { min: -15000, max: 2000 };
    let min = Infinity;
    let max = -Infinity;
    timelineSorted.forEach((c) => {
      if (c.timeOrigin < min) min = c.timeOrigin;
      if (c.timeEnd > max) max = c.timeEnd;
    });
    return { min: min - 500, max: max + 500 };
  }, [timelineSorted]);

  const handleSelectCulture = (id: string) => {
    setExpandedCulture(id);
    // If the culture is in a different region filter, reset to "all"
    const culture = cultures.find((c) => c.id === id);
    if (culture && selectedRegion !== "all" && culture.region !== selectedRegion) {
      setSelectedRegion("all");
    }
  };

  if (!isOpen && !embedded) return null;

  const yearToPercent = (year: number) => {
    const range = timelineRange.max - timelineRange.min;
    return ((year - timelineRange.min) / range) * 100;
  };

  const panelContent = (
    <div
      className={embedded ? "h-full flex flex-col bg-white" : "fixed right-0 top-0 h-full w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden"}
      data-testid="archaeological-cultures-panel"
    >
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0">
          <div className="flex justify-between items-start">
            <div className="flex items-center space-x-3">
              <Landmark className="h-6 w-6 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Archaeological Cultures
                </h2>
                <p className="text-sm text-gray-600">
                  Explore cultures with material evidence, language associations,
                  and genetic markers
                </p>
              </div>
            </div>
            {!embedded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              data-testid="archaeological-cultures-close"
            >
              <X className="h-5 w-5" />
            </Button>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-4 mt-4">
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select
                className="text-sm border rounded px-2 py-1 bg-white"
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                data-testid="archaeological-cultures-region-filter"
              >
                <option value="all">
                  All Regions ({cultures.length})
                </option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r} (
                    {cultures.filter((c) => c.region === r).length})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${
                  viewMode === "timeline"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-white text-gray-600"
                }`}
                onClick={() => setViewMode("timeline")}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Timeline</span>
              </button>
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${
                  viewMode === "cards"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-white text-gray-600"
                }`}
                onClick={() => setViewMode("cards")}
              >
                <span>Cards</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === "timeline" ? (
            <div className="relative">
              {/* Timeline axis */}
              <div className="mb-6">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{formatYear(timelineRange.min)}</span>
                  <span>
                    {formatYear(
                      Math.round(
                        (timelineRange.min + timelineRange.max) / 2
                      )
                    )}
                  </span>
                  <span>{formatYear(timelineRange.max)}</span>
                </div>
                <div className="h-1 bg-gray-200 rounded relative">
                  {timelineRange.min < 0 && timelineRange.max > 0 && (
                    <div
                      className="absolute h-full bg-gray-400 rounded"
                      style={{
                        left: `${yearToPercent(0)}%`,
                        width: "1px",
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Timeline entries */}
              <div className="space-y-2">
                {timelineSorted.map((culture) => {
                  const left = yearToPercent(culture.timeOrigin);
                  const width = Math.max(
                    yearToPercent(culture.timeEnd) -
                      yearToPercent(culture.timeOrigin),
                    2
                  );
                  const color = getRegionColor(culture.region);

                  return (
                    <div key={culture.id} className="relative">
                      <div className="flex items-center space-x-3">
                        <div className="w-44 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                          {culture.name}
                        </div>
                        <div className="flex-1 relative h-6">
                          <div className="absolute inset-0 bg-gray-50 rounded" />
                          <button
                            className="absolute h-full rounded hover:opacity-80 transition-opacity cursor-pointer"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              minWidth: "8px",
                              backgroundColor: color,
                              opacity:
                                expandedCulture === culture.id ? 1 : 0.7,
                            }}
                            title={`${culture.name}\n${formatYear(culture.timeOrigin)} – ${formatYear(culture.timeEnd)}\n${culture.region}`}
                            onClick={() =>
                              setExpandedCulture(
                                expandedCulture === culture.id
                                  ? null
                                  : culture.id
                              )
                            }
                          />
                        </div>
                        <div className="w-28 text-xs text-gray-500 flex-shrink-0 truncate">
                          {culture.region}
                        </div>
                      </div>

                      {expandedCulture === culture.id && (
                        <CultureDetail
                          culture={culture}
                          allCultures={cultures}
                          onSelectCulture={handleSelectCulture}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {filteredCultures.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No archaeological cultures found for this filter.
                </div>
              )}
            </div>
          ) : (
            /* Cards view */
            <div className="space-y-3">
              {timelineSorted.map((culture) => {
                const isExpanded = expandedCulture === culture.id;
                const color = getRegionColor(culture.region);

                return (
                  <Card
                    key={culture.id}
                    className="overflow-hidden"
                    data-testid={`culture-card-${culture.id}`}
                  >
                    <button
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                      onClick={() =>
                        setExpandedCulture(isExpanded ? null : culture.id)
                      }
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div>
                          <p className="font-medium text-sm">
                            {culture.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatYear(culture.timeOrigin)} –{" "}
                            {formatYear(culture.timeEnd)} · {culture.region}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {culture.associatedHaplogroupIds.length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-green-50 border-green-200"
                          >
                            <Dna className="h-3 w-3 mr-1" />
                            {culture.associatedHaplogroupIds.length}
                          </Badge>
                        )}
                        {culture.associatedLanguageIds.length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-blue-50 border-blue-200"
                          >
                            <Users className="h-3 w-3 mr-1" />
                            {culture.associatedLanguageIds.length}
                          </Badge>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t">
                        <div className="pt-3">
                          <p className="text-sm text-gray-700 mb-3">
                            {culture.description}
                          </p>

                          {/* Characteristics */}
                          {culture.characteristics.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs font-medium text-gray-500 mb-1">
                                Key Characteristics
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {culture.characteristics.map((ch) => (
                                  <Badge
                                    key={ch}
                                    variant="outline"
                                    className="text-xs bg-blue-50 border-blue-200"
                                  >
                                    {ch}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-3">
                            {/* Languages */}
                            {culture.associatedLanguageIds.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  Probable Languages
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {culture.associatedLanguageIds.map(
                                    (lang) => (
                                      <Badge
                                        key={lang}
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        {lang}
                                      </Badge>
                                    )
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Haplogroups */}
                            {culture.associatedHaplogroupIds.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  Haplogroups
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {culture.associatedHaplogroupIds.map(
                                    (h) => (
                                      <Badge
                                        key={h}
                                        variant="outline"
                                        className="text-xs bg-green-50 border-green-200"
                                      >
                                        {h}
                                      </Badge>
                                    )
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Material culture */}
                            {culture.materialCultureIds.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  Material Culture
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {culture.materialCultureIds.map((mc) => (
                                    <Badge
                                      key={mc}
                                      variant="outline"
                                      className="text-xs bg-orange-50 border-orange-200"
                                    >
                                      {mc}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Lineage links */}
                          {((culture.predecessorCultureIds?.length ?? 0) > 0 ||
                            (culture.successorCultureIds?.length ?? 0) > 0) && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs font-medium text-gray-500 mb-2">
                                Cultural Lineage
                              </p>
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                {cultures
                                  .filter((c) =>
                                    culture.predecessorCultureIds?.includes(
                                      c.id
                                    )
                                  )
                                  .map((p) => (
                                    <button
                                      key={p.id}
                                      className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                                      onClick={() =>
                                        handleSelectCulture(p.id)
                                      }
                                    >
                                      {p.name}
                                    </button>
                                  ))}
                                {(culture.predecessorCultureIds?.length ?? 0) > 0 && (
                                  <span className="text-gray-400">→</span>
                                )}
                                <span className="px-2 py-1 rounded bg-amber-200 font-medium">
                                  {culture.name}
                                </span>
                                {(culture.successorCultureIds?.length ?? 0) > 0 && (
                                  <span className="text-gray-400">→</span>
                                )}
                                {cultures
                                  .filter((c) =>
                                    culture.successorCultureIds?.includes(
                                      c.id
                                    )
                                  )
                                  .map((s) => (
                                    <button
                                      key={s.id}
                                      className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
                                      onClick={() =>
                                        handleSelectCulture(s.id)
                                      }
                                    >
                                      {s.name}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}

                          {/* Sources */}
                          {culture.sources.length > 0 && (
                            <p className="mt-3 text-xs text-gray-400">
                              Sources: {culture.sources.join("; ")}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}

              {filteredCultures.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No archaeological cultures found for this filter.
                </div>
              )}
            </div>
          )}

          <VisualizationRecommendations panelType="archaeological-cultures" onClose={onClose} />
        </div>
      </div>
  );

  if (embedded) {
    return panelContent;
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
        data-testid="archaeological-cultures-overlay"
      />
      {panelContent}
    </>
  );
}
