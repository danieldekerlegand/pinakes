import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Eye, Download, ChevronUp, ChevronDown, Sparkles, BookOpen, FlaskConical } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { LanguageWithStats } from "@shared/types";

interface SampleText {
  id: string;
  languageId: string;
  title: string;
  text: string;
  transliteration: string;
  translationEn: string;
  source: string;
  dateComposed: string;
  genre: string;
  script: string;
}

interface LanguageDetailPanelProps {
  languageId: string;
  onClose: () => void;
}

interface LanguageWord {
  baseWord: string;
  conceptId: string;
  translation: string | null;
  ipa: string | null;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'living': return 'bg-success text-white';
    case 'endangered': return 'bg-warning text-white';
    case 'moribund': return 'bg-red-600 text-white';
    case 'dead': return 'bg-gray-600 text-white';
    default: return 'bg-gray-400 text-white';
  }
}

export default function LanguageDetailPanel({ languageId, onClose }: LanguageDetailPanelProps) {
  const [showWordList, setShowWordList] = useState(false);
  const [showSampleTexts, setShowSampleTexts] = useState(false);
  const [expandedTranslations, setExpandedTranslations] = useState<Set<string>>(new Set());
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: language, isLoading } = useQuery<LanguageWithStats>({
    queryKey: ['/api/languages', languageId],
  });

  const { data: wordList = [], isLoading: isLoadingWords } = useQuery<LanguageWord[]>({
    queryKey: ['/api/languages', languageId, 'word-list'],
    queryFn: async () => {
      const response = await fetch(`/api/languages/${languageId}/word-list`);
      if (!response.ok) throw new Error('Failed to fetch word list');
      return response.json();
    },
    enabled: showWordList,
  });

  const { data: sampleTextsData, isLoading: isLoadingSampleTexts } = useQuery<{ items: SampleText[]; count: number }>({
    queryKey: ['/api/languages', languageId, 'sample-texts'],
    queryFn: async () => {
      const response = await fetch(`/api/languages/${languageId}/sample-texts`);
      if (!response.ok) throw new Error('Failed to fetch sample texts');
      return response.json();
    },
    enabled: showSampleTexts,
  });

  const sampleTexts = sampleTextsData?.items ?? [];

  const toggleTranslation = (textId: string) => {
    setExpandedTranslations(prev => {
      const next = new Set(prev);
      if (next.has(textId)) {
        next.delete(textId);
      } else {
        next.add(textId);
      }
      return next;
    });
  };

  const scrapingMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/scraping/words', {
        languageId,
        languageName: language?.name || '',
        dataSources: ['gemini'],
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scraping-jobs'] });
      toast({
        title: "Scraping Started",
        description: "Word list scraping has been started. Check the progress panel for updates.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start scraping job. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Check if language has any word translations
  const hasWordList = wordList.some(word => word.translation !== null);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
        <div
          className="fixed right-0 top-0 h-full w-96 bg-white shadow-lg flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex-shrink-0 border-b border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="h-6 bg-gray-200 rounded w-32 animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-24 mt-1 animate-pulse" />
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i}>
                  <div className="h-4 bg-gray-200 rounded mb-2" />
                  <div className="h-8 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!language) return null;

  // Calculate completion percentage based on available translations
  const wordsWithTranslation = wordList.filter(w => w.translation !== null).length;
  const completionPercentage = wordList.length > 0
    ? Math.round((wordsWithTranslation / wordList.length) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-96 bg-white dark:bg-gray-900 shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100" data-testid={`text-detail-title-${language.name.toLowerCase()}`}>
                {language.name}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {language.classification}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Basic Information */}
            <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Basic Information</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Family:</span>
                <span className="text-sm text-gray-900 dark:text-gray-100" data-testid="text-classification">
                  {language.classification}
                </span>
              </div>
              {language.iso639_1 && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">ISO 639-1:</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100 font-mono" data-testid="text-iso-code">
                    {language.iso639_1}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
                <Badge className={`${getStatusColor(language.status)} text-xs`} data-testid="badge-status">
                  {language.status}
                </Badge>
              </div>
            </div>
          </div>

          {/* Geographic Information */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Geographic Distribution</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Region:</span>
                <span className="text-sm text-gray-900 dark:text-gray-100" data-testid="text-region">
                  {language.region || 'Unknown'}
                </span>
              </div>
              {language.countries && language.countries.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Countries:</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100" data-testid="text-countries">
                    {language.countries.length} countries
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Speaker Statistics */}
          {(language.nativeSpeakers || language.totalSpeakers) && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Speaker Statistics</h3>
              <div className="space-y-3">
                {language.nativeSpeakers && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Native Speakers:</span>
                      <span className="text-sm text-gray-900 dark:text-gray-100" data-testid="text-native-speakers">
                        {language.nativeSpeakers.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{
                          width: `${Math.min((language.nativeSpeakers || 0) / (language.totalSpeakers || 1) * 100, 100)}%`
                        }}
                      />
                    </div>
                  </div>
                )}
                {language.totalSpeakers && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Total Speakers:</span>
                      <span className="text-sm text-gray-900 dark:text-gray-100" data-testid="text-total-speakers">
                        {language.totalSpeakers.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div className="bg-secondary h-2 rounded-full w-full" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Actions</h3>
            <div className="space-y-2">
              {hasWordList || showWordList ? (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  onClick={() => setShowWordList(!showWordList)}
                  data-testid="button-view-word-list"
                >
                  {showWordList ? <ChevronUp className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                  {showWordList ? 'Hide Word List' : 'View Word List'}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  onClick={() => scrapingMutation.mutate()}
                  disabled={scrapingMutation.isPending}
                  data-testid="button-scrape-word-list"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {scrapingMutation.isPending ? 'Starting Scraping...' : 'Scrape Word List'}
                </Button>
              )}
              {hasWordList && (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  data-testid="button-export-csv"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              )}
            </div>
          </div>

          {/* Historical Variants */}
          {language.historicalVariants && language.historicalVariants.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Historical Evolution</h3>
              <div className="space-y-3">
                {language.historicalVariants.map((variant: any, index: number) => (
                  <div key={variant.id} className="border-l-2 border-purple-200 pl-3 pb-2" data-testid={`variant-${index}`}>
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{variant.name}</h4>
                      <Badge className={`${getStatusColor(variant.status)} text-xs`}>
                        {variant.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                      {variant.timeOrigin} - {variant.timeEnd || 'present'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {variant.region}
                    </p>
                    {variant.historicalContext && (
                      <p className="text-xs text-purple-700 dark:text-purple-400 mt-1 italic">
                        {variant.historicalContext}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sample Texts */}
          <div>
            <Button
              variant="ghost"
              className="w-full justify-between text-sm font-medium text-gray-700 dark:text-gray-300 px-0 hover:bg-transparent"
              onClick={() => setShowSampleTexts(!showSampleTexts)}
            >
              <span className="flex items-center">
                <BookOpen className="h-4 w-4 mr-2" />
                Sample Texts
              </span>
              {showSampleTexts ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            {showSampleTexts && (
              <div className="mt-3 space-y-4">
                {isLoadingSampleTexts ? (
                  <div className="space-y-3 animate-pulse">
                    {[...Array(2)].map((_, i) => (
                      <Card key={i} className="p-4">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                        <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                      </Card>
                    ))}
                  </div>
                ) : sampleTexts.length === 0 ? (
                  <Card className="p-4">
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center italic">
                      No sample texts available for this language.
                    </p>
                  </Card>
                ) : (
                  sampleTexts.map((st) => (
                    <Card key={st.id} className="p-4">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                        {st.title}
                      </h4>
                      <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap" dir="auto">
                        {st.text}
                      </p>
                      {st.transliteration && st.transliteration.trim() && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 italic mt-2 leading-relaxed">
                          {st.transliteration}
                        </p>
                      )}
                      <div className="mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-primary px-0 h-auto py-1"
                          onClick={() => toggleTranslation(st.id)}
                        >
                          {expandedTranslations.has(st.id) ? 'Hide Translation' : 'Show Translation'}
                          {expandedTranslations.has(st.id) ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
                        </Button>
                        {expandedTranslations.has(st.id) && (
                          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 leading-relaxed border-l-2 border-primary/30 pl-3">
                            {st.translationEn}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
                        {st.source && <span>Source: {st.source}</span>}
                        {st.dateComposed && <span>· {st.dateComposed}</span>}
                        {st.genre && <Badge variant="outline" className="text-xs">{st.genre}</Badge>}
                        {st.script && <Badge variant="outline" className="text-xs">{st.script}</Badge>}
                      </div>
                      <div className="mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            const params = new URLSearchParams();
                            params.set("text", st.text);
                            params.set("language", st.languageId);
                            navigate("/text-analyzer?" + params.toString());
                          }}
                        >
                          <FlaskConical className="h-3 w-3 mr-1" />
                          Analyze Etymology
                        </Button>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Complete Word List */}
          {showWordList && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Word List
                </h3>
                <Badge variant="outline">
                  {wordsWithTranslation} / {wordList.length} words ({completionPercentage}%)
                </Badge>
              </div>

              {isLoadingWords ? (
                <Card className="p-4">
                  <div className="space-y-2 animate-pulse">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex justify-between">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <Card className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                      <tr>
                        <th className="text-left p-2 font-medium text-gray-700 dark:text-gray-300">English</th>
                        <th className="text-left p-2 font-medium text-gray-700 dark:text-gray-300">{language.name}</th>
                        <th className="text-left p-2 font-medium text-gray-700 dark:text-gray-300">IPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wordList.map((word, index) => (
                        <tr
                          key={word.conceptId}
                          className={index % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800"}
                          data-testid={`word-${index}`}
                        >
                          <td className="p-2 text-gray-600 dark:text-gray-400">
                            {word.baseWord}
                          </td>
                          <td className="p-2 text-gray-900 dark:text-gray-100 font-medium">
                            {word.translation || <span className="text-gray-400 dark:text-gray-600 italic">—</span>}
                          </td>
                          <td className="p-2 text-gray-700 dark:text-gray-300 font-mono text-xs">
                            {word.ipa || <span className="text-gray-400 dark:text-gray-600 italic">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
 }
