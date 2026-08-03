import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X, UtensilsCrossed } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ComparisonTable, type ComparisonColumn } from "../ui/comparison-table";
import { SankeyDiagramVisualization } from "./SankeyDiagramVisualization";
import type { SankeyData } from "@contracts/types";

interface Cuisine {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  associatedLanguageIds: string[];
  timeOrigin: number | null;
  timeEnd: number | null;
  description: string;
}

interface CuisineItem {
  id: string;
  cuisineId: string;
  name: string;
  foodType: string;
  timeOrigin: number | null;
  timeEnd: number | null;
}

const REGION_COLORS: Record<string, string> = {
  "East Asia": "#ef4444",
  "South Asia": "#f59e0b",
  "Southeast Asia": "#eab308",
  "Western Europe": "#3b82f6",
  "Central Europe": "#6366f1",
  "Southern Europe": "#8b5cf6",
  "East Africa": "#10b981",
  "West Africa": "#059669",
  "North Africa": "#14b8a6",
  "Middle East": "#d97706",
  "Caucasus": "#ec4899",
  "Central Asia": "#f43f5e",
  "Eastern Europe": "#7c3aed",
  "South America": "#84cc16",
  "Central America": "#65a30d",
  "North America": "#06b6d4",
  "Caribbean": "#0891b2",
  "Oceania": "#0ea5e9",
};

function getRegionColor(region: string): string {
  return REGION_COLORS[region] || "#6b7280";
}

