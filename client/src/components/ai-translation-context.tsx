import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { 
  Brain,
  Sparkles,
  BookOpen,
  Globe,
  TrendingUp,
  Users,
  AlertCircle,
  RefreshCw,
  CheckCircle,
  Clock
} from "lucide-react";

interface AITranslationContextProps {
  baseWordId: string;
  baseWord: string;
  languageId: string;
  languageName: string;
  translation: string;
  isOpen: boolean;
  onClose: () => void;
}

interface TranslationContext {
  id: string;
  baseWordId: string;
  languageId: string;
  contextType: 'cultural' | 'historical' | 'semantic' | 'phonetic';
  contextDescription: string;
  aiGeneratedInsight: string;
  linguisticAnalysis: {
    semanticField: string[];
    cognates: string[];
    borrowings: string[];
    soundChanges: string[];
  };
  relatedTerms: string[];
  crossLinguisticComparisons: Array<{
    language: string;
    term: string;
    relationship: string;
  }>;
  confidence: number;
  humanVerified: boolean;
  generatedAt: string;
  updatedAt: string;
}

export default function AITranslationContext({
  baseWordId,
  baseWord,
  languageId,
  languageName,
  translation,
  isOpen,
  onClose,
}: AITranslationContextProps) {
  const [activeTab, setActiveTab] = useState('contexts');
  const [isGenerating, setIsGenerating] = useState(false);
  const queryClient = useQueryClient();

  // Fetch existing contexts
  const { data: contexts = [], isLoading, refetch } = useQuery<TranslationContext[]>({
    queryKey: [`/api/words/${baseWordId}/languages/${languageId}/contexts`],
    enabled: isOpen,
  });

  // Generate AI contexts mutation
  const generateContextsMutation = useMutation({
    mutationFn: async () => {
      setIsGenerating(true);
      try {
        const response = await apiRequest(`/api/words/${baseWordId}/languages/${languageId}/generate-contexts`, {
          method: 'POST',
          body: JSON.stringify({
            baseWord,
            translation,
            languageName,
          }),
        });
        return response;
      } finally {
        setIsGenerating(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: [`/api/words/${baseWordId}/languages/${languageId}/contexts`] 
      });
      refetch();
    },
    onError: (error: any) => {
      setIsGenerating(false);
      console.error('Error generating AI contexts:', error);
    },
  });

  const getContextTypeIcon = (type: string) => {
    const icons = {
      cultural: Users,
      historical: Clock,
      semantic: BookOpen,
      phonetic: TrendingUp,
    };
    const Icon = icons[type as keyof typeof icons] || BookOpen;
    return <Icon className="h-4 w-4" />;
  };

  const getContextTypeColor = (type: string) => {
    const colors = {
      cultural: 'bg-purple-100 text-purple-800',
      historical: 'bg-blue-100 text-blue-800',
      semantic: 'bg-green-100 text-green-800',
      phonetic: 'bg-orange-100 text-orange-800',
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const contextsByType = contexts.reduce((acc, context) => {
    if (!acc[context.contextType]) acc[context.contextType] = [];
    acc[context.contextType].push(context);
    return acc;
  }, {} as Record<string, TranslationContext[]>);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden" data-testid="dialog-ai-context">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialog-title">
            <Brain className="h-5 w-5" />
            AI Translation Context: "{baseWord}" → "{translation}" ({languageName})
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="contexts" data-testid="tab-contexts">
              AI Contexts ({contexts.length})
            </TabsTrigger>
            <TabsTrigger value="generate" data-testid="tab-generate">
              Generate New Contexts
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contexts" className="flex-1">
            <ScrollArea className="h-96">
              {isLoading ? (
                <div className="flex items-center justify-center py-8" data-testid="loading-contexts">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                    <p className="text-sm text-muted-foreground">Loading AI contexts...</p>
                  </div>
                </div>
              ) : contexts.length === 0 ? (
                <div className="text-center py-8" data-testid="empty-contexts-state">
                  <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No AI Contexts Yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate AI-powered linguistic analysis for this translation
                  </p>
                  <Button onClick={() => setActiveTab('generate')} data-testid="button-generate-first-context">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate AI Contexts
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(contextsByType).map(([type, typeContexts]) => (
                    <div key={type} className="space-y-3">
                      <div className="flex items-center gap-2">
                        {getContextTypeIcon(type)}
                        <h3 className="text-lg font-medium capitalize">{type} Analysis</h3>
                        <Badge className={getContextTypeColor(type)}>
                          {typeContexts.length} context{typeContexts.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      
                      {typeContexts.map((context) => (
                        <Card key={context.id} className="border-l-4 border-l-primary" data-testid={`context-${context.id}`}>
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  {context.humanVerified ? (
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <Sparkles className="h-4 w-4 text-blue-600" />
                                  )}
                                  <span className="text-sm font-medium">
                                    {context.humanVerified ? 'Human Verified' : 'AI Generated'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Progress 
                                  value={context.confidence} 
                                  className="w-16 h-2"
                                  data-testid={`confidence-${context.id}`}
                                />
                                <span className="text-xs text-muted-foreground">{context.confidence}%</span>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0 space-y-4">
                            <div>
                              <h4 className="text-sm font-medium mb-2 text-foreground">Context Description</h4>
                              <p className="text-sm text-muted-foreground">{context.contextDescription}</p>
                            </div>

                            <div>
                              <h4 className="text-sm font-medium mb-2 text-foreground">AI Linguistic Insight</h4>
                              <p className="text-sm text-muted-foreground">{context.aiGeneratedInsight}</p>
                            </div>

                            <Separator />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {context.linguisticAnalysis.semanticField.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                    <Globe className="h-3 w-3" />
                                    Semantic Field
                                  </h4>
                                  <div className="flex flex-wrap gap-1">
                                    {context.linguisticAnalysis.semanticField.map((field, idx) => (
                                      <Badge key={idx} variant="outline" className="text-xs">
                                        {field}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {context.linguisticAnalysis.cognates.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                    Related Cognates
                                  </h4>
                                  <div className="flex flex-wrap gap-1">
                                    {context.linguisticAnalysis.cognates.map((cognate, idx) => (
                                      <Badge key={idx} variant="outline" className="text-xs">
                                        {cognate}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {context.relatedTerms.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                  Related Terms
                                </h4>
                                <div className="flex flex-wrap gap-1">
                                  {context.relatedTerms.map((term, idx) => (
                                    <Badge key={idx} variant="secondary" className="text-xs">
                                      {term}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {context.crossLinguisticComparisons.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                                  Cross-Linguistic Comparisons
                                </h4>
                                <div className="space-y-2">
                                  {context.crossLinguisticComparisons.map((comparison, idx) => (
                                    <div key={idx} className="flex items-center gap-2 text-xs">
                                      <Badge variant="outline">{comparison.language}</Badge>
                                      <span>{comparison.term}</span>
                                      <span className="text-muted-foreground">({comparison.relationship})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="text-xs text-muted-foreground">
                              Generated: {new Date(context.generatedAt).toLocaleDateString()}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="generate" className="space-y-4">
            <div className="text-center py-8 space-y-4">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <Brain className="h-8 w-8 text-primary" />
              </div>
              
              <div>
                <h3 className="text-lg font-medium mb-2">Generate AI Translation Contexts</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Use advanced AI to generate detailed linguistic analysis including cultural context, 
                  historical evolution, semantic relationships, and phonetic patterns.
                </p>
              </div>

              <Alert className="max-w-md mx-auto">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-left">
                  AI context generation requires an OpenAI API key. The analysis will include:
                  <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                    <li>Cultural and historical context</li>
                    <li>Semantic field analysis</li>
                    <li>Phonetic evolution patterns</li>
                    <li>Cross-linguistic comparisons</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <Button
                  onClick={() => generateContextsMutation.mutate()}
                  disabled={isGenerating}
                  size="lg"
                  className="w-full max-w-xs"
                  data-testid="button-generate-contexts"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Generating AI Contexts...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate AI Contexts
                    </>
                  )}
                </Button>

                {generateContextsMutation.error && (
                  <Alert variant="destructive" className="max-w-md mx-auto">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {(generateContextsMutation.error as any)?.message || 'Failed to generate AI contexts'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {contexts.length > 0 && (
                <div className="pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab('contexts')}
                    data-testid="button-view-existing-contexts"
                  >
                    View Existing Contexts ({contexts.length})
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}