import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  X,
  BookOpen,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { Language } from "@shared/types";

interface GrammarFeatures {
  [key: string]: string | string[] | number;
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
}

interface GrammarPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Feature category groupings
const FEATURE_CATEGORIES: Record<string, { label: string; features: string[] }> = {
  "word-order": {
    label: "Word Order",
    features: ["wordOrder"],
  },
  morphology: {
    label: "Morphology",
    features: ["morphologicalType", "nounClassCount"],
  },
  case: {
    label: "Case & Agreement",
    features: ["caseSystem", "genderSystem", "numberSystem", "agreementSystem", "ergativity"],
  },
  tam: {
    label: "TAM & Verb",
    features: ["tenseAspectMood", "verbValencyChanges", "evidentiality"],
  },
  syntax: {
    label: "Syntax",
    features: ["negationStrategy", "questionFormation", "relativeClauseStrategy"],
  },
};

// Color maps for categorical features
const WORD_ORDER_COLORS: Record<string, string> = {
  SVO: "bg-green-100 text-green-800",
  SOV: "bg-blue-100 text-blue-800",
  VSO: "bg-orange-100 text-orange-800",
  VOS: "bg-purple-100 text-purple-800",
  OVS: "bg-red-100 text-red-800",
  OSV: "bg-pink-100 text-pink-800",
  V2: "bg-yellow-100 text-yellow-800",
  "V2/SVO": "bg-yellow-100 text-yellow-800",
  "V2/SOV": "bg-yellow-100 text-yellow-800",
  free: "bg-gray-100 text-gray-800",
};

const MORPHOLOGY_COLORS: Record<string, string> = {
  fusional: "bg-indigo-100 text-indigo-800",
  agglutinative: "bg-teal-100 text-teal-800",
  isolating: "bg-amber-100 text-amber-800",
  polysynthetic: "bg-rose-100 text-rose-800",
};

const ERGATIVITY_COLORS: Record<string, string> = {
  "nominative-accusative": "bg-sky-100 text-sky-800",
  "ergative-absolutive": "bg-fuchsia-100 text-fuchsia-800",
  "split-ergative": "bg-violet-100 text-violet-800",
  none: "bg-gray-100 text-gray-600",
};

// Feature display names
const FEATURE_LABELS: Record<string, string> = {
  wordOrder: "Word Order",
  morphologicalType: "Morphological Type",
  caseSystem: "Case System",
  genderSystem: "Gender System",
  numberSystem: "Number System",
  tenseAspectMood: "Tense/Aspect/Mood",
  agreementSystem: "Agreement",
  negationStrategy: "Negation",
  questionFormation: "Questions",
  relativeClauseStrategy: "Relative Clauses",
  nounClassCount: "Noun Classes",
  verbValencyChanges: "Verb Valency",
  evidentiality: "Evidentiality",
  ergativity: "Ergativity",
};

// Check if a feature value is rare (appears in <5% of languages)
function isRareValue(feature: string, value: string, allFeatures: GrammarFeatures[]): boolean {
  const total = allFeatures.length;
  if (total === 0) return false;
  let count = 0;
  for (const gf of allFeatures) {
    const v = gf[feature];
    if (typeof v === "string" && v === value) count++;
  }
  return count / total < 0.05;
}

function getFeatureValue(gf: GrammarFeatures, feature: string): string {
  const val = gf[feature];
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "number") return val.toString();
  return String(val);
}

function getCellColor(feature: string, value: string): string {
  if (feature === "wordOrder") return WORD_ORDER_COLORS[value] || "bg-gray-50 text-gray-700";
  if (feature === "morphologicalType") return MORPHOLOGY_COLORS[value] || "bg-gray-50 text-gray-700";
  if (feature === "ergativity") return ERGATIVITY_COLORS[value] || "bg-gray-50 text-gray-700";
  return "";
}

// Compute structural similarity between two languages (0-100)
function computeSimilarity(a: GrammarFeatures, b: GrammarFeatures): number {
  let matches = 0;
  let total = 0;

  // String features (exact match)
  const stringFeatures = [
    "wordOrder", "morphologicalType", "agreementSystem",
    "negationStrategy", "questionFormation", "relativeClauseStrategy",
    "evidentiality", "ergativity",
  ];
  for (const f of stringFeatures) {
    total++;
    if (a[f] === b[f]) matches++;
  }

  // Array features (Jaccard similarity)
  const arrayFeatures = ["caseSystem", "genderSystem", "numberSystem", "tenseAspectMood", "verbValencyChanges"];
  for (const f of arrayFeatures) {
    total++;
    const aArr = a[f] as string[];
    const bArr = b[f] as string[];
    if (aArr && bArr) {
      const setA = new Set(aArr);
      const setB = new Set(bArr);
      const intersection = Array.from(setA).filter(x => setB.has(x)).length;
      const union = new Set([...Array.from(setA), ...Array.from(setB)]).size;
      if (union > 0) matches += intersection / union;
    }
  }

  // Noun class count (closeness)
  total++;
  const diff = Math.abs(a.nounClassCount - b.nounClassCount);
  if (diff === 0) matches++;
  else if (diff <= 2) matches += 0.5;

  return Math.round((matches / total) * 100);
}

type SortDir = "asc" | "desc";

