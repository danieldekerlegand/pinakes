import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  Network,
  GitCompare,
  Download,
  RefreshCw,
  Minus,
  Search,
  X,
  Info,
  Compass,
  Cpu,
} from "lucide-react";
import { isUsingWorker } from "@/lib/computation-worker";
import type { Language } from "@shared/types";

interface LinguisticDistanceAnalyzerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DistanceMetrics {
  ldnd: number;
  avgLevenshtein: number;
  comparedWords: number;
  coverage: number;
  sharedCognates: number;
}

interface MatrixResult {
  languages: Language[];
  matrix: number[][];
  metric: 'ldnd' | 'levenshtein';
}

type ComparisonMode = 'vocabulary' | 'phonological' | 'grammatical' | 'combined';

interface DimensionalDistance {
  vocabulary: number | null;
  phonological: number | null;
  grammatical: number | null;
  combined: number | null;
}

interface EnhancedPairwiseResult {
  language1Id: string;
  language2Id: string;
  language1: Language;
  language2: Language;
  distances: DimensionalDistance;
  description: string;
  mode: ComparisonMode;
  breakdown: {
    phonological?: {
      consonantOverlap: number;
      vowelOverlap: number;
      toneMatch: boolean;
      syllableStructureSimilarity: number;
      stressSystemMatch: boolean;
    };
    grammatical?: {
      wordOrderMatch: boolean;
      morphologicalTypeMatch: boolean;
      caseSystemOverlap: number;
      genderSystemOverlap: number;
      tamOverlap: number;
      negationMatch: boolean;
      ergativityMatch: boolean;
      evidentialityMatch: boolean;
    };
  };
}

interface NearestResult {
  targetLanguage: Language;
  mode: ComparisonMode;
  nearestLanguages: Array<{
    language: Language;
    distance: number;
  }>;
  count: number;
}

