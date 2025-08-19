import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Search, 
  GitBranch, 
  Clock, 
  Globe, 
  ArrowRightLeft, 
  BookOpen, 
  Network,
  ArrowRight,
  MapPin,
  Calendar,
  Users,
  Loader2
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EtymologyPath {
  language: string;
  form: string;
  meaning: string;
  timeperiod: string;
  notes?: string;
}

interface Cognate {
  language: string;
  form: string;
  meaning: string;
  relationship: string;
}

interface PhoneticChange {
  timeperiod: string;
  oldForm: string;
  newForm: string;
  soundLaw: string;
  environment?: string;
}

interface SemanticShift {
  timeperiod: string;
  oldMeaning: string;
  newMeaning: string;
  mechanism: string;
}

interface WordMigration {
  sourceForm: string;
  targetForm: string;
  migrationPeriod: string;
  migrationMechanism: string;
  historicalContext?: string;
  geographicRoute: Array<{
    region: string;
    coordinates?: { lat: number; lng: number };
    role: string;
  }>;
  culturalImpact?: string;
  confidence: number;
}

interface Etymology {
  id: string;
  originalForm: string;
  currentForm: string;
  etymologyPath: EtymologyPath[];
  cognates: Cognate[];
  phoneticChanges: PhoneticChange[];
  semanticShifts: SemanticShift[];
  firstAttestation?: string;
  attestationSource?: string;
  etymologyConfidence: number;
  scholarlyNotes?: string;
  sources: string[];
  verified: boolean;
}

interface EtymologyExplorerProps {
  baseWordId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function EtymologyExplorer({ baseWordId, isOpen, onClose }: EtymologyExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWordId, setSelectedWordId] = useState(baseWordId || "");
  const [isGeneratingData, setIsGeneratingData] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const { toast } = useToast();

  // Fetch etymology data for selected word
  const { data: etymology, isLoading: etymologyLoading } = useQuery<Etymology>({
    queryKey: ['/api/etymology', selectedWordId],
    enabled: !!selectedWordId,
  });

  // Fetch word migrations
  const { data: migrations = [], isLoading: migrationsLoading } = useQuery<WordMigration[]>({
    queryKey: ['/api/word-migrations', etymology?.id],
    enabled: !!etymology?.id,
  });

  // Search etymologies
  const { data: searchResults = [], isLoading: searchLoading } = useQuery<Etymology[]>({
    queryKey: ['/api/search-etymologies', searchQuery],
    enabled: !!searchQuery && searchQuery.length > 2,
  });

