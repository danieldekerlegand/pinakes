import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Languages, 
  GitCompare, 
  Download, 
  RefreshCw, 
  Plus, 
  Minus, 
  Globe,
  Search,
  Zap,
  Users,
  Clock,
  X
} from "lucide-react";
import type { Language, WordComparison } from "@shared/schema";

interface WordComparisonPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Preset comparison sets for one-click comparison
const COMPARISON_PRESETS = [
  {
    id: "germanic-major",
    name: "Major Germanic Languages",
    description: "English, German, Dutch",
    languageIds: ["lang1", "lang2", "lang10"],
    icon: Languages
  },
  {
    id: "english-variants",
    name: "English Historical Timeline",
    description: "Old → Middle → Early Modern → Modern English",
    languageIds: ["lang3", "lang4", "lang5", "lang9"],
    icon: Clock
  },
  {
    id: "english-dialects",
    name: "Modern English Dialects",
    description: "American, British, Australian English",
    languageIds: ["lang6", "lang7", "lang8"],
    icon: Users
  },
  {
    id: "scandinavian",
    name: "Scandinavian Languages",
    description: "Swedish, Norwegian, Danish",
    languageIds: ["lang11", "lang12", "lang13"],
    icon: Globe
  }
];

export default function WordComparisonPanel({ isOpen, onClose }: WordComparisonPanelProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isComparing, setIsComparing] = useState(false);

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
      lang.nativeName?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [languages, searchTerm]);

  // One-click preset comparison
  const handlePresetComparison = (preset: typeof COMPARISON_PRESETS[0]) => {
    setSelectedLanguages(preset.languageIds);
    setIsComparing(true);
  };

  // Toggle language selection
  const toggleLanguage = (languageId: string) => {
    setSelectedLanguages(prev => 
      prev.includes(languageId) 
        ? prev.filter(id => id !== languageId)
        : [...prev, languageId]
    );
  };

  // Export comparison data as CSV
  const exportToCSV = () => {
    if (!comparisons) return;
    
    const selectedLangs = languages.filter(lang => selectedLanguages.includes(lang.id));
    const csvHeaders = ['Word', ...selectedLangs.map(lang => lang.name)];
    const csvRows = comparisons.map(comp => [
      comp.baseWord.word,
      ...selectedLangs.map(lang => {
        const translation = comp.translations.find(t => t.language.id === lang.id);
        return translation?.translation?.translation || '';
      })
    ]);
    
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

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
          <div 
            className="fixed right-0 top-0 h-full w-[800px] max-w-[90vw] bg-white shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-shrink-0 border-b border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <Languages className="h-5 w-5 mr-2" />
                    One-Click Language Comparison
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Compare word lists across languages using preset combinations or custom selections.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
          {/* Quick Comparison Presets */}
          <div>
            <Label className="text-sm font-medium mb-3 block flex items-center space-x-2">
              <Zap className="h-4 w-4" />
              <span>Quick Comparisons</span>
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {COMPARISON_PRESETS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <Card 
                    key={preset.id}
                    className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-blue-200"
                    onClick={() => handlePresetComparison(preset)}
                    data-testid={`preset-${preset.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start space-x-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <Icon className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm">{preset.name}</h4>
                          <p className="text-xs text-gray-500 mt-1">{preset.description}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Custom Language Selection */}
          <div>
            <Label className="text-sm font-medium mb-3 block">Custom Selection</Label>
            
            {/* Search Languages */}
            <div className="relative mb-4">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <Input
                placeholder="Search languages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-languages"
              />
            </div>

            {/* Language Selection Grid */}
            <div className="h-48 border rounded-lg overflow-hidden">
              <ScrollArea className="h-full p-4">
                <div className="grid grid-cols-2 gap-2">
                {filteredLanguages.map((language) => (
                  <div
                    key={language.id}
                    className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    onClick={() => toggleLanguage(language.id)}
                    data-testid={`language-${language.id}`}
                  >
                    <Checkbox
                      checked={selectedLanguages.includes(language.id)}
                      onChange={() => toggleLanguage(language.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{language.name}</div>
                      {language.nativeName && language.nativeName !== language.name && (
                        <div className="text-xs text-gray-500 truncate">{language.nativeName}</div>
                      )}
                    </div>
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
                    data-testid="button-clear-selection"
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
                        className="cursor-pointer hover:bg-red-100"
                        onClick={() => toggleLanguage(langId)}
                        data-testid={`badge-${langId}`}
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
                onClick={() => {
                  setIsComparing(true);
                  refetch();
                }}
                disabled={isLoadingComparisons}
                className="flex-1"
                data-testid="button-compare"
              >
                {isLoadingComparisons ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <GitCompare className="h-4 w-4 mr-2" />
                )}
                Compare Languages
              </Button>
              {comparisons && (
                <Button
                  variant="outline"
                  onClick={exportToCSV}
                  data-testid="button-export"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              )}
            </div>
          )}

          {/* Comparison Results */}
          {isComparing && selectedLanguages.length >= 2 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <Label className="text-sm font-medium">
                  Comparison Results: {selectedLangNames}
                </Label>
                <Badge variant="outline">{comparisons?.length || 0} words</Badge>
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
                            <th className="text-left p-2 font-medium">Word</th>
                            {languages
                              .filter(lang => selectedLanguages.includes(lang.id))
                              .map(lang => (
                                <th key={lang.id} className="text-left p-2 font-medium">
                                  {lang.name}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody>
                          {comparisons.map((comparison, index) => (
                            <tr key={comparison.baseWord.id} className={index % 2 === 0 ? "bg-gray-50" : ""}>
                              <td className="p-2 font-medium">{comparison.baseWord.word}</td>
                              {languages
                                .filter(lang => selectedLanguages.includes(lang.id))
                                .map(lang => {
                                  const translation = comparison.translations.find(t => t.language.id === lang.id);
                                  return (
                                    <td key={lang.id} className="p-2">
                                      {translation?.translation?.translation ? (
                                        <span className="text-gray-900">{translation.translation.translation}</span>
                                      ) : (
                                        <span className="text-gray-400 italic">No translation</span>
                                      )}
                                    </td>
                                  );
                                })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="text-center p-8">
                  <GitCompare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No comparison data available for selected languages.</p>
                </div>
              )}
            </div>
          )}

          {selectedLanguages.length < 2 && (
            <div className="text-center p-8">
              <Languages className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Select at least 2 languages to start comparing</p>
            </div>
          )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}