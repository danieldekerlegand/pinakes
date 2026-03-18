import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, BookOpen, Filter, ChevronRight, ChevronDown, MapPin, Clock, Feather } from "lucide-react";

interface LiteraryTradition {
  id: string;
  name: string;
  region: string;
  originDate: number;
  endDate: number | null;
  originCoordinates: { lat: number; lng: number };
  associatedLanguageIds: string[];
  genreFocus: string[];
  keyThemes: string[];
  description: string;
  notableAuthors: string[];
  influences: string[];
  sources: string[];
}

interface LiteraryWork {
  id: string;
  title: string;
  author: string;
  traditionId: string;
  languageId: string;
  dateComposed: number;
  genre: string;
  form: string;
  description: string;
  significance: string;
  originalScript: string;
}

interface LiteraryTraditionsResponse {
  traditions: LiteraryTradition[];
  count: number;
}

interface LiteraryTraditionDetailResponse {
  tradition: LiteraryTradition;
  works: LiteraryWork[];
  workCount: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

const REGION_COLORS: Record<string, string> = {
  "South Asia": "#dc2626",
  "Mediterranean": "#2563eb",
  "East Asia": "#d97706",
  "Middle East": "#16a34a",
  "Northern Europe": "#7c3aed",
  "Central Asia": "#0891b2",
  "Europe": "#db2777",
  "Eastern Europe": "#4f46e5",
  "West Africa": "#65a30d",
};

function getRegionColor(region: string): string {
  return REGION_COLORS[region] || "#6b7280";
}

export default function LiteraryTraditionsPanel({ isOpen, onClose }: Props) {
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [expandedTradition, setExpandedTradition] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("timeline");

  const { data: litData } = useQuery<LiteraryTraditionsResponse>({
    queryKey: ["/api/literary-traditions"],
    enabled: isOpen,
  });

  const traditions = litData?.traditions ?? [];

  const regions = useMemo(() => {
    const regs = new Set<string>();
    traditions.forEach((t) => regs.add(t.region));
    return Array.from(regs).sort();
  }, [traditions]);

  const filteredTraditions = useMemo(() => {
    if (selectedRegion === "all") return traditions;
    return traditions.filter((t) => t.region === selectedRegion);
  }, [traditions, selectedRegion]);

  const timelineSorted = useMemo(() => {
    return [...filteredTraditions].sort((a, b) => a.originDate - b.originDate);
  }, [filteredTraditions]);

  const timelineRange = useMemo(() => {
    if (timelineSorted.length === 0) return { min: -1500, max: 2100 };
    let min = Infinity;
    let max = -Infinity;
    timelineSorted.forEach((t) => {
      if (t.originDate < min) min = t.originDate;
      const end = t.endDate ?? 2024;
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
              <BookOpen className="h-6 w-6 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Literary Traditions & Works
                </h2>
                <p className="text-sm text-gray-600">
                  Explore literary traditions and their major works across civilizations
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
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
              >
                <option value="all">All Regions ({traditions.length})</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r} ({traditions.filter((t) => t.region === r).length})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "timeline" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600"}`}
                onClick={() => setViewMode("timeline")}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Timeline</span>
              </button>
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "cards" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600"}`}
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
                {timelineSorted.map((tradition) => {
                  const left = yearToPercent(tradition.originDate);
                  const endYear = tradition.endDate ?? 2024;
                  const width = Math.max(
                    yearToPercent(endYear) - yearToPercent(tradition.originDate),
                    2
                  );
                  const color = getRegionColor(tradition.region);

                  return (
                    <div key={tradition.id} className="relative">
                      <div className="flex items-center space-x-3">
                        <div className="w-52 text-xs text-gray-600 text-right flex-shrink-0 truncate">
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
                            title={`${tradition.name}\n${formatYear(tradition.originDate)} – ${tradition.endDate ? formatYear(tradition.endDate) : "Present"}`}
                            onClick={() =>
                              setExpandedTradition(
                                expandedTradition === tradition.id ? null : tradition.id
                              )
                            }
                          />
                        </div>
                        <div className="w-24 text-xs text-gray-500 flex-shrink-0 truncate">
                          {tradition.region}
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
                  No literary traditions found for this filter.
                </div>
              )}
            </div>
          ) : (
            /* Cards view */
            <div className="space-y-3">
              {filteredTraditions.map((tradition) => {
                const isExpanded = expandedTradition === tradition.id;
                const color = getRegionColor(tradition.region);

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
                            {tradition.region}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                          <span>
                            {formatYear(tradition.originDate)} – {tradition.endDate ? formatYear(tradition.endDate) : "Present"}
                          </span>
                          <span>{tradition.genreFocus.join(", ")}</span>
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
                  No literary traditions found for this filter.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TraditionDetail({ tradition }: { tradition: LiteraryTradition }) {
  const color = getRegionColor(tradition.region);

  const { data: detailData } = useQuery<LiteraryTraditionDetailResponse>({
    queryKey: [`/api/literary-traditions/${tradition.id}`],
  });

  const works = detailData?.works ?? [];

  return (
    <div className="px-4 pb-4 border-t bg-gray-50">
      <div className="mt-3 text-sm text-gray-700">{tradition.description}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Period</div>
          <div className="text-sm font-medium">
            {formatYear(tradition.originDate)} – {tradition.endDate ? formatYear(tradition.endDate) : "Present"}
          </div>
          <div className="text-xs text-gray-500 flex items-center space-x-1 mt-1">
            <MapPin className="h-3 w-3" />
            <span>{tradition.region}</span>
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Languages</div>
          <div className="text-sm font-medium">
            {tradition.associatedLanguageIds.join(", ")}
          </div>
        </div>
      </div>

      {tradition.genreFocus.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Genres</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.genreFocus.map((genre, idx) => (
              <span
                key={idx}
                className="text-xs px-2 py-1 rounded-full border"
                style={{ borderColor: color, color }}
              >
                {genre}
              </span>
            ))}
          </div>
        </div>
      )}

      {tradition.keyThemes.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Key Themes</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.keyThemes.map((theme, idx) => (
              <span key={idx} className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                {theme}
              </span>
            ))}
          </div>
        </div>
      )}

      {tradition.notableAuthors.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Notable Authors</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.notableAuthors.map((author, idx) => (
              <span key={idx} className="text-xs px-2 py-1 rounded-full bg-white border flex items-center space-x-1">
                <Feather className="h-3 w-3 text-gray-400" />
                <span>{author}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {tradition.influences.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Influences</div>
          <div className="text-sm text-gray-600">
            {tradition.influences.join(" | ")}
          </div>
        </div>
      )}

      {/* Works section */}
      {works.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-gray-500 mb-2">
            Major Works ({works.length})
          </div>
          <div className="space-y-2">
            {works.map((work) => (
              <div key={work.id} className="p-3 bg-white rounded border">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{work.title}</div>
                    <div className="text-xs text-gray-500">
                      {work.author} · {formatYear(work.dateComposed)} · {work.genre} ({work.form})
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {work.originalScript}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-gray-600">{work.description}</div>
                <div className="mt-1 text-xs text-amber-700 italic">{work.significance}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
