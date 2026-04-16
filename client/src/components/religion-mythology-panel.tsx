import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Church, Filter, ChevronRight, ChevronDown, MapPin, Clock, Sparkles } from "lucide-react";
import { RELIGION_COLORS, MYTHOLOGY_COLORS } from "@/lib/visualization/color-theme";

interface Religion {
  id: string;
  name: string;
  nativeName: string;
  religionType: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  sacredTexts: string[];
  associatedLanguageIds: string[];
  deityPantheon: string[];
  ritualPractices: string[];
  description: string;
  sources: string[];
}

interface Deity {
  id: string;
  name: string;
  nativeName: string;
  mythology: string;
  domain: string[];
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  equivalentDeityIds: string[];
  attributes: string[];
  symbols: string[];
  description: string;
  sources: string[];
}

interface MythMotif {
  id: string;
  name: string;
  motifType: string;
  thompsonIndex: string;
  mythologyIds: string[];
  associatedDeityIds: string[];
  region: string;
  timeOrigin: number | null;
  timeEnd: number | null;
  relatedMotifIds: string[];
  description: string;
  sources: string[];
}

interface ReligionsResponse {
  religions: Religion[];
  count: number;
}

interface DeitiesResponse {
  deities: Deity[];
  count: number;
}

interface MythMotifsResponse {
  motifs: MythMotif[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

type TabMode = "religions" | "deities" | "motifs";

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function getReligionTypeColor(type: string): string {
  return RELIGION_COLORS[type.toLowerCase()] || "#6b7280";
}

function getMythologyColor(mythology: string): string {
  return MYTHOLOGY_COLORS[mythology.toLowerCase()] || "#6b7280";
}

export default function ReligionMythologyPanel({ isOpen, onClose, embedded }: Props) {
  const [tabMode, setTabMode] = useState<TabMode>("religions");
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("timeline");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>("all");

  const { data: religionsData } = useQuery<ReligionsResponse>({
    queryKey: ["/api/religions"],
    enabled: (isOpen || !!embedded) && tabMode === "religions",
  });

  const { data: deitiesData } = useQuery<DeitiesResponse>({
    queryKey: ["/api/deities"],
    enabled: (isOpen || !!embedded) && tabMode === "deities",
  });

  const { data: motifsData } = useQuery<MythMotifsResponse>({
    queryKey: ["/api/myth-motifs"],
    enabled: (isOpen || !!embedded) && tabMode === "motifs",
  });

  const religions = religionsData?.religions ?? [];
  const deities = deitiesData?.deities ?? [];
  const motifs = motifsData?.motifs ?? [];

  // Filter options per tab
  const filterOptions = useMemo(() => {
    if (tabMode === "religions") {
      const types = new Set<string>();
      religions.forEach((r) => types.add(r.religionType));
      return Array.from(types).sort();
    } else if (tabMode === "deities") {
      const mythologies = new Set<string>();
      deities.forEach((d) => mythologies.add(d.mythology));
      return Array.from(mythologies).sort();
    } else {
      const types = new Set<string>();
      motifs.forEach((m) => { if (m.motifType) types.add(m.motifType); });
      return Array.from(types).sort();
    }
  }, [tabMode, religions, deities, motifs]);

  const filterLabel = tabMode === "religions" ? "Type" : tabMode === "deities" ? "Mythology" : "Motif Type";

  // Filtered + sorted items for timeline
  const timelineItems = useMemo(() => {
    type TimelineItem = {
      id: string;
      name: string;
      category: string;
      timeOrigin: number;
      timeEnd: number;
      color: string;
    };

    let items: TimelineItem[] = [];

    if (tabMode === "religions") {
      items = religions
        .filter((r) => selectedFilter === "all" || r.religionType === selectedFilter)
        .map((r) => ({
          id: r.id,
          name: r.name,
          category: r.religionType,
          timeOrigin: r.timeOrigin ?? -3000,
          timeEnd: r.timeEnd ?? 2025,
          color: getReligionTypeColor(r.religionType),
        }));
    } else if (tabMode === "deities") {
      items = deities
        .filter((d) => selectedFilter === "all" || d.mythology === selectedFilter)
        .map((d) => ({
          id: d.id,
          name: d.name,
          category: d.mythology,
          timeOrigin: d.timeOrigin ?? -3000,
          timeEnd: d.timeEnd ?? 2025,
          color: getMythologyColor(d.mythology),
        }));
    } else {
      items = motifs
        .filter((m) => selectedFilter === "all" || m.motifType === selectedFilter)
        .map((m) => ({
          id: m.id,
          name: m.name,
          category: m.motifType,
          timeOrigin: m.timeOrigin ?? -5000,
          timeEnd: m.timeEnd ?? 2025,
          color: "#8b5cf6",
        }));
    }

    return items.sort((a, b) => a.timeOrigin - b.timeOrigin);
  }, [tabMode, religions, deities, motifs, selectedFilter]);

  const timelineRange = useMemo(() => {
    if (timelineItems.length === 0) return { min: -3500, max: 2100 };
    let min = Infinity;
    let max = -Infinity;
    timelineItems.forEach((item) => {
      if (item.timeOrigin < min) min = item.timeOrigin;
      if (item.timeEnd > max) max = item.timeEnd;
    });
    return { min: min - 200, max: max + 200 };
  }, [timelineItems]);

  // Reset filter when switching tabs
  const handleTabChange = (tab: TabMode) => {
    setTabMode(tab);
    setSelectedFilter("all");
    setExpandedItem(null);
  };

  if (!isOpen && !embedded) return null;

  const yearToPercent = (year: number) => {
    const range = timelineRange.max - timelineRange.min;
    return ((year - timelineRange.min) / range) * 100;
  };

  const totalCount = tabMode === "religions" ? religions.length
    : tabMode === "deities" ? deities.length
    : motifs.length;

  const filteredCount = timelineItems.length;

  const panelContent = (
    <div className={embedded ? "h-full flex flex-col bg-white" : "fixed right-0 top-0 h-full w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden"}>
      {/* Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-amber-50 flex-shrink-0">
        <div className="flex justify-between items-start">
          <div className="flex items-center space-x-3">
            <Church className="h-6 w-6 text-indigo-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Religion & Mythology
              </h2>
              <p className="text-sm text-gray-600">
                Explore religions, deities, and mythological motifs across cultures
              </p>
            </div>
          </div>
          {!embedded && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex items-center space-x-4 mt-4">
          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1 text-sm ${tabMode === "religions" ? "bg-indigo-100 text-indigo-800" : "bg-white text-gray-600"}`}
              onClick={() => handleTabChange("religions")}
            >
              <span>Religions</span>
            </button>
            <button
              className={`px-3 py-1 text-sm ${tabMode === "deities" ? "bg-indigo-100 text-indigo-800" : "bg-white text-gray-600"}`}
              onClick={() => handleTabChange("deities")}
            >
              <span>Deities</span>
            </button>
            <button
              className={`px-3 py-1 text-sm ${tabMode === "motifs" ? "bg-indigo-100 text-indigo-800" : "bg-white text-gray-600"}`}
              onClick={() => handleTabChange("motifs")}
            >
              <span>Myth Motifs</span>
            </button>
          </div>

          {/* Filter */}
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <select
              className="text-sm border rounded px-2 py-1 bg-white"
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
            >
              <option value="all">All {filterLabel}s ({totalCount})</option>
              {filterOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} ({tabMode === "religions"
                    ? religions.filter((r) => r.religionType === opt).length
                    : tabMode === "deities"
                    ? deities.filter((d) => d.mythology === opt).length
                    : motifs.filter((m) => m.motifType === opt).length})
                </option>
              ))}
            </select>
          </div>

