import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Landmark,
  Clock,
  MapPin,
  ChevronRight,
  ChevronDown,
  Filter,
  Users,
} from "lucide-react";

interface Settlement {
  id: string;
  name: string;
  alternate_names: string;
  latitude: number;
  longitude: number;
  type: string;
  culture_id: string;
  civilization_id: string;
  founded_year: number;
  abandoned_year: number | null;
  peak_population: number;
  notable_features: string;
  associated_languages: string;
  modern_name: string;
  region: string;
}

interface EmpireEvent {
  id: string;
  empire_id: string;
  empire_name: string;
  year: number;
  event_type: string;
  territory_change: string;
  capital: string;
  population_estimate: number;
  ruler: string;
  government_type: string;
  vassal_states: string;
  rival_empires: string;
  associated_language_ids: string;
  description: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

const MESOPOTAMIAN_EMPIRE_IDS = [
  "sumerian-city-states",
  "akkadian-empire",
  "ur-third-dynasty",
  "old-babylonian",
  "kassite-babylonia",
  "middle-assyrian",
  "neo-assyrian",
  "neo-babylonian",
  "persian-achaemenid",
];

const EMPIRE_COLORS: Record<string, string> = {
  "sumerian-city-states": "#8b5cf6",
  "akkadian-empire": "#d97706",
  "ur-third-dynasty": "#7c3aed",
  "old-babylonian": "#2563eb",
  "kassite-babylonia": "#059669",
  "middle-assyrian": "#dc2626",
  "neo-assyrian": "#ef4444",
  "neo-babylonian": "#3b82f6",
  "persian-achaemenid": "#f59e0b",
};

const SETTLEMENT_TYPE_COLORS: Record<string, string> = {
  "city-state": "#8b5cf6",
  capital: "#dc2626",
  "religious-center": "#f59e0b",
  fortress: "#6b7280",
  port: "#0891b2",
  "trading-post": "#059669",
};

function formatYear(year: number | null): string {
  if (year === null || year === undefined) return "Unknown";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function parseJsonArray(val: string): string[] {
  if (!val) return [];
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

type ViewMode = "timeline" | "map" | "cards";
type CivFilter = "all" | string;

export default function MesopotamiaCityStatesShowcase({
  isOpen,
  onClose,
  embedded,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [civFilter, setCivFilter] = useState<CivFilter>("all");
  const [expandedSettlement, setExpandedSettlement] = useState<string | null>(null);
  const [selectedEmpire, setSelectedEmpire] = useState<string | null>(null);

  const { data: settlementsData, isLoading: settlementsLoading } = useQuery<{
    settlements: Settlement[];
    count: number;
  }>({
    queryKey: ["/api/settlements", { region: "Mesopotamia" }],
    queryFn: async () => {
      const res = await fetch("/api/settlements?region=Mesopotamia");
      return res.json();
    },
    enabled: isOpen || !!embedded,
  });

  const { data: empiresData, isLoading: empiresLoading } = useQuery<{
    events: EmpireEvent[];
    count: number;
  }>({
    queryKey: ["/api/empires-timeline", { mesopotamian: true }],
    queryFn: async () => {
      const res = await fetch("/api/empires-timeline?year_start=-4000&year_end=-330");
      return res.json();
    },
    enabled: isOpen || !!embedded,
  });

  const settlements = settlementsData?.settlements ?? [];
  const allEvents = empiresData?.events ?? [];

  const mesopotamianEvents = useMemo(
    () =>
      allEvents.filter((e) => MESOPOTAMIAN_EMPIRE_IDS.includes(e.empire_id)),
    [allEvents]
  );

  const empireGroups = useMemo(() => {
    const groups: Record<string, EmpireEvent[]> = {};
    mesopotamianEvents.forEach((e) => {
      if (!groups[e.empire_id]) groups[e.empire_id] = [];
      groups[e.empire_id].push(e);
    });
    // Sort groups by earliest event year
    return Object.entries(groups).sort(
      (a, b) => Math.min(...a[1].map((e) => e.year)) - Math.min(...b[1].map((e) => e.year))
    );
  }, [mesopotamianEvents]);

  const civilizationIds = useMemo(() => {
    const ids = new Set<string>();
    settlements.forEach((s) => {
      if (s.civilization_id) ids.add(s.civilization_id);
    });
    return Array.from(ids).sort();
  }, [settlements]);

  const filteredSettlements = useMemo(() => {
    let result = settlements;
    if (civFilter !== "all") {
      result = result.filter((s) => s.civilization_id === civFilter);
    }
    return result.sort((a, b) => (a.founded_year ?? 0) - (b.founded_year ?? 0));
  }, [settlements, civFilter]);

  // Deduplicate settlements by name (keep the one with earlier founded_year)
  const uniqueSettlements = useMemo(() => {
    const seen = new Map<string, Settlement>();
    filteredSettlements.forEach((s) => {
      const existing = seen.get(s.name);
      if (!existing || (s.founded_year ?? 0) < (existing.founded_year ?? 0)) {
        seen.set(s.name, s);
      }
    });
    return Array.from(seen.values()).sort(
      (a, b) => (a.founded_year ?? 0) - (b.founded_year ?? 0)
    );
  }, [filteredSettlements]);

  const isLoading = settlementsLoading || empiresLoading;

  // Timeline range for the empire timeline
  const timelineRange = useMemo(() => {
    if (mesopotamianEvents.length === 0) return { min: -4000, max: -300 };
    const years = mesopotamianEvents.map((e) => e.year);
    return { min: Math.min(...years) - 200, max: Math.max(...years) + 200 };
  }, [mesopotamianEvents]);

  const yearToPercent = (year: number) => {
    const range = timelineRange.max - timelineRange.min;
    return ((year - timelineRange.min) / range) * 100;
  };

  if (!isOpen && !embedded) return null;

  const panelContent = (
    <div
      className={
        embedded
          ? "h-full flex flex-col bg-white"
          : "fixed right-0 top-0 h-full w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden"
      }
      data-testid="mesopotamia-showcase"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-violet-50 to-amber-50 flex-shrink-0">
        <div className="flex justify-between items-start">
          <div className="flex items-center space-x-3">
            <Landmark className="h-6 w-6 text-violet-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Mesopotamia: Cradle of Civilization
              </h2>
              <p className="text-sm text-gray-600">
                Explore {uniqueSettlements.length} city-states and{" "}
                {empireGroups.length} empires spanning 3,000+ years of history
              </p>
            </div>
          </div>
          {!embedded && (
            <Button variant="ghost" size="sm" onClick={onClose}>
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
              value={civFilter}
              onChange={(e) => setCivFilter(e.target.value)}
              data-testid="civ-filter"
            >
              <option value="all">
                All Civilizations ({settlements.length})
              </option>
              {civilizationIds.map((id) => (
                <option key={id} value={id}>
                  {id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}{" "}
                  ({settlements.filter((s) => s.civilization_id === id).length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${
                viewMode === "timeline"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-white text-gray-600"
              }`}
              onClick={() => setViewMode("timeline")}
              data-testid="view-timeline"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Timeline</span>
            </button>
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${
                viewMode === "map"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-white text-gray-600"
              }`}
              onClick={() => setViewMode("map")}
              data-testid="view-map"
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>Map</span>
            </button>
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${
                viewMode === "cards"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-white text-gray-600"
              }`}
              onClick={() => setViewMode("cards")}
              data-testid="view-cards"
            >
              <Landmark className="h-3.5 w-3.5" />
              <span>Cities</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin h-8 w-8 border-2 border-violet-400 border-t-transparent rounded-full" />
          </div>
        ) : viewMode === "timeline" ? (
          <div className="space-y-6">
            {/* Empire Timeline */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Empire Timeline
              </h3>

              {/* Timeline axis */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{formatYear(timelineRange.min)}</span>
                  <span>
                    {formatYear(
                      Math.round((timelineRange.min + timelineRange.max) / 2)
                    )}
                  </span>
                  <span>{formatYear(timelineRange.max)}</span>
                </div>
                <div className="h-1 bg-gray-200 rounded" />
              </div>

              {/* Empire bars */}
              <div className="space-y-2">
                {empireGroups.map(([empireId, events]) => {
                  const founding = events.find(
                    (e) => e.event_type === "founding"
                  );
                  const end = events.find(
                    (e) =>
                      e.event_type === "fall" || e.event_type === "collapse"
                  );
                  if (!founding) return null;

                  const startYear = founding.year;
                  const endYear = end?.year ?? founding.year + 100;
                  const left = yearToPercent(startYear);
                  const width = Math.max(
                    yearToPercent(endYear) - left,
                    2
                  );
                  const color = EMPIRE_COLORS[empireId] ?? "#6b7280";
                  const isSelected = selectedEmpire === empireId;

                  return (
                    <div key={empireId} className="relative">
                      <div className="flex items-center space-x-3">
                        <div className="w-40 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                          {founding.empire_name}
                        </div>
                        <div className="flex-1 relative h-7">
                          <div className="absolute inset-0 bg-gray-50 rounded" />
                          <button
                            className="absolute h-full rounded hover:opacity-90 transition-opacity cursor-pointer flex items-center px-2"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              minWidth: "12px",
                              backgroundColor: color,
                              opacity: isSelected ? 1 : 0.75,
                              border: isSelected
                                ? "2px solid #1e293b"
                                : "none",
                            }}
                            title={`${founding.empire_name}\n${formatYear(startYear)} – ${formatYear(endYear)}`}
                            onClick={() =>
                              setSelectedEmpire(
                                isSelected ? null : empireId
                              )
                            }
                            data-testid={`empire-bar-${empireId}`}
                          >
                            <span className="text-[10px] text-white font-medium truncate">
                              {formatYear(startYear)} – {formatYear(endYear)}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isSelected && (
                        <div className="ml-44 mt-2 mb-3 p-3 bg-gray-50 rounded-lg border text-sm space-y-2">
                          {events.map((event) => (
                            <div
                              key={event.id}
                              className="flex items-start space-x-2"
                            >
                              <Badge
                                variant="outline"
                                className="text-xs flex-shrink-0"
                                style={{
                                  borderColor: color,
                                  color: color,
                                }}
                              >
                                {formatYear(event.year)}
                              </Badge>
                              <div>
                                <span className="font-medium text-gray-800">
                                  {event.event_type.replace(/_/g, " ")}
                                </span>
                                {event.ruler && (
                                  <span className="text-gray-500">
                                    {" "}
                                    — {event.ruler}
                                  </span>
                                )}
                                <p className="text-xs text-gray-600 mt-0.5">
                                  {event.description}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Settlement Timeline */}
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                City-State Foundations ({uniqueSettlements.length} settlements)
              </h3>
              <div className="space-y-1">
                {uniqueSettlements.slice(0, 30).map((s) => {
                  const left = yearToPercent(s.founded_year ?? -3500);
                  const color =
                    SETTLEMENT_TYPE_COLORS[s.type] ?? "#6b7280";

                  return (
                    <div key={s.id} className="flex items-center space-x-3">
                      <div className="w-40 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                        {s.name}
                      </div>
                      <div className="flex-1 relative h-5">
                        <div className="absolute inset-0 bg-gray-50 rounded" />
                        <button
                          className="absolute h-3 w-3 rounded-full top-1 hover:scale-125 transition-transform cursor-pointer"
                          style={{
                            left: `${Math.max(0, Math.min(left, 98))}%`,
                            backgroundColor: color,
                          }}
                          title={`${s.name} — founded ${formatYear(s.founded_year)}`}
                          onClick={() =>
                            setExpandedSettlement(
                              expandedSettlement === s.id ? null : s.id
                            )
                          }
                        />
                      </div>
                      <div className="w-24 text-xs text-gray-500 flex-shrink-0">
                        {formatYear(s.founded_year)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : viewMode === "map" ? (
          /* Simple geographic overview */
          <div className="space-y-4">
            <div className="bg-gradient-to-b from-amber-50 to-amber-100 rounded-lg p-6 border border-amber-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Geographic Distribution
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Mesopotamian settlements span from the Persian Gulf to upper
                Syria, centered on the Tigris and Euphrates rivers.
              </p>

              {/* Simple coordinate-based layout */}
              <div
                className="relative bg-amber-50 rounded border border-amber-200 overflow-hidden"
                style={{ height: 400 }}
                data-testid="map-container"
              >
                {/* Map labels */}
                <div className="absolute top-2 left-2 text-[10px] text-amber-600 font-medium">
                  N
                </div>
                <div className="absolute bottom-2 left-2 text-[10px] text-amber-600 font-medium">
                  S
                </div>

                {uniqueSettlements.map((s) => {
                  if (!s.latitude || !s.longitude) return null;
                  // Map coordinates: lat 29-37, lng 38-49
                  const x =
                    ((s.longitude - 38) / (49 - 38)) * 90 + 5;
                  const y =
                    100 - ((s.latitude - 29) / (37 - 29)) * 90 - 5;
                  const color =
                    SETTLEMENT_TYPE_COLORS[s.type] ?? "#6b7280";

                  return (
                    <button
                      key={s.id}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 group"
                      style={{
                        left: `${Math.max(2, Math.min(x, 98))}%`,
                        top: `${Math.max(2, Math.min(y, 98))}%`,
                      }}
                      onClick={() =>
                        setExpandedSettlement(
                          expandedSettlement === s.id ? null : s.id
                        )
                      }
                      data-testid={`map-pin-${s.id}`}
                    >
                      <div
                        className="h-3 w-3 rounded-full border-2 border-white shadow-sm hover:scale-150 transition-transform"
                        style={{ backgroundColor: color }}
                      />
                      <div className="absolute left-4 top-0 text-[9px] text-gray-700 whitespace-nowrap font-medium opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 px-1 rounded">
                        {s.name}
                      </div>
                    </button>
                  );
                })}

                {/* Rivers (simplified) */}
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {/* Euphrates */}
                  <path
                    d="M 15,15 C 30,25 40,35 55,50 C 65,60 70,70 80,85"
                    fill="none"
                    stroke="#93c5fd"
                    strokeWidth="0.8"
                    opacity="0.6"
                  />
                  {/* Tigris */}
                  <path
                    d="M 35,10 C 45,20 50,35 60,50 C 65,60 72,72 82,85"
                    fill="none"
                    stroke="#93c5fd"
                    strokeWidth="0.8"
                    opacity="0.6"
                  />
                </svg>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-3">
                {Object.entries(SETTLEMENT_TYPE_COLORS).map(([type, color]) => (
                  <div
                    key={type}
                    className="flex items-center space-x-1 text-xs text-gray-600"
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span>{type.replace(/-/g, " ")}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected settlement detail */}
            {expandedSettlement && (
              <SettlementDetail
                settlement={uniqueSettlements.find(
                  (s) => s.id === expandedSettlement
                )}
                onClose={() => setExpandedSettlement(null)}
              />
            )}
          </div>
        ) : (
          /* Cards view */
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {uniqueSettlements.map((s) => {
                const color =
                  SETTLEMENT_TYPE_COLORS[s.type] ?? "#6b7280";
                const features = parseJsonArray(s.notable_features);
                const languages = parseJsonArray(s.associated_languages);
                const isExpanded = expandedSettlement === s.id;

                return (
                  <Card
                    key={s.id}
                    className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() =>
                      setExpandedSettlement(isExpanded ? null : s.id)
                    }
                    data-testid={`city-card-${s.id}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center space-x-2">
                        <div
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <h4 className="font-medium text-gray-900">
                          {s.name}
                        </h4>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{ borderColor: color, color }}
                      >
                        {s.type.replace(/-/g, " ")}
                      </Badge>
                    </div>

                    <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                      <span className="flex items-center space-x-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatYear(s.founded_year)}</span>
                      </span>
                      {s.peak_population > 0 && (
                        <span className="flex items-center space-x-1">
                          <Users className="h-3 w-3" />
                          <span>
                            {s.peak_population.toLocaleString()}
                          </span>
                        </span>
                      )}
                      {s.modern_name && (
                        <span className="flex items-center space-x-1">
                          <MapPin className="h-3 w-3" />
                          <span>{s.modern_name}</span>
                        </span>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        {features.length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-gray-700">
                              Notable Features:
                            </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {features.map((f, i) => (
                                <Badge
                                  key={i}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {f}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {languages.length > 0 && (
                          <div className="text-xs text-gray-600">
                            <span className="font-medium">Languages:</span>{" "}
                            {languages.join(", ")}
                          </div>
                        )}
                        {s.civilization_id && (
                          <div className="text-xs text-gray-600">
                            <span className="font-medium">Civilization:</span>{" "}
                            {s.civilization_id.replace(/-/g, " ")}
                          </div>
                        )}
                      </div>
                    )}

                    {!isExpanded && features.length > 0 && (
                      <div className="mt-2 flex items-center text-xs text-gray-400">
                        <ChevronRight className="h-3 w-3 mr-1" />
                        {features.length} notable feature
                        {features.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return panelContent;
}

function SettlementDetail({
  settlement,
  onClose,
}: {
  settlement: Settlement | undefined;
  onClose: () => void;
}) {
  if (!settlement) return null;

  const features = parseJsonArray(settlement.notable_features);
  const languages = parseJsonArray(settlement.associated_languages);

  return (
    <Card className="p-4 border-violet-200" data-testid="settlement-detail">
      <div className="flex justify-between items-start">
        <h4 className="font-semibold text-gray-900">{settlement.name}</h4>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2 space-y-2 text-sm text-gray-600">
        <div className="flex items-center space-x-4">
          <span>
            <strong>Type:</strong> {settlement.type.replace(/-/g, " ")}
          </span>
          <span>
            <strong>Founded:</strong> {formatYear(settlement.founded_year)}
          </span>
          {settlement.abandoned_year && (
            <span>
              <strong>Abandoned:</strong>{" "}
              {formatYear(settlement.abandoned_year)}
            </span>
          )}
        </div>
        {settlement.peak_population > 0 && (
          <div>
            <strong>Peak Population:</strong>{" "}
            {settlement.peak_population.toLocaleString()}
          </div>
        )}
        {features.length > 0 && (
          <div>
            <strong>Notable Features:</strong>
            <div className="flex flex-wrap gap-1 mt-1">
              {features.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {languages.length > 0 && (
          <div>
            <strong>Languages:</strong> {languages.join(", ")}
          </div>
        )}
        {settlement.modern_name && (
          <div>
            <strong>Modern Name:</strong> {settlement.modern_name}
          </div>
        )}
      </div>
    </Card>
  );
}
