import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { X, Plus, GitCompare, Download } from "lucide-react";
import type { Language, WordComparison } from "@shared/schema";

interface WordComparisonProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WordComparisonPanel({ isOpen, onClose }: WordComparisonProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);

  const { data: allLanguages = [] } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
  });

  const { data: comparisons = [], isLoading } = useQuery<WordComparison[]>({
    queryKey: ['/api/word-comparisons', selectedLanguages],
    enabled: selectedLanguages.length >= 2,
  });

  const addLanguage = (languageId: string) => {
    if (languageId && !selectedLanguages.includes(languageId)) {
      setSelectedLanguages([...selectedLanguages, languageId]);
    }
  };

  const removeLanguage = (languageId: string) => {
    setSelectedLanguages(selectedLanguages.filter(id => id !== languageId));
  };

  const filteredComparisons = showOnlyDifferences 
    ? comparisons.filter(comp => {
        const translations = comp.translations.map(t => t.translation?.translation || null);
        return new Set(translations).size > 1; // More than one unique translation
      })
    : comparisons;

  const availableLanguages = allLanguages.filter(lang => 
    !selectedLanguages.includes(lang.id) && !lang.isHistoricalVariant
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-material-3 w-full max-w-7xl max-h-[90vh] m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <GitCompare className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-medium text-gray-900" data-testid="text-comparison-title">
              Word List Comparison
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            data-testid="button-close-comparison"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6">
          {/* Language Selection */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Select Languages to Compare</h3>
              <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showOnlyDifferences}
                    onChange={(e) => setShowOnlyDifferences(e.target.checked)}
                    className="rounded border-gray-300"
                    data-testid="checkbox-show-differences"
                  />
                  <span className="text-sm text-gray-600">Show only differences</span>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:bg-blue-50"
                  data-testid="button-export-comparison"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
              {selectedLanguages.map(langId => {
                const language = allLanguages.find(l => l.id === langId);
                if (!language) return null;
                
                return (
                  <Badge
                    key={langId}
                    className="bg-primary text-white px-3 py-1 text-sm flex items-center space-x-2"
                    data-testid={`badge-selected-${language.name.toLowerCase()}`}
                  >
                    <span>{language.name}</span>
                    <button
                      onClick={() => removeLanguage(langId)}
                      className="ml-2 hover:bg-primary-dark rounded"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              
              {selectedLanguages.length < 6 && (
                <Select onValueChange={addLanguage}>
                  <SelectTrigger className="w-48" data-testid="select-add-language">
                    <SelectValue placeholder="Add language..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLanguages.map(language => (
                      <SelectItem key={language.id} value={language.id}>
                        {language.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedLanguages.length < 2 && (
              <p className="text-sm text-gray-500 italic">
                Select at least 2 languages to start comparing word lists.
              </p>
            )}
          </div>

          {/* Comparison Table */}
          {selectedLanguages.length >= 2 && (
            <div className="overflow-auto max-h-96">
              {isLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                  <p className="text-gray-600 mt-4">Loading word comparisons...</p>
                </div>
              ) : (
                <table className="w-full border-collapse" data-testid="table-word-comparison">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left p-3 font-medium text-gray-900 sticky left-0 bg-gray-50 z-10">
                        English Word
                      </th>
                      {selectedLanguages.map(langId => {
                        const language = allLanguages.find(l => l.id === langId);
                        return (
                          <th key={langId} className="text-left p-3 font-medium text-gray-900 min-w-32">
                            {language?.name}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredComparisons.slice(0, 50).map((comparison, index) => (
                      <tr 
                        key={comparison.baseWord.id} 
                        className={`border-b border-gray-100 hover:bg-gray-50 ${
                          index % 2 === 0 ? 'bg-white' : 'bg-gray-25'
                        }`}
                        data-testid={`row-word-${comparison.baseWord.position}`}
                      >
                        <td className="p-3 font-medium text-gray-900 sticky left-0 bg-inherit z-10">
                          <div>
                            <span>{comparison.baseWord.word}</span>
                            {comparison.baseWord.definition && (
                              <p className="text-xs text-gray-500 mt-1">
                                {comparison.baseWord.definition}
                              </p>
                            )}
                          </div>
                        </td>
                        {comparison.translations.map(({ language, translation }) => (
                          <td key={language.id} className="p-3">
                            {translation?.translation ? (
                              <div>
                                <span className="text-gray-900">{translation.translation}</span>
                                {translation.pronunciation && (
                                  <p className="text-xs text-gray-500 mt-1">
                                    /{translation.pronunciation}/
                                  </p>
                                )}
                                {translation.source && (
                                  <p className="text-xs text-blue-600 mt-1">
                                    via {translation.source}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              
              {filteredComparisons.length > 50 && (
                <div className="p-4 text-center border-t border-gray-200 bg-gray-50">
                  <p className="text-sm text-gray-600">
                    Showing first 50 of {filteredComparisons.length} words
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-primary hover:bg-blue-50"
                    data-testid="button-load-more"
                  >
                    Load More
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}