  const generateEtymologyData = async () => {
    setIsGeneratingData(true);
    setGenerationProgress(0);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setGenerationProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 15;
        });
      }, 1000);

      const response = await fetch("/api/generate-etymology-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);

      toast({
        title: "Etymology Data Generated",
        description: "Successfully generated comprehensive etymology data for Indo-European, Latin, Germanic, and French borrowings with historical migration tracking.",
      });

      // Refresh the data after generation
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate etymology data",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingData(false);
    }
  };

  const getRelationshipColor = (relationship: string) => {
    switch (relationship) {
      case "cognate": return "bg-blue-100 text-blue-800";
      case "direct_descendant": return "bg-green-100 text-green-800";
      case "borrowing": return "bg-orange-100 text-orange-800";
      case "false_friend": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "bg-green-500";
    if (confidence >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Contextual Etymology Explorer</h2>
              <p className="text-gray-600">Trace historical word migration and etymological connections</p>
            </div>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>

          {/* Data Generation Section */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                Etymology Data Management
              </CardTitle>
              <CardDescription>
                Generate comprehensive etymology data with historical migration tracking
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isGeneratingData && (
                <div className="space-y-3 mb-4">
                  <div className="text-sm font-medium">Generating etymology data...</div>
                  <Progress value={generationProgress} className="w-full" />
                  <div className="text-xs text-muted-foreground">
                    Creating Indo-European etymologies, Latin borrowings, Germanic developments, and migration routes...
                  </div>
                </div>
              )}

              <Button 
                onClick={generateEtymologyData}
                disabled={isGeneratingData}
                className="w-full"
                data-testid="button-generate-etymology"
              >
                {isGeneratingData ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Etymology Data...
                  </>
                ) : (
                  <>
                    <Network className="mr-2 h-4 w-4" />
                    Generate Etymology Data
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Search Section */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Etymology Search
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="Search for word etymologies (e.g., water, mother, animal)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1"
                  data-testid="input-etymology-search"
                />
                <Button disabled={searchLoading}>
                  {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>

              {searchResults.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="font-medium">Search Results:</h4>
                  {searchResults.map((result) => (
                    <div 
                      key={result.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedWordId(result.id)}
                      data-testid={`result-etymology-${result.id}`}
                    >
                      <div>
                        <div className="font-medium">{result.currentForm}</div>
                        <div className="text-sm text-gray-600">from {result.originalForm}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getConfidenceColor(result.etymologyConfidence)}>
                          {result.etymologyConfidence}% confidence
                        </Badge>
                        {result.verified && (
                          <Badge variant="outline" className="text-green-600">Verified</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Etymology Details */}
          {etymology && (
            <Tabs defaultValue="evolution" className="space-y-4">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="evolution">Evolution Path</TabsTrigger>
                <TabsTrigger value="cognates">Cognates</TabsTrigger>
                <TabsTrigger value="phonetic">Sound Changes</TabsTrigger>
                <TabsTrigger value="semantic">Meaning Changes</TabsTrigger>
                <TabsTrigger value="migrations">Migrations</TabsTrigger>
              </TabsList>

              <TabsContent value="evolution">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Historical Evolution Path
                    </CardTitle>
                    <CardDescription>
                      {etymology.originalForm} → {etymology.currentForm}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {etymology.etymologyPath.map((step, index) => (
                        <div key={index} className="flex items-center gap-4">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-sm font-medium">
                              {index + 1}
                            </div>
                          </div>
                          <div className="flex-1 border-l-2 border-gray-200 pl-4 pb-4">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-medium">{step.language}</h4>
                              <Badge variant="outline">{step.timeperiod}</Badge>
                            </div>
                            <div className="text-lg font-mono bg-gray-50 px-2 py-1 rounded">
                              {step.form}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">{step.meaning}</div>
                            {step.notes && (
                              <div className="text-sm text-blue-600 mt-2 italic">{step.notes}</div>
                            )}
                          </div>
                          {index < etymology.etymologyPath.length - 1 && (
                            <ArrowRight className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                      ))}
                    </div>

                    {etymology.firstAttestation && (
                      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-medium text-blue-900 mb-2">First Attestation</h4>
                        <div className="text-blue-800">
                          <div>Date: {etymology.firstAttestation}</div>
                          {etymology.attestationSource && (
                            <div>Source: {etymology.attestationSource}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cognates">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5" />
                      Related Words (Cognates)
                    </CardTitle>
                    <CardDescription>
                      Words from the same historical root across different languages
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {etymology.cognates.map((cognate, index) => (
                        <div key={index} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium">{cognate.language}</h4>
                            <Badge className={getRelationshipColor(cognate.relationship)}>
                              {cognate.relationship}
                            </Badge>
                          </div>
                          <div className="text-lg font-mono bg-gray-50 px-2 py-1 rounded mb-2">
                            {cognate.form}
                          </div>
                          <div className="text-sm text-gray-600">{cognate.meaning}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="phonetic">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ArrowRightLeft className="h-5 w-5" />
                      Phonetic Evolution
                    </CardTitle>
                    <CardDescription>
                      Sound changes and phonetic laws that shaped the word
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {etymology.phoneticChanges.map((change, index) => (
                        <div key={index} className="border rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Badge variant="outline">{change.timeperiod}</Badge>
                            <span className="text-sm text-gray-600">{change.soundLaw}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-center">
                              <div className="text-sm text-gray-600 mb-1">From</div>
                              <div className="font-mono bg-red-50 text-red-800 px-3 py-2 rounded">
                                {change.oldForm}
                              </div>
                            </div>
                            <ArrowRight className="h-4 w-4 text-gray-400" />
                            <div className="text-center">
                              <div className="text-sm text-gray-600 mb-1">To</div>
                              <div className="font-mono bg-green-50 text-green-800 px-3 py-2 rounded">
                                {change.newForm}
                              </div>
                            </div>
                          </div>
                          {change.environment && (
                            <div className="mt-3 text-sm text-blue-600">
                              Environment: {change.environment}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="semantic">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      Semantic Evolution
                    </CardTitle>
                    <CardDescription>
                      How the meaning of the word changed over time
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {etymology.semanticShifts.map((shift, index) => (
                        <div key={index} className="border rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Badge variant="outline">{shift.timeperiod}</Badge>
                            <span className="text-sm text-purple-600">{shift.mechanism}</span>
                          </div>
                          <div className="space-y-3">
                            <div>
                              <div className="text-sm text-gray-600 mb-1">Old Meaning</div>
                              <div className="bg-orange-50 text-orange-800 p-3 rounded">
                                {shift.oldMeaning}
                              </div>
                            </div>
                            <div className="flex justify-center">
                              <ArrowRight className="h-4 w-4 text-gray-400" />
                            </div>
                            <div>
                              <div className="text-sm text-gray-600 mb-1">New Meaning</div>
                              <div className="bg-blue-50 text-blue-800 p-3 rounded">
                                {shift.newMeaning}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="migrations">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" />
                      Historical Migrations
                    </CardTitle>
                    <CardDescription>
                      Geographic and cultural transmission of the word
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {migrationsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : migrations.length > 0 ? (
                      <div className="space-y-6">
                        {migrations.map((migration, index) => (
                          <div key={index} className="border rounded-lg p-4">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {migration.migrationPeriod}
                                </Badge>
                                <Badge className="bg-purple-100 text-purple-800">
                                  {migration.migrationMechanism}
                                </Badge>
                              </div>
                              <Badge className={getConfidenceColor(migration.confidence)}>
                                {migration.confidence}% confidence
                              </Badge>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              <div>
                                <div className="text-sm text-gray-600 mb-1">Source Form</div>
                                <div className="font-mono bg-gray-50 px-3 py-2 rounded">
                                  {migration.sourceForm}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm text-gray-600 mb-1">Target Form</div>
                                <div className="font-mono bg-gray-50 px-3 py-2 rounded">
                                  {migration.targetForm}
                                </div>
                              </div>
                            </div>

                            {migration.geographicRoute.length > 0 && (
                              <div className="mb-4">
                                <div className="text-sm text-gray-600 mb-2">Geographic Route</div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {migration.geographicRoute.map((location, locIndex) => (
                                    <div key={locIndex} className="flex items-center gap-1">
                                      <Badge 
                                        variant={location.role === 'origin' ? 'default' : location.role === 'destination' ? 'secondary' : 'outline'}
                                        className="flex items-center gap-1"
                                      >
                                        <MapPin className="h-3 w-3" />
                                        {location.region}
                                      </Badge>
                                      {locIndex < migration.geographicRoute.length - 1 && (
                                        <ArrowRight className="h-3 w-3 text-gray-400" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {migration.historicalContext && (
                              <div className="mb-3">
                                <div className="text-sm text-gray-600 mb-1">Historical Context</div>
                                <div className="text-sm bg-blue-50 text-blue-800 p-3 rounded">
                                  {migration.historicalContext}
                                </div>
                              </div>
                            )}

                            {migration.culturalImpact && (
                              <div>
                                <div className="text-sm text-gray-600 mb-1">Cultural Impact</div>
                                <div className="text-sm bg-green-50 text-green-800 p-3 rounded">
                                  {migration.culturalImpact}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        No migration data available for this word
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}

          {/* Scholarly Information */}
          {etymology && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Scholarly Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Confidence & Verification</h4>
                    <div className="flex items-center gap-2 mb-2">
                      <Progress value={etymology.etymologyConfidence} className="flex-1" />
                      <span className="text-sm font-medium">{etymology.etymologyConfidence}%</span>
                    </div>
                    {etymology.verified && (
                      <Badge className="bg-green-100 text-green-800">Scholarly Verified</Badge>
                    )}
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Sources</h4>
                    <div className="space-y-1">
                      {etymology.sources.map((source, index) => (
                        <div key={index} className="text-sm text-blue-600">
                          • {source}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {etymology.scholarlyNotes && (
                  <div className="mt-4">
                    <h4 className="font-medium mb-2">Scholarly Notes</h4>
                    <div className="text-sm bg-yellow-50 text-yellow-800 p-3 rounded">
                      {etymology.scholarlyNotes}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}