function formatYear(year: number | null): string {
  if (year === null) return "Unknown";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function CuisineComparisonView({ isOpen, onClose }: Props) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedCuisineId, setSelectedCuisineId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "sankey">("table");

  const { data: cuisinesData, isLoading: loadingCuisines } = useQuery<{
    cuisines: Cuisine[];
    count: number;
  }>({
    queryKey: ["/api/cuisines"],
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  const { data: itemsData, isLoading: loadingItems } = useQuery<{
    items: CuisineItem[];
    count: number;
  }>({
    queryKey: ["/api/cuisine-items"],
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  });

  const { data: sankeyData, isLoading: loadingSankey } = useQuery<SankeyData>({
    queryKey: ["/api/visualizations/cuisine-sankey"],
    enabled: isOpen && viewMode === "sankey",
    staleTime: 5 * 60 * 1000,
  });

  const cuisines = cuisinesData?.cuisines ?? [];
  const items = itemsData?.items ?? [];

  const regions = useMemo(() => {
    const set = new Set(cuisines.map((c) => c.region));
    return Array.from(set).sort();
  }, [cuisines]);

  const filteredCuisines = useMemo(() => {
    if (!selectedRegion) return cuisines;
    return cuisines.filter((c) => c.region === selectedRegion);
  }, [cuisines, selectedRegion]);

  // Items grouped by cuisine
  const itemsByCuisine = useMemo(() => {
    const map = new Map<string, CuisineItem[]>();
    for (const item of items) {
      if (!map.has(item.cuisineId)) map.set(item.cuisineId, []);
      map.get(item.cuisineId)!.push(item);
    }
    return map;
  }, [items]);

  // Food type distribution for selected cuisine
  const selectedCuisineDetails = useMemo(() => {
    if (!selectedCuisineId) return null;
    const cuisine = cuisines.find((c) => c.id === selectedCuisineId);
    if (!cuisine) return null;
    const cuisineItems = itemsByCuisine.get(cuisine.id) ?? [];
    const foodTypes = new Map<string, number>();
    for (const item of cuisineItems) {
      foodTypes.set(item.foodType, (foodTypes.get(item.foodType) ?? 0) + 1);
    }
    return { cuisine, items: cuisineItems, foodTypes };
  }, [selectedCuisineId, cuisines, itemsByCuisine]);

  // Cross-comparison matrix: shared food types between cuisines
  const foodTypeMatrix = useMemo(() => {
    const cuisineFoodTypes = new Map<string, Set<string>>();
    for (const c of filteredCuisines) {
      const cItems = itemsByCuisine.get(c.id) ?? [];
      cuisineFoodTypes.set(c.id, new Set(cItems.map((i) => i.foodType)));
    }
    return cuisineFoodTypes;
  }, [filteredCuisines, itemsByCuisine]);

  const columns: ComparisonColumn<Cuisine>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Cuisine",
        render: (c) => (
          <div>
            <div className="font-medium">{c.name}</div>
            {c.nativeName !== c.name && (
              <div className="text-xs text-gray-400">{c.nativeName}</div>
            )}
          </div>
        ),
      },
      {
        key: "region",
        header: "Region",
        render: (c) => (
          <Badge
            variant="outline"
            style={{
              borderColor: getRegionColor(c.region),
              color: getRegionColor(c.region),
            }}
          >
            {c.region}
          </Badge>
        ),
      },
      {
        key: "origin",
        header: "Origin",
        render: (c) => (
          <span className="text-sm text-gray-600">
            {formatYear(c.timeOrigin)}
          </span>
        ),
      },
      {
        key: "dishes",
        header: "Dishes",
        render: (c) => {
          const count = itemsByCuisine.get(c.id)?.length ?? 0;
          return <span className="text-sm font-medium">{count}</span>;
        },
      },
      {
        key: "foodTypes",
        header: "Food Types",
        render: (c) => {
          const types = new Set(
            (itemsByCuisine.get(c.id) ?? []).map((i) => i.foodType)
          );
          return (
            <div className="flex flex-wrap gap-1">
              {Array.from(types)
                .slice(0, 3)
                .map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs">
                    {t}
                  </Badge>
                ))}
              {types.size > 3 && (
                <span className="text-xs text-gray-400">
                  +{types.size - 3}
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [itemsByCuisine]
  );

  if (!isOpen) return null;

  const isLoading = loadingCuisines || loadingItems;

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-5 w-5 text-orange-600" />
          <h2 className="text-lg font-semibold">Cuisine Comparison</h2>
          <span className="text-sm text-gray-500">
            {filteredCuisines.length} cuisines
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg overflow-hidden">
            <button
              className={`px-3 py-1 text-sm ${
                viewMode === "table"
                  ? "bg-gray-800 text-white"
                  : "bg-white text-gray-700"
              }`}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
            <button
              className={`px-3 py-1 text-sm ${
                viewMode === "sankey"
                  ? "bg-gray-800 text-white"
                  : "bg-white text-gray-700"
              }`}
              onClick={() => setViewMode("sankey")}
            >
              Sankey Flow
            </button>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          <span className="ml-2 text-gray-500">Loading cuisine data...</span>
        </div>
      ) : (
        <div className="p-4 space-y-6">
          {/* Region Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              className={`px-3 py-1 rounded-full text-sm border ${
                !selectedRegion
                  ? "bg-gray-800 text-white"
                  : "bg-white text-gray-700"
              }`}
              onClick={() => setSelectedRegion(null)}
            >
              All Regions
            </button>
            {regions.map((region) => (
              <button
                key={region}
                className={`px-3 py-1 rounded-full text-sm border ${
                  selectedRegion === region ? "text-white" : "bg-white text-gray-700"
                }`}
                style={
                  selectedRegion === region
                    ? { backgroundColor: getRegionColor(region) }
                    : {}
                }
                onClick={() =>
                  setSelectedRegion(selectedRegion === region ? null : region)
                }
              >
                {region}
              </button>
            ))}
          </div>

          {/* Main Content */}
          {viewMode === "table" ? (
            <>
              <ComparisonTable
                items={filteredCuisines}
                columns={columns}
                getRowKey={(c) => c.id}
                onRowClick={(c) =>
                  setSelectedCuisineId(
                    selectedCuisineId === c.id ? null : c.id
                  )
                }
                selectedKey={selectedCuisineId}
                emptyMessage="No cuisines found for this region"
              />

              {/* Selected Cuisine Detail */}
              {selectedCuisineDetails && (
                <section className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {selectedCuisineDetails.cuisine.name}
                      </h3>
                      {selectedCuisineDetails.cuisine.nativeName !==
                        selectedCuisineDetails.cuisine.name && (
                        <p className="text-sm text-gray-500">
                          {selectedCuisineDetails.cuisine.nativeName}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      style={{
                        borderColor: getRegionColor(
                          selectedCuisineDetails.cuisine.region
                        ),
                        color: getRegionColor(
                          selectedCuisineDetails.cuisine.region
                        ),
                      }}
                    >
                      {selectedCuisineDetails.cuisine.region}
                    </Badge>
                  </div>

                  <p className="text-sm text-gray-600 mb-3">
                    {selectedCuisineDetails.cuisine.description}
                  </p>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <span className="font-medium text-gray-500">Origin:</span>
                      <p className="mt-1">
                        {formatYear(selectedCuisineDetails.cuisine.timeOrigin)}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">
                        Total Dishes:
                      </span>
                      <p className="mt-1">
                        {selectedCuisineDetails.items.length}
                      </p>
                    </div>
                  </div>

                  {/* Food Type Distribution */}
                  <div className="mb-3">
                    <span className="font-medium text-gray-500 text-sm">
                      Food Types:
                    </span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Array.from(selectedCuisineDetails.foodTypes.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <Badge key={type} variant="secondary">
                            {type} ({count})
                          </Badge>
                        ))}
                    </div>
                  </div>

                  {/* Dish List */}
                  <div>
                    <span className="font-medium text-gray-500 text-sm">
                      Notable Dishes:
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedCuisineDetails.items.slice(0, 12).map((item) => (
                        <Badge key={item.id} variant="outline" className="text-xs">
                          {item.name}
                        </Badge>
                      ))}
                      {selectedCuisineDetails.items.length > 12 && (
                        <span className="text-xs text-gray-400 self-center">
                          +{selectedCuisineDetails.items.length - 12} more
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    className="mt-3 text-xs text-gray-400 hover:text-gray-600"
                    onClick={() => setSelectedCuisineId(null)}
                  >
                    Close
                  </button>
                </section>
              )}

              {/* Shared Food Types Matrix */}
              {filteredCuisines.length > 1 && (
                <section>
                  <h3 className="text-lg font-semibold mb-3">
                    Shared Food Type Matrix
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Number of food types shared between cuisines.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse">
                      <thead>
                        <tr>
                          <th className="p-2 text-left" />
                          {filteredCuisines.map((c) => (
                            <th key={c.id} className="p-2 text-center">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                                style={{
                                  backgroundColor: getRegionColor(c.region),
                                }}
                              />
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCuisines.map((rowC) => (
                          <tr key={rowC.id}>
                            <td className="p-2 font-medium">{rowC.name}</td>
                            {filteredCuisines.map((colC) => {
                              const rowTypes = foodTypeMatrix.get(rowC.id) ?? new Set();
                              const colTypes = foodTypeMatrix.get(colC.id) ?? new Set();
                              const shared = Array.from(rowTypes).filter((t) =>
                                colTypes.has(t)
                              ).length;
                              const maxTypes = Math.max(rowTypes.size, colTypes.size);
                              const intensity =
                                maxTypes > 0 ? shared / maxTypes : 0;
                              return (
                                <td
                                  key={colC.id}
                                  className="p-2 text-center border"
                                  style={{
                                    backgroundColor:
                                      rowC.id === colC.id
                                        ? "#f3f4f6"
                                        : `rgba(249, 115, 22, ${intensity * 0.6})`,
                                    color:
                                      intensity > 0.4 && rowC.id !== colC.id
                                        ? "white"
                                        : "inherit",
                                  }}
                                >
                                  {shared}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : (
            /* Sankey Flow View */
            <div className="h-[600px]">
              {loadingSankey ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                  <span className="ml-2 text-gray-500">
                    Building cuisine flow diagram...
                  </span>
                </div>
              ) : sankeyData &&
                sankeyData.nodes.length > 0 &&
                sankeyData.links.length > 0 ? (
                <SankeyDiagramVisualization
                  data={sankeyData}
                  onNodeClick={(nodeId) => {
                    setSelectedCuisineId(
                      selectedCuisineId === nodeId ? null : nodeId
                    );
                    setViewMode("table");
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  No cuisine flow data available
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
