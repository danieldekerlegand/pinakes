import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import VisualizationRecommendations from "@/components/VisualizationRecommendations";
import {
  Languages,
  GitCompare,
  Download,
  RefreshCw,
  Minus,
  Search,
  X
} from "lucide-react";
import type { Language, WordComparison } from "@shared/types";

interface WordComparisonPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WordComparisonPanel({ isOpen, onClose }: WordComparisonPanelProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch available languages
  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
  });

  // Fetch word comparisons when languages are selected
  const { data: comparisons, isLoading: isLoadingComparisons, refetch } = useQuery<WordComparison[]>({
    queryKey: ['/api/word-comparisons', selectedLanguages],
    enabled: selectedLanguages.length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams();
      selectedLanguages.forEach(id => params.append('languages', id));
      const response = await fetch(`/api/word-comparisons?${params}`);
      if (!response.ok) throw new Error('Failed to fetch comparisons');
      return response.json();
    }
  });

  // Filter languages based on search term
  const filteredLanguages = useMemo(() => {
    return languages.filter(lang =>
      lang.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lang.nativeName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lang.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [languages, searchTerm]);

  // Toggle language selection
  const toggleLanguage = (languageId: string) => {
    setSelectedLanguages(prev => {
      const newSelection = prev.includes(languageId)
        ? prev.filter(id => id !== languageId)
        : [...prev, languageId];
      return newSelection;
    });
  };

  // Export comparison data as CSV
  const exportToCSV = () => {
    if (!comparisons) return;

    const selectedLangs = languages.filter(lang => selectedLanguages.includes(lang.id));
    const csvHeaders = [
      'English',
      ...selectedLangs.flatMap(lang => [lang.name, `${lang.name} IPA`])
    ];
    const csvRows = comparisons.map(comp => {
      const row = [comp.baseWord];
      selectedLangs.forEach(lang => {
        const translation = comp.translations[lang.id];
        if (translation && typeof translation === 'object') {
          row.push(translation.form || '');
          row.push(translation.ipa || '');
        } else {
          row.push(translation || '');
          row.push('');
        }
      });
      return row;
    });

    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `language-comparison-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedLangNames = languages
    .filter(lang => selectedLanguages.includes(lang.id))
    .map(lang => lang.name)
    .join(", ");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-[900px] max-w-[90vw] bg-white dark:bg-gray-900 shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center">
                <Languages className="h-5 w-5 mr-2" />
                Language Comparison
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Compare word lists across languages from NorthEuraLex data
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

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Language Selection */}
            <div>
              <Label className="text-sm font-medium mb-3 block">Select Languages to Compare</Label>

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
                          checked={selectedLanguages.includes(language.id) ? true : false}
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
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{language.id}</div>
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
                    <Label className="text-sm">Selected Languages ({selectedLanguages.length})</Label>
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
                          onClick={() => toggleLanguage(langId)}
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

            {/* Comparison Actions */}
            {selectedLanguages.length >= 2 && (
              <div className="flex items-center space-x-2">
                <Button
                  onClick={() => refetch()}
                  disabled={isLoadingComparisons}
                  className="flex-1"
                >
                  {isLoadingComparisons ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <GitCompare className="h-4 w-4 mr-2" />
                  )}
                  Compare Languages
                </Button>
                {comparisons && comparisons.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={exportToCSV}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                )}
              </div>
            )}

            {/* Comparison Results */}
            {selectedLanguages.length >= 2 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <Label className="text-sm font-medium">
                    Comparison Results: {selectedLangNames}
                  </Label>
                  {comparisons && <Badge variant="outline">{comparisons.length} words</Badge>}
                </div>

                {isLoadingComparisons ? (
                  <div className="flex items-center justify-center p-8">
                    <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                    <span>Loading comparisons...</span>
                  </div>
                ) : comparisons && comparisons.length > 0 ? (
                  <ScrollArea className="h-96 border rounded-lg">
                    <div className="p-4">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-2 font-medium sticky left-0 bg-white dark:bg-gray-900">English</th>
                              {languages
                                .filter(lang => selectedLanguages.includes(lang.id))
                                .flatMap(lang => [
                                  <th key={`${lang.id}-form`} className="text-left p-2 font-medium">
                                    {lang.name}
                                  </th>,
                                  <th key={`${lang.id}-ipa`} className="text-left p-2 font-medium text-xs">
                                    IPA
                                  </th>
                                ])}
                            </tr>
                          </thead>
                          <tbody>
                            {comparisons.map((comparison, index) => (
                              <tr key={comparison.conceptId || index} className={index % 2 === 0 ? "bg-gray-50 dark:bg-gray-800/50" : ""}>
                                <td className="p-2 font-medium sticky left-0 bg-inherit">{comparison.baseWord}</td>
                                {languages
                                  .filter(lang => selectedLanguages.includes(lang.id))
                                  .flatMap(lang => {
                                    const translation = comparison.translations[lang.id];
                                    const form = translation && typeof translation === 'object' ? translation.form : translation;
                                    const ipa = translation && typeof translation === 'object' ? translation.ipa : null;

                                    return [
                                      <td key={`${lang.id}-form`} className="p-2">
                                        {form ? (
                                          <span className="text-gray-900 dark:text-gray-100">{form}</span>
                                        ) : (
                                          <span className="text-gray-400 dark:text-gray-600 italic">—</span>
                                        )}
                                      </td>,
                                      <td key={`${lang.id}-ipa`} className="p-2">
                                        {ipa ? (
                                          <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">{ipa}</span>
                                        ) : (
                                          <span className="text-gray-400 dark:text-gray-600 italic">—</span>
                                        )}
                                      </td>
                                    ];
                                  })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </ScrollArea>
                ) : (
                  <Card className="p-8 text-center">
                    <GitCompare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-gray-400">No comparison data available for selected languages.</p>
                  </Card>
                )}
              </div>
            )}

            {selectedLanguages.length < 2 && (
              <Card className="p-8 text-center">
                <Languages className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">Select at least 2 languages to start comparing</p>
              </Card>
            )}

            <VisualizationRecommendations panelType="word-comparison" onClose={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