export default function GrammarPanel({ isOpen, onClose }: GrammarPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [sortFeature, setSortFeature] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  const { data: grammarData = [] } = useQuery<GrammarFeatures[]>({
    queryKey: ["/api/grammar-features"],
    enabled: isOpen,
  });

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ["/api/languages"],
    enabled: isOpen,
  });

  // Map languageId -> language name
  const langNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const l of languages) {
      map[l.id] = l.name;
    }
    return map;
  }, [languages]);

  // Active features list based on category filter
  const activeFeatures = useMemo(() => {
    if (activeCategory === "all") {
      return Object.values(FEATURE_CATEGORIES).flatMap(c => c.features);
    }
    return FEATURE_CATEGORIES[activeCategory]?.features || [];
  }, [activeCategory]);

  // Filter by search
  const filteredData = useMemo(() => {
    let data = grammarData;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter(gf => {
        const name = langNameMap[gf.languageId] || gf.languageId;
        return name.toLowerCase().includes(q) || gf.languageId.toLowerCase().includes(q);
      });
    }
    return data;
  }, [grammarData, searchQuery, langNameMap]);

  // Sort
  const sortedData = useMemo(() => {
    if (!sortFeature) return filteredData;
    const sorted = [...filteredData].sort((a, b) => {
      const valA = getFeatureValue(a, sortFeature);
      const valB = getFeatureValue(b, sortFeature);
      const cmp = valA.localeCompare(valB);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredData, sortFeature, sortDir]);

  // Similarity score
  const similarityScore = useMemo(() => {
    if (!compareA || !compareB) return null;
    const a = grammarData.find(g => g.languageId === compareA);
    const b = grammarData.find(g => g.languageId === compareB);
    if (!a || !b) return null;
    return computeSimilarity(a, b);
  }, [compareA, compareB, grammarData]);

  const handleSort = (feature: string) => {
    if (sortFeature === feature) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortFeature(feature);
      setSortDir("asc");
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-6xl bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-blue-600 text-white">
          <div className="flex items-center space-x-3">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-lg font-medium">Grammar Comparison Matrix</h2>
            <Badge variant="secondary" className="bg-blue-500 text-white">
              {grammarData.length} languages
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-blue-700"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b bg-gray-50 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Input
                type="text"
                placeholder="Search languages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            </div>

            {/* Category filter */}
            <Select value={activeCategory} onValueChange={setActiveCategory}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Feature category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Features</SelectItem>
                {Object.entries(FEATURE_CATEGORIES).map(([key, cat]) => (
                  <SelectItem key={key} value={key}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Similarity comparison */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Similarity:</span>
            <Select value={compareA || ""} onValueChange={(v) => setCompareA(v || null)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Language A" />
              </SelectTrigger>
              <SelectContent>
                {grammarData.map(gf => (
                  <SelectItem key={gf.languageId} value={gf.languageId}>
                    {langNameMap[gf.languageId] || gf.languageId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-gray-400">vs</span>
            <Select value={compareB || ""} onValueChange={(v) => setCompareB(v || null)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Language B" />
              </SelectTrigger>
              <SelectContent>
                {grammarData.map(gf => (
                  <SelectItem key={gf.languageId} value={gf.languageId}>
                    {langNameMap[gf.languageId] || gf.languageId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {similarityScore !== null && (
              <Badge
                className={
                  similarityScore >= 70
                    ? "bg-green-100 text-green-800"
                    : similarityScore >= 40
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-red-100 text-red-800"
                }
              >
                {similarityScore}% similar
              </Badge>
            )}
          </div>
        </div>

        {/* Matrix table */}
        <ScrollArea className="flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <th className="text-left px-3 py-2 border-b border-r font-medium text-gray-700 sticky left-0 bg-white z-20 min-w-[150px]">
                    Language
                  </th>
                  {activeFeatures.map(f => (
                    <th
                      key={f}
                      className="text-left px-3 py-2 border-b font-medium text-gray-700 cursor-pointer hover:bg-gray-100 min-w-[120px] select-none"
                      onClick={() => handleSort(f)}
                    >
                      <div className="flex items-center gap-1">
                        <span>{FEATURE_LABELS[f] || f}</span>
                        {sortFeature === f ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-300" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map(gf => {
                  const langName = langNameMap[gf.languageId] || gf.languageId;
                  const isCompared = gf.languageId === compareA || gf.languageId === compareB;
                  return (
                    <tr
                      key={gf.id}
                      className={`border-b hover:bg-gray-50 ${isCompared ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-2 border-r font-medium text-gray-900 sticky left-0 bg-white z-10">
                        <div className="flex items-center gap-1">
                          <span>{langName}</span>
                          <span className="text-xs text-gray-400">({gf.languageId})</span>
                        </div>
                      </td>
                      {activeFeatures.map(f => {
                        const value = getFeatureValue(gf, f);
                        const colorClass = getCellColor(f, value);
                        const rare = typeof gf[f] === "string" &&
                          isRareValue(f, value, grammarData);
                        return (
                          <td key={f} className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              {colorClass ? (
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
                                  {value}
                                </span>
                              ) : (
                                <span className="text-gray-700 text-xs">{value}</span>
                              )}
                              {rare && (
                                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Rare feature (< 5% of languages)" />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {sortedData.length === 0 && (
                  <tr>
                    <td colSpan={activeFeatures.length + 1} className="px-6 py-12 text-center text-gray-500">
                      {grammarData.length === 0 ? "Loading grammar data..." : "No languages match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ScrollArea>

        {/* Legend */}
        <div className="px-6 py-3 border-t bg-gray-50">
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span className="font-medium">Word Order:</span>
            {Object.entries(WORD_ORDER_COLORS).slice(0, 6).map(([k, cls]) => (
              <span key={k} className={`px-2 py-0.5 rounded ${cls}`}>{k}</span>
            ))}
            <span className="mx-2 text-gray-300">|</span>
            <span className="font-medium">Morphology:</span>
            {Object.entries(MORPHOLOGY_COLORS).map(([k, cls]) => (
              <span key={k} className={`px-2 py-0.5 rounded ${cls}`}>{k}</span>
            ))}
            <span className="mx-2 text-gray-300">|</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              Rare feature (&lt;5%)
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
