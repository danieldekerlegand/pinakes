import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Package, Filter, ChevronRight, ChevronDown, MapPin, Clock } from "lucide-react";
import VisualizationRecommendations from "@/components/VisualizationRecommendations";

interface TradeGood {
  id: string;
  name: string;
  category: string;
  originRegion: string;
  originCoordinates: { lat: number; lng: number };
  tradeRoutes: string[];
  timePeriod: string;
  economicSignificance: string;
  associatedLanguages: string[];
}

interface TradeGoodsResponse {
  goods: TradeGood[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  spice: "#d97706",
  textile: "#7c3aed",
  metal: "#6b7280",
  gemstone: "#2563eb",
  food: "#16a34a",
  material: "#0891b2",
  dye: "#dc2626",
  incense: "#c026d3",
  ceramic: "#ea580c",
  medicine: "#0d9488",
  animal: "#65a30d",
  wood: "#92400e",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] || "#6b7280";
}

// Simple equirectangular map projection
function latLngToXY(lat: number, lng: number, width: number, height: number) {
  const x = ((lng + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

export default function TradeGoodsPanel({ isOpen, onClose, embedded }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTimePeriod, setSelectedTimePeriod] = useState<string>("all");
  const [expandedGood, setExpandedGood] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "cards">("map");

  const { data: goodsData } = useQuery<TradeGoodsResponse>({
    queryKey: ["/api/trade-goods"],
    enabled: isOpen || !!embedded,
  });

  const goods = goodsData?.goods ?? [];

  const categories = useMemo(() => {
    const cats = new Set<string>();
    goods.forEach((g) => cats.add(g.category));
    return Array.from(cats).sort();
  }, [goods]);

  const timePeriods = useMemo(() => {
    const periods = new Set<string>();
    goods.forEach((g) => periods.add(g.timePeriod));
    return Array.from(periods).sort();
  }, [goods]);

  const filteredGoods = useMemo(() => {
    let result = goods;
    if (selectedCategory !== "all") {
      result = result.filter((g) => g.category === selectedCategory);
    }
    if (selectedTimePeriod !== "all") {
      result = result.filter((g) => g.timePeriod === selectedTimePeriod);
    }
    return result;
  }, [goods, selectedCategory, selectedTimePeriod]);

  if (!isOpen && !embedded) return null;

  const mapWidth = 820;
  const mapHeight = 420;

  const panelContent = (
    <div className={embedded ? "h-full flex flex-col bg-white" : "fixed right-0 top-0 h-full w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden"}>
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0">
          <div className="flex justify-between items-start">
            <div className="flex items-center space-x-3">
              <Package className="h-6 w-6 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Trade Goods
                </h2>
                <p className="text-sm text-gray-600">
                  Explore historical trade goods with origins and trade route flows
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
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <option value="all">All Categories ({goods.length})</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c} ({goods.filter((g) => g.category === c).length})
                  </option>
                ))}
              </select>
              <select
                className="text-sm border rounded px-2 py-1 bg-white"
                value={selectedTimePeriod}
                onChange={(e) => setSelectedTimePeriod(e.target.value)}
              >
                <option value="all">All Time Periods</option>
                {timePeriods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "map" ? "bg-amber-100 text-amber-800" : "bg-white text-gray-600"}`}
                onClick={() => setViewMode("map")}
              >
                <MapPin className="h-3.5 w-3.5" />
                <span>Map</span>
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
          {viewMode === "map" ? (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-2">
                Origins of {filteredGoods.length} trade goods with trade route flows
              </div>

              {/* SVG Map */}
              <div className="border rounded-lg overflow-hidden bg-blue-50">
                <svg viewBox={`0 0 ${mapWidth} ${mapHeight}`} className="w-full" style={{ maxHeight: "420px" }}>
                  {/* Simple world outline */}
                  <rect x="0" y="0" width={mapWidth} height={mapHeight} fill="#e0f2fe" />
                  {/* Simplified continent shapes as background */}
                  <rect x="0" y="0" width={mapWidth} height={mapHeight} fill="#dbeafe" rx="4" />

                  {/* Grid lines */}
                  {[-60, -30, 0, 30, 60].map((lat) => {
                    const { y } = latLngToXY(lat, 0, mapWidth, mapHeight);
                    return (
                      <line key={`lat-${lat}`} x1="0" y1={y} x2={mapWidth} y2={y} stroke="#93c5fd" strokeWidth="0.5" strokeDasharray="4,4" />
                    );
                  })}
                  {[-120, -60, 0, 60, 120].map((lng) => {
                    const { x } = latLngToXY(0, lng, mapWidth, mapHeight);
                    return (
                      <line key={`lng-${lng}`} x1={x} y1="0" x2={x} y2={mapHeight} stroke="#93c5fd" strokeWidth="0.5" strokeDasharray="4,4" />
                    );
                  })}

                  {/* Animated trade route flows between goods that share routes */}
                  {(() => {
                    const routeConnections: { from: TradeGood; to: TradeGood; route: string }[] = [];
                    const routeMap = new Map<string, TradeGood[]>();
                    filteredGoods.forEach((g) => {
                      g.tradeRoutes.forEach((r) => {
                        if (!routeMap.has(r)) routeMap.set(r, []);
                        routeMap.get(r)!.push(g);
                      });
                    });
                    routeMap.forEach((goodsOnRoute, route) => {
                      for (let i = 0; i < goodsOnRoute.length - 1; i++) {
                        routeConnections.push({
                          from: goodsOnRoute[i],
                          to: goodsOnRoute[i + 1],
                          route,
                        });
                      }
                    });

                    return routeConnections.map((conn, idx) => {
                      const from = latLngToXY(conn.from.originCoordinates.lat, conn.from.originCoordinates.lng, mapWidth, mapHeight);
                      const to = latLngToXY(conn.to.originCoordinates.lat, conn.to.originCoordinates.lng, mapWidth, mapHeight);
                      // Create a curved path
                      const midX = (from.x + to.x) / 2;
                      const midY = (from.y + to.y) / 2 - 20;

                      return (
                        <g key={`route-${idx}`}>
                          <path
                            d={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`}
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="1.5"
                            strokeOpacity="0.3"
                          />
                          {/* Animated dot along path */}
                          <circle r="2.5" fill="#f59e0b" opacity="0.8">
                            <animateMotion
                              dur={`${3 + (idx % 3)}s`}
                              repeatCount="indefinite"
                              path={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`}
                            />
                          </circle>
                        </g>
                      );
                    });
                  })()}

                  {/* Trade good markers */}
                  {filteredGoods.map((good) => {
                    const { x, y } = latLngToXY(good.originCoordinates.lat, good.originCoordinates.lng, mapWidth, mapHeight);
                    const color = getCategoryColor(good.category);
                    const isSelected = expandedGood === good.id;

                    return (
                      <g
                        key={good.id}
                        className="cursor-pointer"
                        onClick={() => setExpandedGood(isSelected ? null : good.id)}
                      >
                        {/* Pulse ring for selected */}
                        {isSelected && (
                          <circle cx={x} cy={y} r="12" fill="none" stroke={color} strokeWidth="2" opacity="0.5">
                            <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.5;0.1;0.5" dur="2s" repeatCount="indefinite" />
                          </circle>
                        )}
                        <circle
                          cx={x}
                          cy={y}
                          r={isSelected ? 7 : 5}
                          fill={color}
                          stroke="white"
                          strokeWidth="1.5"
                          opacity="0.85"
                        />
                        {/* Label on hover/select */}
                        {isSelected && (
                          <text
                            x={x}
                            y={y - 12}
                            textAnchor="middle"
                            fontSize="9"
                            fontWeight="bold"
                            fill={color}
                          >
                            {good.name}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 text-xs">
                {categories
                  .filter((c) => selectedCategory === "all" || c === selectedCategory)
                  .map((cat) => (
                    <div key={cat} className="flex items-center space-x-1">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getCategoryColor(cat) }}
                      />
                      <span className="text-gray-600">{cat}</span>
                    </div>
                  ))}
              </div>

              {/* Selected good detail */}
              {expandedGood && (
                <GoodDetail good={filteredGoods.find((g) => g.id === expandedGood) ?? null} />
              )}

              {/* List below map */}
              <div className="space-y-2 mt-4">
                {filteredGoods
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((good) => {
                    const color = getCategoryColor(good.category);
                    const isExpanded = expandedGood === good.id;

                    return (
                      <Card
                        key={good.id}
                        className={`overflow-hidden transition-all ${isExpanded ? "ring-2 ring-amber-300" : ""}`}
                      >
                        <button
                          className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-gray-50"
                          onClick={() => setExpandedGood(isExpanded ? null : good.id)}
                        >
                          <div className="flex items-center space-x-3">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <div>
                              <div className="font-medium text-sm">{good.name}</div>
                              <div className="text-xs text-gray-500 flex items-center space-x-2">
                                <MapPin className="h-3 w-3" />
                                <span>{good.originRegion}</span>
                                <span className="text-gray-300">|</span>
                                <Clock className="h-3 w-3" />
                                <span>{good.timePeriod}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: color, color }}
                            >
                              {good.category}
                            </Badge>
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && <GoodDetail good={good} />}
                      </Card>
                    );
                  })}
              </div>
            </div>
          ) : (
            /* Cards view */
            <div className="space-y-3">
              {filteredGoods.map((good) => {
                const isExpanded = expandedGood === good.id;
                const color = getCategoryColor(good.category);

                return (
                  <Card key={good.id} className="overflow-hidden">
                    <button
                      className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
                      onClick={() =>
                        setExpandedGood(isExpanded ? null : good.id)
                      }
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-medium text-gray-900">
                            {good.name}
                          </h3>
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{ borderColor: color, color }}
                          >
                            {good.category}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                          <span>{good.originRegion}</span>
                          <span>{good.timePeriod}</span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      )}
                    </button>

                    {isExpanded && <GoodDetail good={good} />}
                  </Card>
                );
              })}

              {filteredGoods.length === 0 && (
                <div className="text-center text-gray-500 py-12">
                  No trade goods found for this filter.
                </div>
              )}
            </div>
          )}

          <VisualizationRecommendations panelType="trade-goods" onClose={onClose} />
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
      />
      {panelContent}
    </>
  );
}

function GoodDetail({ good }: { good: TradeGood | null }) {
  if (!good) return null;
  const color = getCategoryColor(good.category);

  return (
    <div className="px-4 pb-4 border-t bg-gray-50">
      <div className="mt-3 text-sm text-gray-700">{good.economicSignificance}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Origin</div>
          <div className="text-sm font-medium">{good.originRegion}</div>
          <div className="text-xs text-gray-500">
            {good.originCoordinates.lat.toFixed(1)}, {good.originCoordinates.lng.toFixed(1)}
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Time Period</div>
          <div className="text-sm font-medium">{good.timePeriod}</div>
        </div>
      </div>

      {good.tradeRoutes.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Trade Routes</div>
          <div className="flex flex-wrap gap-1.5">
            {good.tradeRoutes.map((route, idx) => (
              <span
                key={idx}
                className="text-xs px-2 py-1 rounded-full border"
                style={{ borderColor: color, color }}
              >
                {route.replace(/-/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {good.associatedLanguages.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">Associated Languages</div>
          <div className="flex flex-wrap gap-1">
            {good.associatedLanguages.map((lang, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                {lang}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