export default function LinguisticDistanceAnalyzer({
  isOpen,
  onClose,
}: LinguisticDistanceAnalyzerProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<'matrix' | 'list' | 'enhanced' | 'nearest'>('matrix');
  const [phoneticMode, setPhoneticMode] = useState<'ipa' | 'asjp' | 'ipa-weighted' | 'wordform'>('asjp');
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('combined');
  const [nearestDimension, setNearestDimension] = useState<ComparisonMode>('combined');

  // Fetch available languages (only those with word data for distance analysis)
  const { data: languagesResponse, isLoading: isLoadingLanguages } = useQuery<{
    languages: Language[];
    count: number;
    totalLanguages: number;
  }>({
    queryKey: ['/api/linguistic-distance/available-languages'],
  });

  const languages = languagesResponse?.languages || [];

  // Calculate distance matrix (vocabulary mode)
  const {
    data: matrixResult,
    mutate: calculateMatrix,
    isPending: isCalculating,
  } = useMutation<MatrixResult, Error, { languageIds: string[]; metric: string; phoneticMode: string }>({
    mutationFn: async ({ languageIds, metric, phoneticMode: pm }) => {
      const response = await fetch('/api/linguistic-distance/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageIds, metric, phoneticMode: pm }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to calculate distance matrix');
      }
      return response.json();
    },
  });

  // Enhanced pairwise comparison
  const {
    data: enhancedResult,
    mutate: calculateEnhanced,
    isPending: isCalculatingEnhanced,
  } = useMutation<EnhancedPairwiseResult, Error, { language1Id: string; language2Id: string; mode: ComparisonMode }>({
    mutationFn: async ({ language1Id, language2Id, mode }) => {
      const response = await fetch('/api/linguistic-distance/enhanced/pairwise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language1Id, language2Id, mode }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to calculate enhanced distance');
      }
      return response.json();
    },
  });

  // Nearest neighbors by dimension
  const {
    data: nearestResult,
    mutate: findNearest,
    isPending: isFindingNearest,
  } = useMutation<NearestResult, Error, { languageId: string; mode: ComparisonMode; k: number }>({
    mutationFn: async ({ languageId, mode, k }) => {
      const response = await fetch(`/api/linguistic-distance/enhanced/nearest/${languageId}?mode=${mode}&k=${k}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to find nearest languages');
      }
      return response.json();
    },
  });

  // Filter languages based on search term
  const filteredLanguages = useMemo(() => {
    return languages.filter(lang =>
      lang.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lang.nativeName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lang.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [languages, searchTerm]);

  // Handle analysis
  const handleAnalyze = () => {
    if (selectedLanguages.length < 2) return;

    if (viewMode === 'enhanced' && selectedLanguages.length === 2) {
      calculateEnhanced({
        language1Id: selectedLanguages[0],
        language2Id: selectedLanguages[1],
        mode: comparisonMode,
      });
    } else if (viewMode === 'nearest' && selectedLanguages.length >= 1) {
      findNearest({
        languageId: selectedLanguages[0],
        mode: nearestDimension,
        k: 15,
      });
    } else {
      calculateMatrix({
        languageIds: selectedLanguages,
        metric: 'ldnd',
        phoneticMode: phoneticMode,
      });
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    if (!matrixResult) return;

    const { languages: langs, matrix } = matrixResult;
    const headers = ['Language', ...langs.map(l => l.name)];
    const rows = langs.map((lang, i) => [
      lang.name,
      ...matrix[i].map(d => d.toFixed(4)),
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linguistic-distance-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Get color for distance value (green = similar, red = distant)
  const getDistanceColor = (distance: number): string => {
    if (distance < 0) return 'bg-gray-300 dark:bg-gray-600';
    if (distance === 0) return 'bg-gray-200 dark:bg-gray-700';
    if (distance < 0.2) return 'bg-green-200 dark:bg-green-900';
    if (distance < 0.4) return 'bg-green-100 dark:bg-green-800';
    if (distance < 0.6) return 'bg-yellow-100 dark:bg-yellow-800';
    if (distance < 0.8) return 'bg-orange-100 dark:bg-orange-800';
    return 'bg-red-100 dark:bg-red-800';
  };

  // Get interpretation text
  const getInterpretation = (distance: number): string => {
    if (distance < 0) return 'Insufficient Data';
    if (distance === 0) return 'Identical';
    if (distance < 0.2) return 'Very Similar';
    if (distance < 0.4) return 'Similar';
    if (distance < 0.6) return 'Moderately Different';
    if (distance < 0.8) return 'Different';
    return 'Very Different';
  };

  // Build radar chart data from enhanced result
  const radarData = useMemo(() => {
    if (!enhancedResult) return [];
    const d = enhancedResult.distances;
    return [
      { dimension: 'Vocabulary', similarity: d.vocabulary !== null && d.vocabulary >= 0 ? Math.round((1 - d.vocabulary) * 100) : 0, hasData: d.vocabulary !== null && d.vocabulary >= 0 },
      { dimension: 'Phonological', similarity: d.phonological !== null ? Math.round((1 - d.phonological) * 100) : 0, hasData: d.phonological !== null },
      { dimension: 'Grammatical', similarity: d.grammatical !== null ? Math.round((1 - d.grammatical) * 100) : 0, hasData: d.grammatical !== null },
    ];
  }, [enhancedResult]);

  const selectedLangNames = languages
    .filter(lang => selectedLanguages.includes(lang.id))
    .map(lang => lang.name)
    .join(", ");

  const isAnyLoading = isCalculating || isCalculatingEnhanced || isFindingNearest;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-[1000px] max-w-[90vw] bg-white dark:bg-gray-900 shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                <Network className="h-5 w-5 mr-2" />
                Linguistic Distance Analyzer
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Compare languages by vocabulary, phonology, grammar, or all combined
                {languagesResponse && (
                  <span className="ml-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                    ({languagesResponse.count} of {languagesResponse.totalLanguages} languages have data)
                  </span>
                )}
              </p>
              <Badge variant="outline" className="mt-1 text-xs gap-1">
                <Cpu className="h-3 w-3" />
                {isUsingWorker() ? 'WebWorker enabled' : 'Main thread'}
              </Badge>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Language Selection */}
            <div>
              <Label className="text-sm font-medium mb-3 block">
                Select Languages to Analyze
              </Label>

              {/* Search Languages */}
              <div className="relative mb-4">
                <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                <Input
                  placeholder="Search languages by name or ISO code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Language Selection Grid */}
              <div className="h-64 border rounded-lg overflow-hidden">
                <ScrollArea className="h-full p-4">
                  <div className="grid grid-cols-2 gap-2">
                    {filteredLanguages.map((language) => (
                      <div
                        key={language.id}
                        className="flex items-center space-x-2 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
                      >
                        <Checkbox
                          id={`lang-${language.id}`}
                          checked={selectedLanguages.includes(language.id)}
                          onCheckedChange={(checked) => {
                            if (checked === true) {
                              setSelectedLanguages(prev => [...prev, language.id]);
                            } else {
                              setSelectedLanguages(prev => prev.filter(id => id !== language.id));
                            }
                          }}
                        />
                        <label
                          htmlFor={`lang-${language.id}`}
                          className="flex-1 min-w-0 cursor-pointer"
                        >
                          <div className="text-sm font-medium truncate">{language.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {language.id}
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Selected Languages Display */}
              {selectedLanguages.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm">
                      Selected Languages ({selectedLanguages.length})
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedLanguages([])}
                    >
                      Clear All
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedLanguages.map((langId) => {
                      const language = languages.find(l => l.id === langId);
                      return language ? (
                        <Badge
                          key={langId}
                          variant="secondary"
                          className="cursor-pointer hover:bg-red-100 dark:hover:bg-red-900"
                          onClick={() => setSelectedLanguages(prev => prev.filter(id => id !== langId))}
                        >
                          {language.name}
                          <Minus className="h-3 w-3 ml-1" />
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Comparison Mode Selection */}
            {selectedLanguages.length >= 2 && (
              <div>
                <Label className="text-sm font-medium mb-2 block">Comparison Mode</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { mode: 'vocabulary' as ComparisonMode, label: 'Vocabulary', desc: 'Lexical LDND' },
                    { mode: 'phonological' as ComparisonMode, label: 'Phonological', desc: 'Sound systems' },
                    { mode: 'grammatical' as ComparisonMode, label: 'Grammatical', desc: 'Grammar features' },
                    { mode: 'combined' as ComparisonMode, label: 'Combined', desc: 'All dimensions' },
                  ]).map(({ mode, label, desc }) => (
                    <button
                      key={mode}
                      onClick={() => setComparisonMode(mode)}
                      className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                        comparisonMode === mode
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-950 text-purple-900 dark:text-purple-100'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Phonetic Mode Selection - only for vocabulary/combined modes */}
            {selectedLanguages.length >= 2 && (comparisonMode === 'vocabulary' || comparisonMode === 'combined') && (
              <div>
                <Label className="text-sm font-medium mb-2 block">Phonetic Encoding (for vocabulary)</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { mode: 'asjp' as const, label: 'ASJP', desc: 'Standard' },
                    { mode: 'ipa' as const, label: 'IPA', desc: 'Precise' },
                    { mode: 'ipa-weighted' as const, label: 'IPA+', desc: 'Most accurate' },
                    { mode: 'wordform' as const, label: 'Spelling', desc: 'Orthography' },
                  ]).map(({ mode, label, desc }) => (
                    <button
                      key={mode}
                      onClick={() => setPhoneticMode(mode)}
                      className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                        phoneticMode === mode
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* View Mode + Analysis Actions */}
            {selectedLanguages.length >= 2 && (
              <div className="space-y-3">
                <Label className="text-sm font-medium block">Analysis View</Label>
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
                  <TabsList className="w-full">
                    <TabsTrigger value="matrix" className="flex-1">Matrix</TabsTrigger>
                    <TabsTrigger value="list" className="flex-1">List</TabsTrigger>
                    <TabsTrigger value="enhanced" className="flex-1" disabled={selectedLanguages.length !== 2}>
                      Radar Profile
                    </TabsTrigger>
                    <TabsTrigger value="nearest" className="flex-1">
                      Nearest
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {viewMode === 'nearest' && (
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Filter Nearest By</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['vocabulary', 'phonological', 'grammatical', 'combined'] as ComparisonMode[]).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setNearestDimension(mode)}
                          className={`p-2 rounded-lg border text-xs font-medium transition-colors ${
                            nearestDimension === mode
                              ? 'border-green-500 bg-green-50 dark:bg-green-950 text-green-900 dark:text-green-100'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                          }`}
                        >
                          {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Button
                    onClick={handleAnalyze}
                    disabled={isAnyLoading}
                    className="flex-1"
                  >
                    {isAnyLoading ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : viewMode === 'enhanced' ? (
                      <Compass className="h-4 w-4 mr-2" />
                    ) : (
                      <GitCompare className="h-4 w-4 mr-2" />
                    )}
                    {viewMode === 'enhanced' ? 'Compare Dimensions' : viewMode === 'nearest' ? 'Find Nearest' : 'Analyze Distances'}
                  </Button>
                  {matrixResult && (viewMode === 'matrix' || viewMode === 'list') && (
                    <Button variant="outline" onClick={exportToCSV}>
                      <Download className="h-4 w-4 mr-2" />
                      Export CSV
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Info Box */}
            <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <CardContent className="pt-4">
                <div className="flex items-start space-x-2">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-900 dark:text-blue-100">
                    <p className="font-medium mb-1">Multi-Dimensional Language Comparison</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      Compare languages across vocabulary (LDND lexical distance), phonology (sound inventory overlap),
                      and grammar (structural feature similarity). Use the Radar Profile view with exactly 2 languages
                      to see a spider chart of multi-dimensional similarity. Lower distance = more similar.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Matrix/List Results */}
            {selectedLanguages.length >= 2 && matrixResult && (viewMode === 'matrix' || viewMode === 'list') && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <Label className="text-sm font-medium">
                    Analysis Results: {selectedLangNames}
                  </Label>
                </div>

                {viewMode === 'matrix' && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Distance Matrix Heatmap</CardTitle>
                      <CardDescription>
                        Color-coded similarity: Green = Similar, Red = Different
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-96">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr>
                                <th className="p-2 text-left font-medium sticky left-0 bg-white dark:bg-gray-900">
                                  Language
                                </th>
                                {matrixResult.languages.map((lang) => (
                                  <th
                                    key={lang.id}
                                    className="p-2 text-left font-medium text-xs"
                                    title={lang.name}
                                  >
                                    <div className="w-16 truncate">{lang.name}</div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {matrixResult.languages.map((lang1, i) => (
                                <tr key={lang1.id}>
                                  <td className="p-2 font-medium sticky left-0 bg-white dark:bg-gray-900 border-r">
                                    {lang1.name}
                                  </td>
                                  {matrixResult.languages.map((lang2, j) => {
                                    const distance = matrixResult.matrix[i][j];
                                    return (
                                      <td
                                        key={lang2.id}
                                        className={`p-2 text-center ${getDistanceColor(distance)}`}
                                        title={`${lang1.name} ↔ ${lang2.name}: ${distance.toFixed(4)} (${getInterpretation(distance)})`}
                                      >
                                        <div className="font-mono text-xs">
                                          {distance.toFixed(3)}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}

                {viewMode === 'list' && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Pairwise Distances</CardTitle>
                      <CardDescription>
                        All language pairs sorted by similarity
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-96">
                        <div className="space-y-2">
                          {matrixResult.languages.flatMap((lang1, i) =>
                            matrixResult.languages.slice(i + 1).map((lang2, j) => {
                              const actualJ = i + 1 + j;
                              const distance = matrixResult.matrix[i][actualJ];
                              return { lang1, lang2, distance };
                            })
                          )
                            .sort((a, b) => a.distance - b.distance)
                            .map(({ lang1, lang2, distance }) => (
                              <div
                                key={`${lang1.id}-${lang2.id}`}
                                className={`p-3 rounded-lg ${getDistanceColor(distance)}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="font-medium text-sm">
                                      {lang1.name} ↔ {lang2.name}
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                      {getInterpretation(distance)}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-mono text-lg font-bold">
                                      {distance.toFixed(3)}
                                    </div>
                                    <div className="text-xs text-gray-600 dark:text-gray-400">
                                      LDND Score
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Enhanced Radar Profile */}
            {viewMode === 'enhanced' && enhancedResult && (
              <div className="space-y-4">
                {/* Description */}
                <Card className="bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
                  <CardContent className="pt-4">
                    <p className="text-sm text-purple-900 dark:text-purple-100 font-medium">
                      {enhancedResult.description}
                    </p>
                  </CardContent>
                </Card>

                {/* Radar Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Multi-Dimensional Similarity Profile
                    </CardTitle>
                    <CardDescription>
                      {enhancedResult.language1.name} vs {enhancedResult.language2.name} — Similarity % by dimension
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="80%">
                        <PolarGrid />
                        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12 }} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Radar
                          name="Similarity %"
                          dataKey="similarity"
                          stroke="#8b5cf6"
                          fill="#8b5cf6"
                          fillOpacity={0.3}
                        />
                        <Tooltip
                          formatter={(value: number, _name: string, props: { payload?: { hasData?: boolean } }) => {
                            const item = props.payload;
                            if (item && !item.hasData) return ['No data', 'Similarity'];
                            return [`${value}%`, 'Similarity'];
                          }}
                        />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Dimensional Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dimensional Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Vocabulary */}
                      <DimensionBar
                        label="Vocabulary"
                        distance={enhancedResult.distances.vocabulary}
                        color="blue"
                      />
                      {/* Phonological */}
                      <DimensionBar
                        label="Phonological"
                        distance={enhancedResult.distances.phonological}
                        color="green"
                      />
                      {enhancedResult.breakdown.phonological && (
                        <div className="ml-4 grid grid-cols-2 gap-2 text-xs">
                          <span>Consonant overlap: {Math.round(enhancedResult.breakdown.phonological.consonantOverlap * 100)}%</span>
                          <span>Vowel overlap: {Math.round(enhancedResult.breakdown.phonological.vowelOverlap * 100)}%</span>
                          <span>Tone system: {enhancedResult.breakdown.phonological.toneMatch ? 'Match' : 'Mismatch'}</span>
                          <span>Syllable structure: {Math.round(enhancedResult.breakdown.phonological.syllableStructureSimilarity * 100)}%</span>
                          <span>Stress system: {enhancedResult.breakdown.phonological.stressSystemMatch ? 'Match' : 'Mismatch'}</span>
                        </div>
                      )}
                      {/* Grammatical */}
                      <DimensionBar
                        label="Grammatical"
                        distance={enhancedResult.distances.grammatical}
                        color="orange"
                      />
                      {enhancedResult.breakdown.grammatical && (
                        <div className="ml-4 grid grid-cols-2 gap-2 text-xs">
                          <span>Word order: {enhancedResult.breakdown.grammatical.wordOrderMatch ? 'Match' : 'Mismatch'}</span>
                          <span>Morphology: {enhancedResult.breakdown.grammatical.morphologicalTypeMatch ? 'Match' : 'Mismatch'}</span>
                          <span>Case overlap: {Math.round(enhancedResult.breakdown.grammatical.caseSystemOverlap * 100)}%</span>
                          <span>Gender overlap: {Math.round(enhancedResult.breakdown.grammatical.genderSystemOverlap * 100)}%</span>
                          <span>TAM overlap: {Math.round(enhancedResult.breakdown.grammatical.tamOverlap * 100)}%</span>
                          <span>Ergativity: {enhancedResult.breakdown.grammatical.ergativityMatch ? 'Match' : 'Mismatch'}</span>
                        </div>
                      )}
                      {/* Combined */}
                      <DimensionBar
                        label="Combined"
                        distance={enhancedResult.distances.combined}
                        color="purple"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Nearest Neighbors View */}
            {viewMode === 'nearest' && nearestResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Nearest Languages to {nearestResult.targetLanguage.name}
                  </CardTitle>
                  <CardDescription>
                    Filtered by {nearestResult.mode} similarity ({nearestResult.count} results)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    <div className="space-y-2">
                      {nearestResult.nearestLanguages.map((item, idx) => (
                        <div
                          key={item.language.id}
                          className={`p-3 rounded-lg ${getDistanceColor(item.distance)}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="font-medium text-sm">
                                <span className="text-gray-500 mr-2">#{idx + 1}</span>
                                {item.language.name}
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                {getInterpretation(item.distance)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-lg font-bold">
                                {item.distance.toFixed(3)}
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {Math.round((1 - item.distance) * 100)}% similar
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {isLoadingLanguages && (
              <Card className="p-8 text-center">
                <RefreshCw className="h-12 w-12 text-gray-400 mx-auto mb-4 animate-spin" />
                <p className="text-gray-600 dark:text-gray-400">
                  Loading available languages...
                </p>
              </Card>
            )}

            {!isLoadingLanguages && languages.length === 0 && (
              <Card className="p-8 text-center border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950">
                <Info className="h-12 w-12 text-yellow-600 dark:text-yellow-400 mx-auto mb-4" />
                <p className="text-gray-900 dark:text-gray-100 font-medium mb-2">
                  No Languages with Word Data Found
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Distance analysis requires languages to have lexical data in the database.
                  Please scrape word lists for languages first using the floating action button.
                </p>
              </Card>
            )}

            {!isLoadingLanguages && languages.length > 0 && selectedLanguages.length < 2 && (
              <Card className="p-8 text-center">
                <Network className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">
                  Select at least 2 languages to start analyzing linguistic distances
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DimensionBar({
  label,
  distance,
  color,
}: {
  label: string;
  distance: number | null;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    orange: 'bg-orange-500',
    purple: 'bg-purple-500',
  };

  if (distance === null || distance < 0) {
    return (
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium">{label}</span>
          <span className="text-gray-400">No data</span>
        </div>
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>
    );
  }

  const similarity = Math.round((1 - distance) * 100);

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className="font-mono">{similarity}% similar (distance: {distance.toFixed(3)})</span>
      </div>
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorMap[color] || 'bg-blue-500'} rounded-full transition-all`}
          style={{ width: `${similarity}%` }}
        />
      </div>
    </div>
  );
}
