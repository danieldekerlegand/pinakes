import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Music, Search, ChevronRight, ChevronDown, Network, MapPin, List } from "lucide-react";
import { NetworkGraph, type NetworkGraphNode, type NetworkGraphEdge } from "./visualizations/shared/NetworkGraph";
import { GeoDistributionMap, type GeoPoint } from "./visualizations/shared/GeoDistributionMap";

interface MusicTradition {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  instruments: string[];
  scales: string[];
  rhythmicPatterns: string[];
  relatedTraditions: string[];
  description: string;
  sources: string[];
}

interface MusicTraditionsResponse {
  traditions: MusicTradition[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

const REGION_COLORS: Record<string, string> = {
  "East Asia": "#c026d3",
  "South Asia": "#e11d48",
  "Southeast Asia": "#f59e0b",
  "Middle East": "#0891b2",
  "West Africa": "#16a34a",
  "Central Africa": "#65a30d",
  "Southern Europe": "#2563eb",
  "Western Europe": "#7c3aed",
  "North America": "#dc2626",
  "South America": "#ea580c",
  "Central Asia": "#0d9488",
  "Caucasus": "#9333ea",
  "Oceania": "#0284c7",
};

function getRegionColor(region: string): string {
  for (const [key, color] of Object.entries(REGION_COLORS)) {
    if (region.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return "#6b7280";
}

function formatYear(year: number | null): string {
  if (year === null) return "present";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatPeriod(start: number | null, end: number | null): string {
  if (start === null && end === null) return "Unknown period";
  return `${formatYear(start)} – ${formatYear(end)}`;
}

export default function MusicalTraditionExplorer({ isOpen, onClose, embedded }: Props) {
  const [viewMode, setViewMode] = useState<"network" | "map" | "list">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [selectedTraditionId, setSelectedTraditionId] = useState<string | null>(null);

  const { data: traditionsData, isLoading } = useQuery<MusicTraditionsResponse>({
    queryKey: ["/api/music-traditions"],
    enabled: isOpen || !!embedded,
  });

  const traditions = traditionsData?.traditions ?? [];

  const regions = useMemo(() => {
    const r = new Set<string>();
    traditions.forEach(t => r.add(t.region));
    return Array.from(r).sort();
  }, [traditions]);

  const filtered = useMemo(() => {
    let result = traditions;
    if (selectedRegion !== "all") {
      result = result.filter(t => t.region === selectedRegion);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.nativeName.toLowerCase().includes(q) ||
        t.region.toLowerCase().includes(q) ||
        t.instruments.some(i => i.toLowerCase().includes(q)) ||
        t.scales.some(s => s.toLowerCase().includes(q))
      );
    }
    return result;
  }, [traditions, selectedRegion, searchQuery]);

  const selectedTradition = useMemo(
    () => traditions.find(t => t.id === selectedTraditionId) ?? null,
    [traditions, selectedTraditionId]
  );

  // Network graph data: nodes are traditions, edges are relatedTraditions links
  const networkData = useMemo(() => {
    const filteredIds = new Set(filtered.map(t => t.id));
    const nodes: NetworkGraphNode[] = filtered.map(t => ({
      id: t.id,
      label: t.name,
      category: t.region,
      size: 4 + Math.min(t.instruments.length + t.relatedTraditions.length, 12),
      metadata: {
        period: formatPeriod(t.timeOrigin, t.timeEnd),
        instruments: t.instruments.length,
        scales: t.scales.join(", "),
      },
    }));

    const edges: NetworkGraphEdge[] = [];
    const edgeSet = new Set<string>();
    for (const t of filtered) {
      for (const rel of t.relatedTraditions) {
        if (!filteredIds.has(rel)) continue;
        const key = [t.id, rel].sort().join("-");
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({ source: t.id, target: rel, weight: 1 });
      }
    }
    return { nodes, edges };
  }, [filtered]);

  // Geo data
  const geoPoints: GeoPoint[] = useMemo(() =>
    filtered.map(t => ({
      id: t.id,
      lat: t.coordinates.lat,
      lng: t.coordinates.lng,
      label: t.name,
      category: t.region,
      metadata: {
        period: formatPeriod(t.timeOrigin, t.timeEnd),
        instruments: t.instruments.length,
      },
    })),
    [filtered]
  );

  if (!isOpen && !embedded) return null;

  const panelContent = (
    <div className={embedded ? "h-full flex flex-col bg-white" : "fixed right-0 top-0 h-full w-[960px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden"}>
      {/* Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-violet-50 to-fuchsia-50 flex-shrink-0">
        <div className="flex justify-between items-start">
          <div className="flex items-center space-x-3">
            <Music className="h-6 w-6 text-violet-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Musical Tradition Explorer</h2>
              <p className="text-sm text-gray-600">
                {filtered.length} tradition{filtered.length !== 1 ? "s" : ""} across {regions.length} regions
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
        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search traditions, instruments, scales..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded bg-white"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <select
            className="text-sm border rounded px-2 py-1.5 bg-white"
            value={selectedRegion}
            onChange={e => setSelectedRegion(e.target.value)}
          >
            <option value="all">All Regions ({traditions.length})</option>
            {regions.map(r => (
              <option key={r} value={r}>
                {r} ({traditions.filter(t => t.region === r).length})
              </option>
            ))}
          </select>

          <div className="flex rounded-lg border overflow-hidden">
            {([
              { key: "list", icon: List, label: "List" },
              { key: "network", icon: Network, label: "Network" },
              { key: "map", icon: MapPin, label: "Map" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                className={`px-3 py-1.5 text-sm flex items-center gap-1 ${
                  viewMode === key ? "bg-violet-100 text-violet-800" : "bg-white text-gray-600"
                }`}
                onClick={() => setViewMode(key)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Loading musical traditions...
          </div>
        ) : (
          <>
            {/* Main view */}
            <div className="flex-1 overflow-auto">
              {viewMode === "list" && (
                <div className="p-4 space-y-2">
                  {filtered.map(t => (
                    <TraditionCard
                      key={t.id}
                      tradition={t}
                      isExpanded={selectedTraditionId === t.id}
                      onToggle={() => setSelectedTraditionId(
                        selectedTraditionId === t.id ? null : t.id
                      )}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <div className="text-center text-gray-400 py-12">
                      No traditions match your search.
                    </div>
                  )}
                </div>
              )}

              {viewMode === "network" && (
                <div className="h-full p-4 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <NetworkGraph
                      nodes={networkData.nodes}
                      edges={networkData.edges}
                      colorScale={getRegionColor}
                      selectedNodeId={selectedTraditionId}
                      onNodeClick={node => setSelectedTraditionId(
                        selectedTraditionId === node.id ? null : node.id
                      )}
                      linkDistance={100}
                      chargeStrength={-300}
                    />
                  </div>
                  {selectedTradition && (
                    <div className="mt-3 flex-shrink-0">
                      <TraditionDetail tradition={selectedTradition} />
                    </div>
                  )}
                </div>
              )}

              {viewMode === "map" && (
                <div className="h-full p-4 flex flex-col">
                  <div className="flex-shrink-0">
                    <GeoDistributionMap
                      points={geoPoints}
                      colorScale={getRegionColor}
                      selectedPointId={selectedTraditionId}
                      onPointClick={p => setSelectedTraditionId(
                        selectedTraditionId === p.id ? null : (p.id ?? null)
                      )}
                      height={400}
                      renderPopup={p => (
                        <div className="min-w-[180px] p-1">
                          <div className="font-semibold text-sm">♪ {p.label}</div>
                          <div className="text-xs text-gray-500">{p.category}</div>
                          {p.metadata?.period && (
                            <div className="text-xs text-gray-600 mt-1">{p.metadata.period}</div>
                          )}
                          {p.metadata?.instruments != null && (
                            <div className="text-xs text-gray-600">
                              {p.metadata.instruments} instrument{p.metadata.instruments !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                      )}
                    />
                  </div>
                  {selectedTradition && (
                    <div className="mt-3 flex-shrink-0">
                      <TraditionDetail tradition={selectedTradition} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (embedded) return panelContent;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />
      {panelContent}
    </>
  );
}

function TraditionCard({
  tradition,
  isExpanded,
  onToggle,
}: {
  tradition: MusicTradition;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const color = getRegionColor(tradition.region);
  return (
    <Card className={`overflow-hidden transition-all ${isExpanded ? "ring-2 ring-violet-300" : ""}`}>
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{tradition.name}</div>
            <div className="text-xs text-gray-500 truncate">
              {tradition.region} · {formatPeriod(tradition.timeOrigin, tradition.timeEnd)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {tradition.instruments.length > 0 && (
            <Badge variant="outline" className="text-xs whitespace-nowrap">
              {tradition.instruments.length} instr.
            </Badge>
          )}
          <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }}>
            {tradition.region}
          </Badge>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>
      {isExpanded && <TraditionDetail tradition={tradition} />}
    </Card>
  );
}

function TraditionDetail({ tradition }: { tradition: MusicTradition }) {
  const color = getRegionColor(tradition.region);
  return (
    <div className="px-4 pb-4 border-t bg-gray-50">
      <div className="mt-3 text-sm text-gray-700">{tradition.description}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Period</div>
          <div className="text-sm font-medium">
            {formatPeriod(tradition.timeOrigin, tradition.timeEnd)}
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Languages</div>
          <div className="text-sm font-medium truncate">
            {tradition.associatedLanguageIds.length > 0
              ? tradition.associatedLanguageIds.slice(0, 4).join(", ") +
                (tradition.associatedLanguageIds.length > 4
                  ? ` +${tradition.associatedLanguageIds.length - 4}`
                  : "")
              : "Unknown"}
          </div>
        </div>
      </div>

      {tradition.instruments.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Instruments</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.instruments.map(inst => (
              <span
                key={inst}
                className="text-xs px-2 py-0.5 rounded-full border"
                style={{ borderColor: color, color }}
              >
                {inst}
              </span>
            ))}
          </div>
        </div>
      )}

      {tradition.scales.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Scales</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.scales.map(scale => (
              <Badge key={scale} variant="secondary" className="text-xs">
                {scale}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {tradition.rhythmicPatterns.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Rhythmic Patterns</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.rhythmicPatterns.map(rp => (
              <Badge key={rp} variant="secondary" className="text-xs">
                {rp}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {tradition.relatedTraditions.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Related Traditions</div>
          <div className="flex flex-wrap gap-1.5">
            {tradition.relatedTraditions.map(rel => (
              <Badge key={rel} variant="outline" className="text-xs">
                {rel}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
