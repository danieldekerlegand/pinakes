import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Palette, Filter, ChevronRight, ChevronDown, MapPin, Clock } from "lucide-react";

interface ArtTradition {
  id: string;
  name: string;
  category: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
}

interface ArtTraditionsResponse {
  traditions: ArtTradition[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

const CATEGORY_COLORS: Record<string, string> = {
  architecture: "#2563eb",
  sculpture: "#7c3aed",
  painting: "#dc2626",
  ceramics: "#d97706",
  textiles: "#16a34a",
  metalwork: "#0891b2",
  calligraphy: "#4f46e5",
  mosaic: "#db2777",
  woodwork: "#65a30d",
  music: "#c026d3",
  dance: "#ea580c",
  theater: "#0d9488",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] || "#6b7280";
}

export default function ArtTraditionsPanel({ isOpen, onClose }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedTradition, setExpandedTradition] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"timeline" | "map" | "cards">("timeline");

  const { data: artData } = useQuery<ArtTraditionsResponse>({
    queryKey: ["/api/art-traditions"],
    enabled: isOpen,
  });

  const traditions = artData?.traditions ?? [];

  const categories = useMemo(() => {
    const cats = new Set<string>();
    traditions.forEach((t) => cats.add(t.category));
    return Array.from(cats).sort();
  }, [traditions]);

  const filteredTraditions = useMemo(() => {
    if (selectedCategory === "all") return traditions;
    return traditions.filter((t) => t.category === selectedCategory);
  }, [traditions, selectedCategory]);

  const timelineSorted = useMemo(() => {
    return [...filteredTraditions].sort((a, b) => a.originDate - b.originDate);
  }, [filteredTraditions]);

