import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Eye, FolderSync, Download, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { LanguageWithStats, WordTranslation, BaseWord } from "@shared/schema";

interface LanguageDetailPanelProps {
  languageId: string;
  onClose: () => void;
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showWordList, setShowWordList] = useState(false);

  const { data: language, isLoading } = useQuery<LanguageWithStats>({
    queryKey: ['/api/languages', languageId],
  });

  const { data: translations = [] } = useQuery<WordTranslation[]>({
    queryKey: ['/api/word-translations'],
    select: (data) => data.filter((t: WordTranslation) => t.languageId === languageId),
  });

  const { data: baseWords = [] } = useQuery<BaseWord[]>({
    queryKey: ['/api/words'],
  });

  const startScrapingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/scraping-jobs', {
        languageId,
      });
    },
    onSuccess: () => {
      toast({
        title: "Scraping Started",
        description: `Word list scraping has been queued for ${language?.name}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/scraping-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/languages', languageId] });
    },
    onError: (error: any) => {
      toast({
        title: "Scraping Failed",
        description: error.message || "Failed to start scraping process.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <aside className="fixed top-0 right-0 w-96 bg-white shadow-material-2 h-screen border-l border-gray-200 z-30 overflow-y-auto">
        <div className="p-6 animate-pulse">
          <div className="flex items-center justify-between mb-6">
            <div className="h-6 bg-gray-200 rounded w-32" />
            <div className="w-6 h-6 bg-gray-200 rounded" />
          </div>
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i}>
                <div className="h-4 bg-gray-200 rounded mb-2" />
                <div className="h-8 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (!language) return null;

  const sampleTranslations = translations.slice(0, 5);
  const completionPercentage = Math.round(language.wordListCompletion || 0);

  return (
    <aside className="fixed top-0 right-0 w-96 bg-white shadow-material-2 h-screen border-l border-gray-200 z-30 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium text-gray-900" data-testid={`text-detail-title-${language.name.toLowerCase()}`}>
            {language.name}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            data-testid="button-close-panel"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-6">
          {/* Basic Information */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Basic Information</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Family:</span>
                <span className="text-sm text-gray-900" data-testid="text-classification">
                  {language.classification}
                </span>
              </div>
              {language.iso639_1 && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">ISO 639-1:</span>
                  <span className="text-sm text-gray-900 font-mono" data-testid="text-iso-code">
                    {language.iso639_1}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Status:</span>
                <Badge className={`${getStatusColor(language.status)} text-xs`} data-testid="badge-status">
                  {language.status}
                </Badge>
              </div>
            </div>
          </div>

          {/* Geographic Information */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Geographic Distribution</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Region:</span>
                <span className="text-sm text-gray-900" data-testid="text-region">
                  {language.region}
                </span>
              </div>
              {language.countries && language.countries.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Countries:</span>
                  <span className="text-sm text-gray-900" data-testid="text-countries">
                    {language.countries.length} countries
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Speaker Statistics */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Speaker Statistics (2025)</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Native Speakers:</span>
                  <span className="text-sm text-gray-900" data-testid="text-native-speakers">
                    {language.nativeSpeakers?.toLocaleString() || 'Unknown'}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full"
                    style={{
                      width: `${Math.min((language.nativeSpeakers || 0) / (language.totalSpeakers || 1) * 100, 100)}%`
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-gray-600">Total Speakers:</span>
                  <span className="text-sm text-gray-900" data-testid="text-total-speakers">
                    {language.totalSpeakers?.toLocaleString() || 'Unknown'}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-secondary h-2 rounded-full w-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Word List Status */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Word List Status</h3>
            <Card className={`border p-4 ${
              completionPercentage >= 80 ? 'bg-green-50 border-green-200' :
              completionPercentage >= 50 ? 'bg-yellow-50 border-yellow-200' :
              'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center mb-2">
                <div className={`w-3 h-3 rounded-full mr-2 ${
                  completionPercentage >= 80 ? 'bg-success' :
                  completionPercentage >= 50 ? 'bg-warning' :
                  'bg-red-500'
                }`} />
                <span className="text-sm font-medium" data-testid="text-completion-status">
                  {completionPercentage >= 80 ? 'Complete' : 
                   completionPercentage >= 50 ? 'In Progress' : 'Needs Update'}
                </span>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Completion:</span>
                  <span className="font-medium" data-testid="text-completion-percentage">
                    {completionPercentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Words Found:</span>
                  <span className="font-medium" data-testid="text-words-found">
                    {translations.filter(t => t.translation).length}
                  </span>
                </div>
                {language.lastScrapedAt && (
                  <div className="flex justify-between">
                    <span>Last Updated:</span>
                    <span className="font-medium" data-testid="text-last-updated">
                      {new Date(language.lastScrapedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Quick Actions */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Actions</h3>
            <div className="space-y-2">
              <Button
                variant="ghost"
                className="w-full justify-start text-primary hover:bg-blue-50"
                onClick={() => setShowWordList(!showWordList)}
                data-testid="button-view-word-list"
              >
                {showWordList ? <ChevronUp className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                {showWordList ? 'Hide Word List' : 'View Word List'}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-primary hover:bg-blue-50"
                onClick={() => startScrapingMutation.mutate()}
                disabled={startScrapingMutation.isPending}
                data-testid="button-refresh-word-list"
              >
                <FolderSync className={`h-4 w-4 mr-2 ${startScrapingMutation.isPending ? 'animate-spin' : ''}`} />
                {startScrapingMutation.isPending ? 'Starting...' : 'Refresh Word List'}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-primary hover:bg-blue-50"
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Historical Variants */}
          {language.historicalVariants && language.historicalVariants.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Historical Evolution</h3>
              <div className="space-y-3">
                {language.historicalVariants.map((variant: any, index: number) => (
                  <div key={variant.id} className="border-l-2 border-purple-200 pl-3 pb-2" data-testid={`variant-${index}`}>
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="text-sm font-medium text-gray-900">{variant.name}</h4>
                      <Badge className={`${getStatusColor(variant.status)} text-xs`}>
                        {variant.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 mb-1">
                      {variant.timeOrigin} - {variant.timeEnd || 'present'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {variant.region}
                    </p>
                    {variant.historicalContext && (
                      <p className="text-xs text-purple-700 mt-1 italic">
                        {variant.historicalContext}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Complete Word List */}
          {showWordList && translations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Complete Word List ({translations.length} words)
              </h3>
              <Card className="max-h-96 overflow-y-auto">
                <div className="p-4 space-y-2">
                  {translations.map((translation, index) => {
                    const baseWord = baseWords.find(w => w.id === translation.baseWordId);
                    return (
                      <div key={translation.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0" data-testid={`word-${index}`}>
                        <span className="text-sm text-gray-600 font-medium">
                          {baseWord?.word || `Word ${index + 1}`}
                        </span>
                        <span className="text-sm text-gray-900 font-semibold">
                          {translation.translation || 'N/A'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          {/* Sample Words Preview */}
          {!showWordList && sampleTranslations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Sample Words Preview</h3>
              <div className="space-y-2">
                {sampleTranslations.map((translation, index) => {
                  const baseWord = baseWords.find(w => w.id === translation.baseWordId);
                  return (
                    <div key={translation.id} className="flex justify-between items-center py-1" data-testid={`sample-word-${index}`}>
                      <span className="text-sm text-gray-600">
                        {baseWord?.word || `Word ${index + 1}`}
                      </span>
                      <span className="text-sm text-gray-900 font-medium">
                        {translation.translation || 'N/A'}
                      </span>
                    </div>
                  );
                })}
                {translations.length > 5 && (
                  <div className="text-xs text-gray-500 text-center pt-2">
                    + {translations.length - 5} more words (click "View Word List" to see all)
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </aside>
  );
}
