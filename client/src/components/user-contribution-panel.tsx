import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { 
  Users,
  Plus,
  CheckCircle,
  AlertCircle,
  Clock,
  Globe,
  MessageSquare,
  User,
  Calendar,
  Star
} from "lucide-react";

interface UserContributionPanelProps {
  baseWordId: string;
  baseWord: string;
  isOpen: boolean;
  onClose: () => void;
}

interface UserContribution {
  id: string;
  baseWordId: string;
  languageId: string;
  languageName?: string;
  contributorName: string;
  contributorEmail: string;
  contributionType: 'translation' | 'pronunciation' | 'etymology' | 'usage_note' | 'cultural_context';
  translation?: string;
  pronunciation?: string;
  etymology?: string;
  usageNote?: string;
  culturalContext?: string;
  sourceReferences: string[];
  notes?: string;
  verificationStatus: 'pending' | 'verified' | 'disputed';
  moderatorNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export default function UserContributionPanel({
  baseWordId,
  baseWord,
  isOpen,
  onClose,
}: UserContributionPanelProps) {
  const [newContribution, setNewContribution] = useState({
    languageId: '',
    contributorName: '',
    contributorEmail: '',
    contributionType: 'translation' as const,
    translation: '',
    pronunciation: '',
    etymology: '',
    usageNote: '',
    culturalContext: '',
    sourceReferences: [''],
    notes: '',
  });
  const [activeTab, setActiveTab] = useState('contributions');
  const queryClient = useQueryClient();

  // Fetch available languages
  const { data: languages = [] } = useQuery({
    queryKey: ['/api/languages'],
    enabled: isOpen,
  });

  // Fetch existing contributions
  const { data: contributions = [], isLoading } = useQuery<UserContribution[]>({
    queryKey: [`/api/words/${baseWordId}/user-contributions`],
    enabled: isOpen,
  });

  // Create contribution mutation
  const createContributionMutation = useMutation({
    mutationFn: (contributionData: typeof newContribution) =>
      apiRequest(`/api/words/${baseWordId}/user-contributions`, {
        method: 'POST',
        body: JSON.stringify(contributionData),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/words/${baseWordId}/user-contributions`] });
      setNewContribution({
        languageId: '',
        contributorName: '',
        contributorEmail: '',
        contributionType: 'translation',
        translation: '',
        pronunciation: '',
        etymology: '',
        usageNote: '',
        culturalContext: '',
        sourceReferences: [''],
        notes: '',
      });
      setActiveTab('contributions');
    },
  });

  const handleSubmit = () => {
    if (!newContribution.contributorName || !newContribution.contributorEmail || !newContribution.languageId) {
      return;
    }
    
    const contributionData = {
      ...newContribution,
      sourceReferences: newContribution.sourceReferences.filter(ref => ref.trim()),
    };
    
    createContributionMutation.mutate(contributionData);
  };

  const updateSourceReference = (index: number, value: string) => {
    setNewContribution(prev => {
      const newRefs = [...prev.sourceReferences];
      newRefs[index] = value;
      return { ...prev, sourceReferences: newRefs };
    });
  };

  const addSourceReference = () => {
    setNewContribution(prev => ({
      ...prev,
      sourceReferences: [...prev.sourceReferences, '']
    }));
  };

  const getContributionTypeIcon = (type: string) => {
    const icons = {
      translation: Globe,
      pronunciation: MessageSquare,
      etymology: Clock,
      usage_note: User,
      cultural_context: Users,
    };
    const Icon = icons[type as keyof typeof icons] || Globe;
    return <Icon className="h-4 w-4" />;
  };

  const getContributionTypeColor = (type: string) => {
    const colors = {
      translation: 'bg-blue-100 text-blue-800',
      pronunciation: 'bg-green-100 text-green-800',
      etymology: 'bg-purple-100 text-purple-800',
      usage_note: 'bg-orange-100 text-orange-800',
      cultural_context: 'bg-pink-100 text-pink-800',
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const getVerificationIcon = (status: string) => {
    switch (status) {
      case 'verified': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'disputed': return <AlertCircle className="h-4 w-4 text-orange-600" />;
      default: return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const sortedContributions = contributions.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const contributionsByType = contributions.reduce((acc, contribution) => {
    if (!acc[contribution.contributionType]) acc[contribution.contributionType] = [];
    acc[contribution.contributionType].push(contribution);
    return acc;
  }, {} as Record<string, UserContribution[]>);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden" data-testid="dialog-user-contributions">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialog-title">
            <Users className="h-5 w-5" />
            User Contributions for "{baseWord}"
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="contributions" data-testid="tab-contributions">
              Contributions ({contributions.length})
            </TabsTrigger>
            <TabsTrigger value="add-contribution" data-testid="tab-add-contribution">
              Add Contribution
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contributions" className="flex-1">
            <ScrollArea className="h-96">
              {isLoading ? (
                <div className="flex items-center justify-center py-8" data-testid="loading-contributions">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                    <p className="text-sm text-muted-foreground">Loading user contributions...</p>
                  </div>
                </div>
              ) : contributions.length === 0 ? (
                <div className="text-center py-8" data-testid="empty-contributions-state">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Contributions Yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Be the first to contribute linguistic knowledge for "{baseWord}"
                  </p>
                  <Button onClick={() => setActiveTab('add-contribution')} data-testid="button-add-first-contribution">
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Contribution
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(contributionsByType).map(([type, typeContributions]) => (
                    <div key={type} className="space-y-3">
                      <div className="flex items-center gap-2">
                        {getContributionTypeIcon(type)}
                        <h3 className="text-lg font-medium capitalize">{type.replace('_', ' ')}</h3>
                        <Badge className={getContributionTypeColor(type)}>
                          {typeContributions.length} contribution{typeContributions.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      
                      {typeContributions.map((contribution) => (
                        <Card key={contribution.id} className="border-l-4 border-l-primary" data-testid={`contribution-${contribution.id}`}>
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    <Badge 
                                      variant="secondary" 
                                      className={getContributionTypeColor(contribution.contributionType)}
                                    >
                                      {contribution.contributionType.replace('_', ' ').toUpperCase()}
                                    </Badge>
                                    {getVerificationIcon(contribution.verificationStatus)}
                                  </div>
                                  <CardTitle className="text-sm font-medium">
                                    {contribution.languageName || 'Unknown Language'}
                                  </CardTitle>
                                  <p className="text-xs text-muted-foreground">
                                    by {contribution.contributorName}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(contribution.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0 space-y-3">
                            {contribution.translation && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Translation</h4>
                                <p className="text-sm font-medium">{contribution.translation}</p>
                              </div>
                            )}
                            
                            {contribution.pronunciation && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Pronunciation</h4>
                                <p className="text-sm font-mono bg-muted px-2 py-1 rounded">{contribution.pronunciation}</p>
                              </div>
                            )}
                            
                            {contribution.etymology && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Etymology</h4>
                                <p className="text-sm">{contribution.etymology}</p>
                              </div>
                            )}
                            
                            {contribution.usageNote && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Usage Note</h4>
                                <p className="text-sm">{contribution.usageNote}</p>
                              </div>
                            )}
                            
                            {contribution.culturalContext && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Cultural Context</h4>
                                <p className="text-sm">{contribution.culturalContext}</p>
                              </div>
                            )}

                            {contribution.sourceReferences.length > 0 && (
                              <div>
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Sources</h4>
                                <ul className="text-xs space-y-1">
                                  {contribution.sourceReferences.map((source, idx) => (
                                    <li key={idx} className="truncate">• {source}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {contribution.notes && (
                              <div className="pt-2 border-t">
                                <h4 className="text-xs font-medium text-muted-foreground mb-1">Additional Notes</h4>
                                <p className="text-xs text-muted-foreground">{contribution.notes}</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="add-contribution" className="space-y-4">
            <ScrollArea className="h-96">
              <div className="space-y-4 pr-4">
                <Alert>
                  <Star className="h-4 w-4" />
                  <AlertDescription>
                    Help expand our linguistic database by contributing translations, pronunciations, etymologies, and cultural context.
                    Your contributions will be reviewed by language experts.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="contributor-name">Your Name *</Label>
                    <Input
                      id="contributor-name"
                      placeholder="Full name"
                      value={newContribution.contributorName}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, contributorName: e.target.value }))}
                      data-testid="input-contributor-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="contributor-email">Your Email *</Label>
                    <Input
                      id="contributor-email"
                      type="email"
                      placeholder="email@example.com"
                      value={newContribution.contributorEmail}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, contributorEmail: e.target.value }))}
                      data-testid="input-contributor-email"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="language">Language *</Label>
                    <Select
                      value={newContribution.languageId}
                      onValueChange={(value) => setNewContribution(prev => ({ ...prev, languageId: value }))}
                    >
                      <SelectTrigger data-testid="select-language">
                        <SelectValue placeholder="Select a language" />
                      </SelectTrigger>
                      <SelectContent>
                        {languages.map((lang: any) => (
                          <SelectItem key={lang.id} value={lang.id}>
                            {lang.name} ({lang.nativeName})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="contribution-type">Contribution Type</Label>
                    <Select
                      value={newContribution.contributionType}
                      onValueChange={(value) => setNewContribution(prev => ({ ...prev, contributionType: value as any }))}
                    >
                      <SelectTrigger data-testid="select-contribution-type">
                        <SelectValue placeholder="Select contribution type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="translation">Translation</SelectItem>
                        <SelectItem value="pronunciation">Pronunciation</SelectItem>
                        <SelectItem value="etymology">Etymology</SelectItem>
                        <SelectItem value="usage_note">Usage Note</SelectItem>
                        <SelectItem value="cultural_context">Cultural Context</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {newContribution.contributionType === 'translation' && (
                  <div>
                    <Label htmlFor="translation">Translation</Label>
                    <Input
                      id="translation"
                      placeholder="Enter translation"
                      value={newContribution.translation}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, translation: e.target.value }))}
                      data-testid="input-translation"
                    />
                  </div>
                )}

                {newContribution.contributionType === 'pronunciation' && (
                  <div>
                    <Label htmlFor="pronunciation">Pronunciation (IPA)</Label>
                    <Input
                      id="pronunciation"
                      placeholder="/wɔːtər/ or phonetic spelling"
                      value={newContribution.pronunciation}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, pronunciation: e.target.value }))}
                      data-testid="input-pronunciation"
                    />
                  </div>
                )}

                {newContribution.contributionType === 'etymology' && (
                  <div>
                    <Label htmlFor="etymology">Etymology</Label>
                    <Textarea
                      id="etymology"
                      placeholder="Describe the word's origin and historical development..."
                      value={newContribution.etymology}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, etymology: e.target.value }))}
                      rows={3}
                      data-testid="textarea-etymology"
                    />
                  </div>
                )}

                {newContribution.contributionType === 'usage_note' && (
                  <div>
                    <Label htmlFor="usage-note">Usage Note</Label>
                    <Textarea
                      id="usage-note"
                      placeholder="Explain how this word is used, any regional variations, formality level, etc..."
                      value={newContribution.usageNote}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, usageNote: e.target.value }))}
                      rows={3}
                      data-testid="textarea-usage-note"
                    />
                  </div>
                )}

                {newContribution.contributionType === 'cultural_context' && (
                  <div>
                    <Label htmlFor="cultural-context">Cultural Context</Label>
                    <Textarea
                      id="cultural-context"
                      placeholder="Describe cultural significance, traditions, or social context..."
                      value={newContribution.culturalContext}
                      onChange={(e) => setNewContribution(prev => ({ ...prev, culturalContext: e.target.value }))}
                      rows={3}
                      data-testid="textarea-cultural-context"
                    />
                  </div>
                )}

                <div>
                  <Label>Source References</Label>
                  {newContribution.sourceReferences.map((ref, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="Dictionary, book, academic paper, etc."
                        value={ref}
                        onChange={(e) => updateSourceReference(index, e.target.value)}
                        data-testid={`input-source-${index}`}
                      />
                      {index === newContribution.sourceReferences.length - 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addSourceReference}
                          data-testid="button-add-source"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <Label htmlFor="notes">Additional Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any additional information or context..."
                    value={newContribution.notes}
                    onChange={(e) => setNewContribution(prev => ({ ...prev, notes: e.target.value }))}
                    rows={2}
                    data-testid="textarea-notes"
                  />
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={() => setActiveTab('contributions')}
                data-testid="button-cancel-contribution"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  !newContribution.contributorName || 
                  !newContribution.contributorEmail || 
                  !newContribution.languageId ||
                  createContributionMutation.isPending
                }
                data-testid="button-submit-contribution"
              >
                {createContributionMutation.isPending ? 'Submitting...' : 'Submit Contribution'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}