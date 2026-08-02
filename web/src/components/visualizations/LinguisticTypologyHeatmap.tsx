import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import type { Language } from "@contracts/types";
import { HeatmapGrid } from "./shared/HeatmapGrid";
import { makeColorScale, encodeFeatureValue, formatFeatureValue } from "./shared/heatmap-utils";
import type { HeatmapCell } from "./shared/heatmap-utils";

interface GrammarFeatures {
  id: string;
  languageId: string;
  wordOrder: string;
  morphologicalType: string;
  caseSystem: string[];
  genderSystem: string[];
  numberSystem: string[];
  tenseAspectMood: string[];
  agreementSystem: string;
  negationStrategy: string;
  questionFormation: string;
  relativeClauseStrategy: string;
  nounClassCount: number;
  verbValencyChanges: string[];
  evidentiality: string;
  ergativity: string;
  [key: string]: string | string[] | number;
}

// Typological features to display on the heatmap
const TYPOLOGY_FEATURES = [
  { key: "wordOrder", label: "Word Order" },
  { key: "morphologicalType", label: "Morphology" },
  { key: "ergativity", label: "Ergativity" },
  { key: "agreementSystem", label: "Agreement" },
  { key: "negationStrategy", label: "Negation" },
  { key: "questionFormation", label: "Questions" },
  { key: "relativeClauseStrategy", label: "Relative Clauses" },
  { key: "evidentiality", label: "Evidentiality" },
  { key: "nounClassCount", label: "Noun Classes" },
] as const;

const typologyColorScale = makeColorScale([
  { at: 0, color: "bg-slate-100 dark:bg-slate-800 text-slate-600" },
  { at: 0.01, color: "bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200" },
  { at: 0.2, color: "bg-cyan-200 dark:bg-cyan-800 text-cyan-900 dark:text-cyan-100" },
  { at: 0.4, color: "bg-teal-300 dark:bg-teal-700 text-teal-900 dark:text-teal-100" },
  { at: 0.6, color: "bg-emerald-400 dark:bg-emerald-600 text-emerald-900 dark:text-emerald-100" },
  { at: 0.8, color: "bg-green-500 dark:bg-green-500 text-white" },
]);

interface LinguisticTypologyHeatmapProps {
  embedded?: boolean;
}

export default function LinguisticTypologyHeatmap({ embedded }: LinguisticTypologyHeatmapProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [featureFilter, setFeatureFilter] = useState<string>("all");
  const [maxLanguages, setMaxLanguages] = useState(50);

  const { data: grammarData = [] } = useQuery<
    { features: GrammarFeatures[]; count: number },
    Error,
    GrammarFeatures[]
  >({
    queryKey: ["/api/grammar-features"],
    select: (data) => data.features,
  });

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ["/api/languages"],
  });

  const langNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const l of languages) {
      map[l.id] = l.name;
    }
    return map;
  }, [languages]);

  // Filter languages by search
  const filteredData = useMemo(() => {
    let data = grammarData;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter((gf) => {
        const name = langNameMap[gf.languageId] || gf.languageId;
        return name.toLowerCase().includes(q) || gf.languageId.toLowerCase().includes(q);
      });
    }
    return data.slice(0, maxLanguages);
  }, [grammarData, searchQuery, langNameMap, maxLanguages]);

  // Filter features
  const activeFeatures = useMemo(() => {
    if (featureFilter === "all") return TYPOLOGY_FEATURES;
    return TYPOLOGY_FEATURES.filter((f) => f.key === featureFilter);
  }, [featureFilter]);

  // Build heatmap data
  const { rows, columns, cells } = useMemo(() => {
    const rows = filteredData.map((gf) => langNameMap[gf.languageId] || gf.languageId);
    const columns = activeFeatures.map((f) => f.label);
    const cells: HeatmapCell[] = [];

    for (let ri = 0; ri < filteredData.length; ri++) {
      const gf = filteredData[ri];
      for (let ci = 0; ci < activeFeatures.length; ci++) {
        const feat = activeFeatures[ci];
        const rawValue = gf[feat.key];
        if (rawValue === undefined || rawValue === null) continue;
        const value = encodeFeatureValue(feat.key, rawValue);
        const label = typeof rawValue === "number"
          ? rawValue.toString()
          : Array.isArray(rawValue)
            ? rawValue.length.toString()
            : String(rawValue);
        cells.push({ row: ri, col: ci, value, label });
      }
    }

    return { rows, columns, cells };
  }, [filteredData, activeFeatures, langNameMap]);

  const formatTooltip = useMemo(() => {
    return (row: string, col: string, value: number) => {
      const langData = filteredData.find(
        (gf) => (langNameMap[gf.languageId] || gf.languageId) === row
      );
      if (!langData) return `${row} × ${col}: N/A`;
      const feat = activeFeatures.find((f) => f.label === col);
      if (!feat) return `${row} × ${col}: N/A`;
      const rawValue = langData[feat.key];
      return `${row} — ${col}: ${formatFeatureValue(feat.key, rawValue)}`;
    };
  }, [filteredData, activeFeatures, langNameMap]);

  return (
    <Card className={embedded ? "border-0 shadow-none" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Linguistic Typology Heatmap</CardTitle>
        <CardDescription>
          Compare grammatical features across languages. Each cell represents a typological feature value.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search languages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-7 w-7 p-0"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Select value={featureFilter} onValueChange={setFeatureFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Feature filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Features</SelectItem>
              {TYPOLOGY_FEATURES.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={maxLanguages.toString()}
            onValueChange={(v) => setMaxLanguages(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25 languages</SelectItem>
              <SelectItem value="50">50 languages</SelectItem>
              <SelectItem value="100">100 languages</SelectItem>
              <SelectItem value="200">200 languages</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {filteredData.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            {grammarData.length === 0
              ? "No grammar feature data available. Run the grammar scraper first."
              : "No languages match your search."}
          </div>
        ) : (
          <>
            <HeatmapGrid
              rows={rows}
              columns={columns}
              cells={cells}
              colorScale={typologyColorScale}
              formatValue={(v) => v.toFixed(1)}
              formatTooltip={formatTooltip}
              cellSize="sm"
              maxHeight="h-[600px]"
            />
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <span>Showing {filteredData.length} of {grammarData.length} languages</span>
              <div className="flex items-center gap-1">
                <span>Scale:</span>
                <span className="inline-block w-4 h-3 bg-slate-100 dark:bg-slate-800 border" />
                <span>Low</span>
                <span className="inline-block w-4 h-3 bg-cyan-200 dark:bg-cyan-800 border" />
                <span className="inline-block w-4 h-3 bg-teal-300 dark:bg-teal-700 border" />
                <span className="inline-block w-4 h-3 bg-emerald-400 dark:bg-emerald-600 border" />
                <span className="inline-block w-4 h-3 bg-green-500 border" />
                <span>High</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
