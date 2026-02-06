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
  Network,
  GitCompare,
  Download,
  RefreshCw,
  Minus,
  Search,
  X,
  Info,
} from "lucide-react";
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

interface PairwiseResult {
  language1: Language;
  language2: Language;
  lexical: DistanceMetrics;
  confidence: number;
  genealogical?: {
    distance: number;
    sameFamily: boolean;
  };
  geographic?: {
    distanceKm: number | null;
    hasData: boolean;
  };
}

interface MatrixResult {
  languages: Language[];
  matrix: number[][];
  metric: 'ldnd' | 'levenshtein';
}

export default function LinguisticDistanceAnalyzer({
  isOpen,
  onClose,
}: LinguisticDistanceAnalyzerProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<'matrix' | 'list'>('matrix');
  const [phoneticMode, setPhoneticMode] = useState<'ipa' | 'asjp' | 'ipa-weighted' | 'wordform'>('asjp');

  // Fetch available languages (only those with word data for distance analysis)
  const { data: languagesResponse, isLoading: isLoadingLanguages } = useQuery<{
    languages: Language[];
    count: number;
    totalLanguages: number;
  }>({
    queryKey: ['/api/linguistic-distance/available-languages'],
  });

  const languages = languagesResponse?.languages || [];

  // Calculate distance matrix
  const {
    data: matrixResult,
    mutate: calculateMatrix,
    isPending: isCalculating,
  } = useMutation<MatrixResult, Error, { languageIds: string[]; metric: string; phoneticMode: string }>({
    mutationFn: async ({ languageIds, metric, phoneticMode }) => {
      const response = await fetch('/api/linguistic-distance/matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageIds, metric, phoneticMode }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to calculate distance matrix');
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
    if (selectedLanguages.length >= 2) {
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
    if (distance < 0) return 'bg-gray-300 dark:bg-gray-600'; // Insufficient data
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

  const selectedLangNames = languages
    .filter(lang => selectedLanguages.includes(lang.id))
    .map(lang => lang.name)
    .join(", ");

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
                Calculate lexical similarity using ASJP-based LDND algorithm
                {languagesResponse && (
                  <span className="ml-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                    ({languagesResponse.count} of {languagesResponse.totalLanguages} languages have word data)
                  </span>
                )}
              </p>
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

            {/* Phonetic Mode Selection */}
            {selectedLanguages.length >= 2 && (
              <div>
                <Label className="text-sm font-medium mb-2 block">Phonetic Encoding</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button
                    onClick={() => setPhoneticMode('asjp')}
                    className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                      phoneticMode === 'asjp'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium">ASJP</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Standard
                    </div>
                  </button>
                  <button
                    onClick={() => setPhoneticMode('ipa')}
                    className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                      phoneticMode === 'ipa'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium">IPA</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Precise
                    </div>
                  </button>
                  <button
                    onClick={() => setPhoneticMode('ipa-weighted')}
                    className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                      phoneticMode === 'ipa-weighted'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium">IPA+</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Most accurate
                    </div>
                  </button>
                  <button
                    onClick={() => setPhoneticMode('wordform')}
                    className={`p-3 rounded-lg border-2 text-sm transition-colors ${
                      phoneticMode === 'wordform'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium">Spelling</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Orthography
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Analysis Actions */}
            {selectedLanguages.length >= 2 && (
              <div className="flex items-center space-x-2">
                <Button
                  onClick={handleAnalyze}
                  disabled={isCalculating}
                  className="flex-1"
                >
                  {isCalculating ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <GitCompare className="h-4 w-4 mr-2" />
                  )}
                  Analyze Distances
                </Button>
                {matrixResult && (
                  <Button variant="outline" onClick={exportToCSV}>
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                )}
              </div>
            )}

            {/* Info Box */}
            <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <CardContent className="pt-4">
                <div className="flex items-start space-x-2">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-900 dark:text-blue-100">
                    <p className="font-medium mb-1">About LDND (Levenshtein Distance Normalized Divided)</p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      Lower values (closer to 0) indicate more similar languages. Values near 1.0 indicate very different languages.
                      The algorithm uses ASJP phonetic encoding and corrects for chance similarity by comparing against random word pairs.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Results */}
            {selectedLanguages.length >= 2 && matrixResult && (
              <div>
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'matrix' | 'list')}>
                  <div className="flex items-center justify-between mb-4">
                    <Label className="text-sm font-medium">
                      Analysis Results: {selectedLangNames}
                    </Label>
                    <TabsList>
                      <TabsTrigger value="matrix">Matrix View</TabsTrigger>
                      <TabsTrigger value="list">List View</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="matrix" className="mt-0">
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
                  </TabsContent>

                  <TabsContent value="list" className="mt-0">
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
                                return {
                                  lang1,
                                  lang2,
                                  distance,
                                };
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
                  </TabsContent>
                </Tabs>
              </div>
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
