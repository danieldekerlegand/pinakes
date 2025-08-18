import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Database, 
  TestTube, 
  Info,
  BookOpen,
  Globe,
  Users,
  TrendingUp,
  RefreshCw
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface LinguisticServiceStatus {
  wiktionary: {
    requestsToday: number;
    cacheSize: number;
    lastRequest: number | null;
  };
  merriamWebster: {
    requestsToday: number;
    cacheSize: number;
    lastRequest: number | null;
    apiKeyConfigured: boolean;
  };
  freeDictionary: {
    requestsToday: number;
    lastRequest: number | null;
  };
}

interface TranslationTestResult {
  success: boolean;
  data?: {
    word: string;
    language: string;
    translation: string;
    pronunciation?: string;
    partOfSpeech?: string;
    definition?: string;
    etymology?: string;
    source: string;
    confidence: number;
    phoneticTranscription?: string;
    alternativeTranslations?: string[];
  };
  error?: string;
}

interface LinguisticDatabasePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LinguisticDatabasePanel({ isOpen, onClose }: LinguisticDatabasePanelProps) {
  const [testWord, setTestWord] = useState("hello");
  const [testFromLang, setTestFromLang] = useState("en");
  const [testToLang, setTestToLang] = useState("de");
  const [testResult, setTestResult] = useState<TranslationTestResult | null>(null);