  const timelineRange = useMemo(() => {
    if (timelineSorted.length === 0) return { min: -3500, max: 2100 };
    let min = Infinity;
    let max = -Infinity;
    timelineSorted.forEach((t) => {
      if (t.originDate < min) min = t.originDate;
      if (t.endDate > max) max = t.endDate;
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
        <div className="px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-pink-50 flex-shrink-0">
          <div className="flex justify-between items-start">
            <div className="flex items-center space-x-3">
              <Palette className="h-6 w-6 text-purple-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Art Traditions
                </h2>
                <p className="text-sm text-gray-600">
                  Explore art traditions across civilizations with timeline and geographic views
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-4 mt-4">
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select
                className="text-sm border rounded px-2 py-1 bg-white"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="all">All Categories ({traditions.length})</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c} ({traditions.filter((t) => t.category === c).length})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "timeline" ? "bg-purple-100 text-purple-800" : "bg-white text-gray-600"}`}
                onClick={() => setViewMode("timeline")}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Timeline</span>
              </button>
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "map" ? "bg-purple-100 text-purple-800" : "bg-white text-gray-600"}`}
                onClick={() => setViewMode("map")}
              >
                <MapPin className="h-3.5 w-3.5" />
                <span>Map</span>
              </button>
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "cards" ? "bg-purple-100 text-purple-800" : "bg-white text-gray-600"}`}
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
            /* Gantt-chart style timeline */
            <div className="relative">
              {/* Timeline axis */}
              <div className="mb-6">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{formatYear(timelineRange.min)}</span>
                  <span>{formatYear(Math.round((timelineRange.min + timelineRange.max) / 2))}</span>
                  <span>{formatYear(timelineRange.max)}</span>
                </div>
                <div className="h-1 bg-gray-200 rounded relative">
                  {/* Year 0 marker */}
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
                {timelineSorted.map((tradition) => {
                  const left = yearToPercent(tradition.originDate);
                  const width = Math.max(
                    yearToPercent(tradition.endDate) - yearToPercent(tradition.originDate),
                    2
                  );
                  const color = getCategoryColor(tradition.category);

                  return (
                    <div key={tradition.id} className="relative">
                      <div className="flex items-center space-x-3">
                        <div className="w-44 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                          {tradition.name}
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
                              opacity: expandedTradition === tradition.id ? 1 : 0.7,
                            }}
                            title={`${tradition.name}\n${formatYear(tradition.originDate)} – ${formatYear(tradition.endDate)}`}
                            onClick={() =>
                              setExpandedTradition(
                                expandedTradition === tradition.id ? null : tradition.id
                              )
                            }
                          />
                        </div>
                        <div className="w-20 text-xs text-gray-500 flex-shrink-0 truncate">
                          {tradition.category}
                        </div>
                      </div>

                      {expandedTradition === tradition.id && (
                        <TraditionDetail tradition={tradition} />
                      )}
                    </div>
                  );
                })}
              </div>

              {filteredTraditions.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No art traditions found for this filter.
                </div>
              )}
            </div>
          ) : viewMode === "map" ? (
            /* Simple geographic distribution view */
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-4">
                Geographic origins of {filteredTraditions.length} art traditions
              </div>

              {/* Group by region using coordinates */}
              <div className="grid grid-cols-1 gap-3">
                {filteredTraditions
                  .sort((a, b) => a.originCoordinates.lng - b.originCoordinates.lng)
                  .map((tradition) => {
                    const color = getCategoryColor(tradition.category);
                    const isExpanded = expandedTradition === tradition.id;

                    return (
                      <Card
                        key={tradition.id}
                        className={`overflow-hidden transition-all ${isExpanded ? "ring-2 ring-purple-300" : ""}`}
                      >
                        <button
                          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
                          onClick={() => setExpandedTradition(isExpanded ? null : tradition.id)}
                        >
                          <div className="flex items-center space-x-3">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <div>
                              <div className="font-medium text-sm">{tradition.name}</div>
                              <div className="text-xs text-gray-500 flex items-center space-x-2">
                                <MapPin className="h-3 w-3" />
                                <span>
                                  {tradition.originCoordinates.lat.toFixed(1)}°,{" "}
                                  {tradition.originCoordinates.lng.toFixed(1)}°
                                </span>
                                <span className="text-gray-300">|</span>
                                <span>{tradition.associatedCivilizations}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: color, color }}
                            >
                              {tradition.category}
                            </Badge>
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <TraditionDetail tradition={tradition} />
                        )}
                      </Card>
                    );
                  })}
              </div>
            </div>
          ) : (
            /* Cards view */
            <div className="space-y-3">
              {filteredTraditions.map((tradition) => {
                const isExpanded = expandedTradition === tradition.id;
                const color = getCategoryColor(tradition.category);

                return (
                  <Card key={tradition.id} className="overflow-hidden">
                    <button
                      className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
                      onClick={() =>
                        setExpandedTradition(isExpanded ? null : tradition.id)
                      }
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-gray-900">
                            {tradition.name}
                          </h3>
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{ borderColor: color, color }}
                          >
                            {tradition.category}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                          <span>{tradition.stylePeriod}</span>
                          <span>
                            {formatYear(tradition.originDate)} – {formatYear(tradition.endDate)}
                          </span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <TraditionDetail tradition={tradition} />
                    )}
                  </Card>
                );
              })}

              {filteredTraditions.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No art traditions found for this filter.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TraditionDetail({ tradition }: { tradition: ArtTradition }) {
  const color = getCategoryColor(tradition.category);

  return (
    <div className="px-4 pb-4 border-t bg-gray-50">
      <div className="mt-3 text-sm text-gray-700">{tradition.description}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Period</div>
          <div className="text-sm font-medium">{tradition.stylePeriod}</div>
          <div className="text-xs text-gray-500">
            {formatYear(tradition.originDate)} – {formatYear(tradition.endDate)}
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Civilization</div>
          <div className="text-sm font-medium">{tradition.associatedCivilizations}</div>
          <div className="text-xs text-gray-500">
            Languages: {tradition.associatedLanguages.join(", ")}
          </div>
        </div>
      </div>

      {tradition.keyFeatures.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Key Features</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.keyFeatures.map((feature, idx) => (
              <span
                key={idx}
                className="text-xs px-2 py-1 rounded-full border"
                style={{ borderColor: color, color }}
              >
                {feature}
              </span>
            ))}
          </div>
        </div>
      )}

      {tradition.notableExamples.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Notable Examples</div>
          <div className="grid grid-cols-2 gap-1">
            {tradition.notableExamples.map((example, idx) => (
              <div key={idx} className="text-sm text-gray-700 flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span>{example}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
