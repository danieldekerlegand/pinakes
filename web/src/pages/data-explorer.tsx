import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  ChevronRight,
  BarChart3,
  Map,
  GitBranch,
  Network,
  Clock,
  Table2,
  Layers,
  Search,
  Loader2,
  AlertCircle,
  ArrowLeftRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LucideIcon } from "lucide-react";
import {
  DATASET_REGISTRY,
  VISUALIZATION_OPTIONS,
  getDatasetCategories,
  getCompatibleVisualizations,
  getSuggestedVisualization,
  filterDatasets,
  type DatasetDefinition,
  type VisualizationType,
  type VisualizationOption,
} from "@/lib/data-explorer-registry";

// ---------------------------------------------------------------------------
// Icon mapping (registry stores icon names as strings for testability)
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Table2, Clock, GitBranch, Network, Map, Layers, ArrowLeftRight, BarChart3,
};

function getIcon(option: VisualizationOption): LucideIcon {
  return ICON_MAP[option.iconName] ?? BarChart3;
}

// ---------------------------------------------------------------------------
// Simple renderers for each visualization type
// ---------------------------------------------------------------------------

function TableRenderer({ data }: { data: Record<string, unknown>[] }) {
  if (!data.length) return <p className="text-gray-500 p-4">No records found.</p>;
  const columns = Object.keys(data[0]).slice(0, 8);
  return (
    <div className="overflow-auto max-h-[600px]">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-gray-100 z-10">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium text-gray-700 border-b">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 200).map((row, i) => (
            <tr key={i} className="hover:bg-gray-50 border-b border-gray-100">
              {columns.map((col) => (
                <td key={col} className="px-3 py-1.5 text-gray-600 max-w-[200px] truncate">
                  {String(row[col] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 200 && (
        <p className="text-xs text-gray-400 p-2">Showing first 200 of {data.length} records</p>
      )}
    </div>
  );
}

function PlaceholderRenderer({ vizType, dataset }: { vizType: VisualizationType; dataset: DatasetDefinition }) {
  const option = VISUALIZATION_OPTIONS.find((v) => v.type === vizType);
  const Icon = option ? getIcon(option) : BarChart3;
  return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
      <Icon className="h-12 w-12" />
      <p className="text-lg font-medium">{option?.label ?? vizType} View</p>
      <p className="text-sm">{option?.description}</p>
      <p className="text-xs">Dataset: {dataset.name} ({dataset.file})</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataExplorer page component
// ---------------------------------------------------------------------------

export default function DataExplorer() {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [selectedViz, setSelectedViz] = useState<VisualizationType | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const categories = useMemo(() => getDatasetCategories(DATASET_REGISTRY), []);

  const filteredDatasets = useMemo(
    () => filterDatasets(DATASET_REGISTRY, searchQuery, categoryFilter),
    [searchQuery, categoryFilter]
  );

  const groupedDatasets = useMemo(() => {
    const groups: Record<string, DatasetDefinition[]> = {};
    for (const ds of filteredDatasets) {
      (groups[ds.category] ??= []).push(ds);
    }
    return groups;
  }, [filteredDatasets]);

  const selectedDataset = useMemo(
    () => DATASET_REGISTRY.find((d) => d.id === selectedDatasetId) ?? null,
    [selectedDatasetId]
  );

  const activeViz = selectedDataset
    ? selectedViz ?? selectedDataset.defaultVisualization
    : null;

  const compatibleVizOptions = useMemo(
    () => (selectedDataset ? getCompatibleVisualizations(selectedDataset) : []),
    [selectedDataset]
  );

  const handleSelectDataset = useCallback((id: string) => {
    setSelectedDatasetId(id);
    setSelectedViz(null);
  }, []);

  // Fetch data when a dataset is selected
  const {
    data: rawData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["data-explorer", selectedDataset?.endpoint],
    queryFn: async () => {
      if (!selectedDataset) return null;
      const res = await fetch(selectedDataset.endpoint);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
      return res.json();
    },
    enabled: !!selectedDataset,
  });

  // Normalize API response to an array for the table renderer
  const dataRows: Record<string, unknown>[] = useMemo(() => {
    if (!rawData) return [];
    if (Array.isArray(rawData)) return rawData;
    const first = Object.values(rawData).find(Array.isArray);
    if (first) return first as Record<string, unknown>[];
    return [rawData];
  }, [rawData]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-blue-600 text-white shadow-sm flex-shrink-0 z-50">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5" />
            <h1 className="text-base font-medium">Data Explorer</h1>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="text-sm text-blue-100 hover:text-white transition-colors"
            >
              Back to Dashboard
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — dataset picker */}
        {!sidebarCollapsed && (
          <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-200 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search datasets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <Select
                value={categoryFilter ?? "all"}
                onValueChange={(v) => setCategoryFilter(v === "all" ? null : v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="flex-1">
              <div className="py-1">
                {Object.entries(groupedDatasets).map(([category, datasets]) => (
                  <DatasetGroup
                    key={category}
                    category={category}
                    datasets={datasets}
                    selectedId={selectedDatasetId}
                    onSelect={handleSelectDataset}
                  />
                ))}
                {filteredDatasets.length === 0 && (
                  <p className="text-sm text-gray-400 p-4 text-center">No datasets match your search.</p>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}

        {/* Toggle sidebar button */}
        <button
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          className="flex-shrink-0 w-5 bg-gray-100 hover:bg-gray-200 border-r border-gray-200 flex items-center justify-center transition-colors"
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          <ChevronRight className={`h-3 w-3 text-gray-400 transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`} />
        </button>

        {/* Main content area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedDataset ? (
            <>
              {/* Visualization picker toolbar */}
              <div className="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-2 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900 truncate">
                    {selectedDataset.name}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {selectedDataset.category} &middot; {selectedDataset.file}
                    {dataRows.length > 0 && ` \u00B7 ${dataRows.length} records`}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400 mr-1">View as:</span>
                  <Tabs
                    value={activeViz ?? "table"}
                    onValueChange={(v) => setSelectedViz(v as VisualizationType)}
                  >
                    <TabsList className="h-8">
                      {compatibleVizOptions.map((opt) => {
                        const Icon = getIcon(opt);
                        const isSuggested = opt.type === selectedDataset.defaultVisualization;
                        return (
                          <TabsTrigger
                            key={opt.type}
                            value={opt.type}
                            className="text-xs px-2 py-1 gap-1"
                            title={`${opt.label}${isSuggested ? " (suggested)" : ""}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{opt.label}</span>
                            {isSuggested && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5 hidden md:inline-flex">
                                auto
                              </Badge>
                            )}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {/* Visualization content */}
              <div className="flex-1 overflow-auto p-4">
                {isLoading && (
                  <div className="flex items-center justify-center h-64 gap-2 text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Loading {selectedDataset.name}...</span>
                  </div>
                )}
                {error && (
                  <div className="flex items-center justify-center h-64 gap-2 text-red-400">
                    <AlertCircle className="h-5 w-5" />
                    <span>Failed to load data: {(error as Error).message}</span>
                  </div>
                )}
                {!isLoading && !error && rawData && (
                  <Card className="overflow-hidden">
                    {activeViz === "table" ? (
                      <TableRenderer data={dataRows} />
                    ) : (
                      <PlaceholderRenderer vizType={activeViz!} dataset={selectedDataset} />
                    )}
                  </Card>
                )}
              </div>
            </>
          ) : (
            <EmptyState onSelectDataset={handleSelectDataset} />
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DatasetGroup({
  category,
  datasets,
  selectedId,
  onSelect,
}: {
  category: string;
  datasets: DatasetDefinition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1">
      <button
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:bg-gray-50 transition-colors"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <ChevronRight className={`h-3 w-3 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`} />
        {category}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">{datasets.length}</Badge>
      </button>
      {!collapsed && (
        <div className="space-y-px">
          {datasets.map((ds) => {
            const active = ds.id === selectedId;
            const suggested = getSuggestedVisualization(ds);
            const SuggestedIcon = getIcon(suggested);
            return (
              <button
                key={ds.id}
                className={`w-full flex items-center gap-2 px-4 pl-7 py-1.5 text-sm text-left transition-colors ${
                  active
                    ? "bg-blue-100 text-blue-900 font-medium border-r-2 border-blue-600"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
                onClick={() => onSelect(ds.id)}
                aria-current={active ? "page" : undefined}
              >
                <SuggestedIcon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? "text-blue-600" : "text-gray-400"}`} />
                <span className="truncate">{ds.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onSelectDataset }: { onSelectDataset: (id: string) => void }) {
  const suggestions = [
    { id: "languages", label: "Languages", desc: "1100+ languages with geographic and typological data" },
    { id: "civilizations", label: "Civilizations", desc: "Historical civilizations with timelines" },
    { id: "deities", label: "Deities", desc: "Gods and goddesses across cultures" },
    { id: "trade-routes", label: "Trade Routes", desc: "Historical trade networks" },
    { id: "language-families", label: "Language Families", desc: "Hierarchical family tree" },
    { id: "battles", label: "Battles", desc: "Historical battles with locations and dates" },
  ];

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg text-center space-y-6">
        <Database className="h-16 w-16 text-gray-300 mx-auto" />
        <div>
          <h2 className="text-xl font-semibold text-gray-700">Select a Dataset</h2>
          <p className="text-sm text-gray-500 mt-1">
            Choose a dataset from the sidebar to explore. The best visualization will be
            automatically suggested based on the data type.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {suggestions.map((s) => {
            const ds = DATASET_REGISTRY.find((d) => d.id === s.id);
            if (!ds) return null;
            const suggested = getSuggestedVisualization(ds);
            const Icon = getIcon(suggested);
            return (
              <Button
                key={s.id}
                variant="outline"
                className="h-auto py-3 px-4 flex flex-col items-start gap-1 text-left"
                onClick={() => onSelectDataset(s.id)}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-blue-500" />
                  <span className="font-medium text-sm">{s.label}</span>
                </div>
                <span className="text-xs text-gray-400">{s.desc}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