          {/* View mode */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "timeline" ? "bg-indigo-100 text-indigo-800" : "bg-white text-gray-600"}`}
              onClick={() => setViewMode("timeline")}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Timeline</span>
            </button>
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "cards" ? "bg-indigo-100 text-indigo-800" : "bg-white text-gray-600"}`}
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
                <span>{formatYear(Math.round((timelineRange.min + timelineRange.max) / 2))}</span>
                <span>{formatYear(timelineRange.max)}</span>
              </div>
              <div className="h-1 bg-gray-200 rounded relative">
                {timelineRange.min < 0 && timelineRange.max > 0 && (
                  <div
                    className="absolute h-full bg-gray-400 rounded"
                    style={{ left: `${yearToPercent(0)}%`, width: "1px" }}
                  />
                )}
              </div>
            </div>

            {/* Timeline entries */}
            <div className="space-y-2">
              {timelineItems.map((item) => {
                const left = yearToPercent(item.timeOrigin);
                const width = Math.max(
                  yearToPercent(item.timeEnd) - yearToPercent(item.timeOrigin),
                  2
                );

                return (
                  <div key={item.id} className="relative">
                    <div className="flex items-center space-x-3">
                      <div className="w-44 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                        {item.name}
                      </div>
                      <div className="flex-1 relative h-6">
                        <div className="absolute inset-0 bg-gray-50 rounded" />
                        <button
                          className="absolute h-full rounded hover:opacity-80 transition-opacity cursor-pointer"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            minWidth: "8px",
                            backgroundColor: item.color,
                            opacity: expandedItem === item.id ? 1 : 0.7,
                          }}
                          title={`${item.name}\n${formatYear(item.timeOrigin)} – ${formatYear(item.timeEnd)}`}
                          onClick={() =>
                            setExpandedItem(expandedItem === item.id ? null : item.id)
                          }
                        />
                      </div>
                      <div className="w-24 text-xs text-gray-500 flex-shrink-0 truncate capitalize">
                        {item.category}
                      </div>
                    </div>

                    {expandedItem === item.id && (
                      <ExpandedDetail
                        id={item.id}
                        tabMode={tabMode}
                        religions={religions}
                        deities={deities}
                        motifs={motifs}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {filteredCount === 0 && (
              <div className="text-center text-gray-500 py-12">
                No {tabMode} found for this filter.
              </div>
            )}
          </div>
        ) : (
          /* Cards view */
          <div className="space-y-3">
            {tabMode === "religions" && religions
              .filter((r) => selectedFilter === "all" || r.religionType === selectedFilter)
              .map((religion) => (
                <ReligionCard
                  key={religion.id}
                  religion={religion}
                  isExpanded={expandedItem === religion.id}
                  onToggle={() => setExpandedItem(expandedItem === religion.id ? null : religion.id)}
                />
              ))}

            {tabMode === "deities" && deities
              .filter((d) => selectedFilter === "all" || d.mythology === selectedFilter)
              .map((deity) => (
                <DeityCard
                  key={deity.id}
                  deity={deity}
                  isExpanded={expandedItem === deity.id}
                  onToggle={() => setExpandedItem(expandedItem === deity.id ? null : deity.id)}
                />
              ))}

            {tabMode === "motifs" && motifs
              .filter((m) => selectedFilter === "all" || m.motifType === selectedFilter)
              .map((motif) => (
                <MotifCard
                  key={motif.id}
                  motif={motif}
                  isExpanded={expandedItem === motif.id}
                  onToggle={() => setExpandedItem(expandedItem === motif.id ? null : motif.id)}
                />
              ))}

            {filteredCount === 0 && (
              <div className="text-center text-gray-500 py-12">
                No {tabMode} found for this filter.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return panelContent;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />
      {panelContent}
    </>
  );
}

// Expanded detail resolver - looks up the right item and renders the appropriate detail
function ExpandedDetail({
  id,
  tabMode,
  religions,
  deities,
  motifs,
}: {
  id: string;
  tabMode: TabMode;
  religions: Religion[];
  deities: Deity[];
  motifs: MythMotif[];
}) {
  if (tabMode === "religions") {
    const religion = religions.find((r) => r.id === id);
    if (!religion) return null;
    return <ReligionDetail religion={religion} />;
  }
  if (tabMode === "deities") {
    const deity = deities.find((d) => d.id === id);
    if (!deity) return null;
    return <DeityDetail deity={deity} />;
  }
  const motif = motifs.find((m) => m.id === id);
  if (!motif) return null;
  return <MotifDetail motif={motif} />;
}

// ── Religion detail & card ──────────────────────────────────────────────────

function ReligionDetail({ religion }: { religion: Religion }) {
  const color = getReligionTypeColor(religion.religionType);

  return (
    <div className="ml-48 px-4 pb-4 pt-2 border-t bg-gray-50 rounded-b">
      <div className="text-sm text-gray-700">{religion.description}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Period</div>
          <div className="text-sm font-medium">
            {religion.timeOrigin ? formatYear(religion.timeOrigin) : "Ancient"} – {religion.timeEnd ? formatYear(religion.timeEnd) : "Present"}
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Origin Region</div>
          <div className="text-sm font-medium">{religion.originRegion}</div>
          <div className="text-xs text-gray-500 flex items-center space-x-1">
            <MapPin className="h-3 w-3" />
            <span>{religion.coordinates.lat.toFixed(1)}, {religion.coordinates.lng.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {religion.nativeName && (
        <div className="mt-3">
          <span className="text-xs font-medium text-gray-500">Native name: </span>
          <span className="text-sm text-gray-700">{religion.nativeName}</span>
        </div>
      )}

      {religion.sacredTexts.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Sacred Texts</div>
          <div className="flex flex-wrap gap-1.5">
            {religion.sacredTexts.map((text, idx) => (
              <span key={idx} className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: color, color }}>
                {text}
              </span>
            ))}
          </div>
        </div>
      )}

      {religion.deityPantheon.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Deity Pantheon</div>
          <div className="flex flex-wrap gap-1.5">
            {religion.deityPantheon.map((deity, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {deity}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {religion.ritualPractices.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Ritual Practices</div>
          <div className="grid grid-cols-2 gap-1">
            {religion.ritualPractices.map((practice, idx) => (
              <div key={idx} className="text-sm text-gray-700 flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span>{practice}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReligionCard({ religion, isExpanded, onToggle }: { religion: Religion; isExpanded: boolean; onToggle: () => void }) {
  const color = getReligionTypeColor(religion.religionType);

  return (
    <Card className="overflow-hidden">
      <button className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50" onClick={onToggle}>
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <h3 className="font-medium text-gray-900">{religion.name}</h3>
            <Badge variant="outline" className="text-xs capitalize" style={{ borderColor: color, color }}>
              {religion.religionType}
            </Badge>
          </div>
          <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
            <span>{religion.originRegion}</span>
            <span>
              {religion.timeOrigin ? formatYear(religion.timeOrigin) : "Ancient"} – {religion.timeEnd ? formatYear(religion.timeEnd) : "Present"}
            </span>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />}
      </button>
      {isExpanded && <ReligionDetail religion={religion} />}
    </Card>
  );
}

// ── Deity detail & card ─────────────────────────────────────────────────────

function DeityDetail({ deity }: { deity: Deity }) {
  const color = getMythologyColor(deity.mythology);

  return (
    <div className="ml-48 px-4 pb-4 pt-2 border-t bg-gray-50 rounded-b">
      <div className="text-sm text-gray-700">{deity.description}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Mythology</div>
          <div className="text-sm font-medium capitalize">{deity.mythology}</div>
          {deity.timeOrigin && (
            <div className="text-xs text-gray-500">
              {formatYear(deity.timeOrigin)} – {deity.timeEnd ? formatYear(deity.timeEnd) : "Present"}
            </div>
          )}
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Domains</div>
          <div className="flex flex-wrap gap-1">
            {deity.domain.map((d, idx) => (
              <Badge key={idx} variant="outline" className="text-xs" style={{ borderColor: color, color }}>
                {d}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {deity.nativeName && (
        <div className="mt-3">
          <span className="text-xs font-medium text-gray-500">Native name: </span>
          <span className="text-sm text-gray-700">{deity.nativeName}</span>
        </div>
      )}

      {deity.attributes.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Attributes</div>
          <div className="flex flex-wrap gap-1.5">
            {deity.attributes.map((attr, idx) => (
              <span key={idx} className="text-xs px-2 py-1 rounded-full border" style={{ borderColor: color, color }}>
                {attr}
              </span>
            ))}
          </div>
        </div>
      )}

      {deity.symbols.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Symbols</div>
          <div className="flex flex-wrap gap-1.5">
            {deity.symbols.map((symbol, idx) => (
              <span key={idx} className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
                {symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      {deity.equivalentDeityIds.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Equivalent Deities</div>
          <div className="flex flex-wrap gap-1.5">
            {deity.equivalentDeityIds.map((eqId, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                <Sparkles className="h-3 w-3 mr-1" />
                {eqId}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DeityCard({ deity, isExpanded, onToggle }: { deity: Deity; isExpanded: boolean; onToggle: () => void }) {
  const color = getMythologyColor(deity.mythology);

  return (
    <Card className="overflow-hidden">
      <button className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50" onClick={onToggle}>
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <h3 className="font-medium text-gray-900">{deity.name}</h3>
            <Badge variant="outline" className="text-xs capitalize" style={{ borderColor: color, color }}>
              {deity.mythology}
            </Badge>
          </div>
          <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
            <span>{deity.domain.join(", ")}</span>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />}
      </button>
      {isExpanded && <DeityDetail deity={deity} />}
    </Card>
  );
}

// ── Motif detail & card ─────────────────────────────────────────────────────

function MotifDetail({ motif }: { motif: MythMotif }) {
  return (
    <div className="ml-48 px-4 pb-4 pt-2 border-t bg-gray-50 rounded-b">
      <div className="text-sm text-gray-700">{motif.description}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Motif Type</div>
          <div className="text-sm font-medium capitalize">{motif.motifType}</div>
          {motif.thompsonIndex && (
            <div className="text-xs text-gray-500">Thompson Index: {motif.thompsonIndex}</div>
          )}
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Region</div>
          <div className="text-sm font-medium">{motif.region || "Cross-cultural"}</div>
          {motif.timeOrigin && (
            <div className="text-xs text-gray-500">
              {formatYear(motif.timeOrigin)} – {motif.timeEnd ? formatYear(motif.timeEnd) : "Present"}
            </div>
          )}
        </div>
      </div>

      {motif.mythologyIds.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Associated Mythologies</div>
          <div className="flex flex-wrap gap-1.5">
            {motif.mythologyIds.map((mythId, idx) => (
              <Badge key={idx} variant="outline" className="text-xs capitalize">
                {mythId}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {motif.associatedDeityIds.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Associated Deities</div>
          <div className="flex flex-wrap gap-1.5">
            {motif.associatedDeityIds.map((deityId, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                {deityId}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {motif.relatedMotifIds.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Related Motifs</div>
          <div className="flex flex-wrap gap-1.5">
            {motif.relatedMotifIds.map((relId, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {relId}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MotifCard({ motif, isExpanded, onToggle }: { motif: MythMotif; isExpanded: boolean; onToggle: () => void }) {
  return (
    <Card className="overflow-hidden">
      <button className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50" onClick={onToggle}>
        <div className="flex-1">
          <div className="flex items-center space-x-2">
            <h3 className="font-medium text-gray-900">{motif.name}</h3>
            {motif.motifType && (
              <Badge variant="outline" className="text-xs capitalize">
                {motif.motifType}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
            <span>{motif.region || "Cross-cultural"}</span>
            {motif.thompsonIndex && <span>Thompson: {motif.thompsonIndex}</span>}
          </div>
        </div>
        {isExpanded ? <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />}
      </button>
      {isExpanded && <MotifDetail motif={motif} />}
    </Card>
  );
}