  // Fetch service status
  const { data: serviceStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery<LinguisticServiceStatus>({
    queryKey: ['/api/linguistic-services/status'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Test translation mutation
  const testTranslation = useMutation({
    mutationFn: async (params: { word: string; fromLang: string; toLang: string }) => {
      const response = await fetch('/api/linguistic-services/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      
      if (!response.ok) {
        throw new Error('Request failed');
      }
      
      return await response.json();
    },
    onSuccess: (data: TranslationTestResult) => {
      setTestResult(data);
    },
    onError: (error) => {
      console.error('Translation test error:', error);
      setTestResult({ success: false, error: 'Test request failed' });
    }
  });

  const handleTestTranslation = () => {
    testTranslation.mutate({
      word: testWord,
      fromLang: testFromLang,
      toLang: testToLang,
    });
  };

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleTimeString();
  };

  const getServiceStatusIcon = (requests: number, configured?: boolean) => {
    if (configured === false) {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
    if (requests > 0) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    return <Clock className="h-4 w-4 text-yellow-500" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Professional Linguistic Databases
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6" data-testid="linguistic-database-panel">
          <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <CardTitle>Professional Linguistic Databases</CardTitle>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetchStatus()}
              disabled={statusLoading}
              data-testid="button-refresh-status"
            >
              <RefreshCw className={`h-4 w-4 ${statusLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <CardDescription>
            Integration with professional linguistic APIs for authentic translation data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="status" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="status" data-testid="tab-status">Service Status</TabsTrigger>
              <TabsTrigger value="test" data-testid="tab-test">API Testing</TabsTrigger>
              <TabsTrigger value="info" data-testid="tab-info">Database Info</TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                {/* Wiktionary Status */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">Wiktionary API</CardTitle>
                      {serviceStatus && getServiceStatusIcon(serviceStatus.wiktionary.requestsToday)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Requests Today:</span>
                      <span className="font-medium">{serviceStatus?.wiktionary.requestsToday || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cache Size:</span>
                      <span className="font-medium">{serviceStatus?.wiktionary.cacheSize || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Last Request:</span>
                      <span className="font-medium text-xs">
                        {formatTimestamp(serviceStatus?.wiktionary.lastRequest || null)}
                      </span>
                    </div>
                    <Badge variant="secondary" className="w-full justify-center">
                      Free • Multilingual
                    </Badge>
                  </CardContent>
                </Card>

                {/* Merriam-Webster Status */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">Merriam-Webster</CardTitle>
                      {serviceStatus && getServiceStatusIcon(
                        serviceStatus.merriamWebster.requestsToday,
                        serviceStatus.merriamWebster.apiKeyConfigured
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Requests Today:</span>
                      <span className="font-medium">{serviceStatus?.merriamWebster.requestsToday || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cache Size:</span>
                      <span className="font-medium">{serviceStatus?.merriamWebster.cacheSize || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">API Key:</span>
                      <Badge variant={serviceStatus?.merriamWebster.apiKeyConfigured ? "default" : "destructive"}>
                        {serviceStatus?.merriamWebster.apiKeyConfigured ? "Configured" : "Missing"}
                      </Badge>
                    </div>
                    <Badge variant="secondary" className="w-full justify-center">
                      Professional • English
                    </Badge>
                  </CardContent>
                </Card>

                {/* Free Dictionary Status */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">Free Dictionary</CardTitle>
                      {serviceStatus && getServiceStatusIcon(serviceStatus.freeDictionary.requestsToday)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Requests Today:</span>
                      <span className="font-medium">{serviceStatus?.freeDictionary.requestsToday || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Last Request:</span>
                      <span className="font-medium text-xs">
                        {formatTimestamp(serviceStatus?.freeDictionary.lastRequest || null)}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      No key required
                    </div>
                    <Badge variant="secondary" className="w-full justify-center">
                      Open Source • English
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              {!serviceStatus?.merriamWebster.apiKeyConfigured && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    To unlock professional dictionary features, add your Merriam-Webster API key to environment variables.
                    Get a free key at: https://dictionaryapi.com/
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="test" className="space-y-4">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <label className="text-sm font-medium">Test Word</label>
                    <Input
                      value={testWord}
                      onChange={(e) => setTestWord(e.target.value)}
                      placeholder="Enter word..."
                      data-testid="input-test-word"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">From Language</label>
                    <Select value={testFromLang} onValueChange={setTestFromLang}>
                      <SelectTrigger data-testid="select-from-lang">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="de">German</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">To Language</label>
                    <Select value={testToLang} onValueChange={setTestToLang}>
                      <SelectTrigger data-testid="select-to-lang">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="de">German</SelectItem>
                        <SelectItem value="nl">Dutch</SelectItem>
                        <SelectItem value="sv">Swedish</SelectItem>
                        <SelectItem value="no">Norwegian</SelectItem>
                        <SelectItem value="da">Danish</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button 
                      onClick={handleTestTranslation}
                      disabled={testTranslation.isPending}
                      className="w-full"
                      data-testid="button-test-translation"
                    >
                      <TestTube className="h-4 w-4 mr-2" />
                      {testTranslation.isPending ? 'Testing...' : 'Test API'}
                    </Button>
                  </div>
                </div>

                {testResult && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        Translation Result
                        {testResult.success ? 
                          <CheckCircle className="h-4 w-4 text-green-500" /> : 
                          <XCircle className="h-4 w-4 text-red-500" />
                        }
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {testResult.success && testResult.data ? (
                        <div className="space-y-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <span className="text-sm font-medium text-muted-foreground">Translation:</span>
                              <p className="text-lg font-semibold">{testResult.data.translation}</p>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-muted-foreground">Source:</span>
                              <Badge variant="outline">{testResult.data.source}</Badge>
                            </div>
                          </div>
                          
                          {testResult.data.pronunciation && (
                            <div>
                              <span className="text-sm font-medium text-muted-foreground">Pronunciation:</span>
                              <p className="font-mono">{testResult.data.pronunciation}</p>
                            </div>
                          )}
                          
                          {testResult.data.definition && (
                            <div>
                              <span className="text-sm font-medium text-muted-foreground">Definition:</span>
                              <p className="text-sm">{testResult.data.definition}</p>
                            </div>
                          )}
                          
                          <div className="flex items-center gap-4 pt-2">
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">Confidence: {Math.round(testResult.data.confidence * 100)}%</span>
                            </div>
                            {testResult.data.partOfSpeech && (
                              <Badge variant="secondary">{testResult.data.partOfSpeech}</Badge>
                            )}
                          </div>
                        </div>
                      ) : (
                        <Alert variant="destructive">
                          <XCircle className="h-4 w-4" />
                          <AlertDescription>
                            {testResult.error || 'Translation failed'}
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="info" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BookOpen className="h-4 w-4" />
                      Wiktionary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><strong>Type:</strong> Collaborative multilingual dictionary</p>
                    <p><strong>Languages:</strong> 280+ languages supported</p>
                    <p><strong>Features:</strong> Definitions, translations, etymologies, pronunciations</p>
                    <p><strong>Rate Limit:</strong> 100 requests/minute</p>
                    <p><strong>Cost:</strong> Free</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Globe className="h-4 w-4" />
                      Merriam-Webster
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><strong>Type:</strong> Professional English dictionary</p>
                    <p><strong>Languages:</strong> English (authoritative)</p>
                    <p><strong>Features:</strong> Definitions, etymologies, audio pronunciations</p>
                    <p><strong>Rate Limit:</strong> 1,000 requests/day</p>
                    <p><strong>Cost:</strong> Free tier available</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="h-4 w-4" />
                      Free Dictionary API
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><strong>Type:</strong> Open-source dictionary</p>
                    <p><strong>Languages:</strong> English</p>
                    <p><strong>Features:</strong> Definitions, phonetics, examples</p>
                    <p><strong>Rate Limit:</strong> 100 requests/minute</p>
                    <p><strong>Cost:</strong> Completely free</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Database className="h-4 w-4" />
                      Integration Benefits
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><strong>Authenticity:</strong> Real linguistic data from verified sources</p>
                    <p><strong>Quality:</strong> Professional dictionary standards</p>
                    <p><strong>Coverage:</strong> Multiple language families supported</p>
                    <p><strong>Reliability:</strong> Fallback mechanisms ensure continuous operation</p>
                    <p><strong>Caching:</strong> Optimized for performance with intelligent caching</p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
      </DialogContent>
    </Dialog>
  );
}