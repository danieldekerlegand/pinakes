import { useQuery } from "@tanstack/react-query";
import { Database, BarChart3, AlertCircle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";

interface DatasetEntry {
  category: string;
  name: string;
  count: number;
  file: string;
  unit?: string;
  note?: string;
  coverage?: {
    coordinates: number;
    temporal: number;
    writingSystem: number;
  };
}

interface DataStats {
  datasets: DatasetEntry[];
}

export default function DataOverview() {
  const { data, isLoading, error } = useQuery<DataStats>({
    queryKey: ["/api/data/stats"],
    queryFn: async () => {
      const res = await fetch("/api/data/stats");
      if (!res.ok) throw new Error("Failed to fetch data stats");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-red-600">
        <AlertCircle className="h-5 w-5 mr-2" />
        Failed to load data statistics
      </div>
    );
  }

  const { datasets } = data;
  const categories = Array.from(new Set(datasets.map((d) => d.category)));
  const totalRecords = datasets.reduce((sum, d) => sum + d.count, 0);
  const populatedDatasets = datasets.filter((d) => d.count > 0).length;
  const emptyDatasets = datasets.filter((d) => d.count === 0).length;

  // Find the Languages entry for coverage stats
  const languageEntry = datasets.find((d) => d.name === "Languages");

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Database className="h-6 w-6 text-blue-600" />
            Data Overview
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            All datasets stored as TSV/CSV files in the lexicons/ directory
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold text-blue-600">{datasets.length}</div>
            <div className="text-sm text-gray-500">Datasets</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold text-emerald-600">{totalRecords.toLocaleString()}</div>
            <div className="text-sm text-gray-500">Total Records</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold text-green-600">{populatedDatasets}</div>
            <div className="text-sm text-gray-500">Populated</div>
          </Card>
          <Card className="p-4">
            <div className="text-2xl font-bold text-amber-600">{emptyDatasets}</div>
            <div className="text-sm text-gray-500">Empty</div>
          </Card>
        </div>

        {/* Language Coverage */}
        {languageEntry?.coverage && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Language Data Coverage ({languageEntry.count} total languages)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <CoverageBar
                label="Coordinates (lat/lng)"
                filled={languageEntry.coverage.coordinates}
                total={languageEntry.count}
              />
              <CoverageBar
                label="Temporal Data (origin/end)"
                filled={languageEntry.coverage.temporal}
                total={languageEntry.count}
              />
              <CoverageBar
                label="Writing System"
                filled={languageEntry.coverage.writingSystem}
                total={languageEntry.count}
              />
            </div>
          </Card>
        )}

        {/* Dataset Tables by Category */}
        {categories.map((category) => {
          const items = datasets.filter((d) => d.category === category);
          const catTotal = items.reduce((s, d) => s + d.count, 0);
          return (
            <Card key={category} className="overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">{category}</h2>
                <span className="text-xs text-gray-500">{catTotal.toLocaleString()} records</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="px-4 py-2 font-medium">Dataset</th>
                    <th className="px-4 py-2 font-medium text-right">Records</th>
                    <th className="px-4 py-2 font-medium hidden md:table-cell">File</th>
                    <th className="px-4 py-2 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.name} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {item.name}
                        {item.unit && (
                          <span className="text-xs text-gray-400 ml-1">({item.unit})</span>
                        )}
                        {item.note && (
                          <span className="text-xs text-gray-400 ml-1 italic">({item.note})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {item.count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 flex items-center gap-1 w-fit">
                          <FileSpreadsheet className="h-3 w-3" />
                          {item.file}
                        </code>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {item.count > 0 ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 inline-block" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-400 inline-block" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CoverageBar({ label, filled, total }: { label: string; filled: number; total: number }) {
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  const color = pct >= 75 ? "bg-green-500" : pct >= 25 ? "bg-amber-500" : "bg-red-400";

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{filled}/{total} ({pct}%)</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
