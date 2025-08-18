import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { 
  Calendar,
  MapPin,
  Users,
  BookOpen,
  CheckCircle,
  AlertCircle,
  Plus,
  Clock
} from "lucide-react";

interface LanguageEvolutionTimelineProps {
  languageId: string;
  languageName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface EvolutionEvent {
  id: string;
  languageId: string;
  eventType: 'phonetic_change' | 'grammatical_change' | 'lexical_change' | 'contact_influence' | 'script_change';
  timeStart: string;
  timeEnd?: string;
  description: string;
  evidenceType: 'archaeological' | 'historical' | 'linguistic' | 'genetic';
  evidenceDescription: string;
  sourceReferences: string[];
  geographicRegion: string;
  confidence: number;
  verificationStatus: 'verified' | 'disputed' | 'pending';
  linguisticDetails: {
    soundChanges?: string[];
    grammaticalFeatures?: string[];
    vocabularyChanges?: string[];
    orthographicChanges?: string[];
  };
  culturalContext: string;
  createdAt: string;
  updatedAt: string;
}

export default function LanguageEvolutionTimeline({
  languageId,
  languageName,
  isOpen,
  onClose,
}: LanguageEvolutionTimelineProps) {
  const [newEvent, setNewEvent] = useState({
    eventType: 'phonetic_change' as const,
    timeStart: '',
    timeEnd: '',
    description: '',
    evidenceType: 'linguistic' as const,
    evidenceDescription: '',
    sourceReferences: [''],
    geographicRegion: '',
    confidence: 75,
    linguisticDetails: {
      soundChanges: [''],
      grammaticalFeatures: [''],
      vocabularyChanges: [''],
      orthographicChanges: [''],
    },
    culturalContext: '',
  });
  const [activeTab, setActiveTab] = useState('timeline');
  const queryClient = useQueryClient();

  // Fetch evolution events
  const { data: evolutionEvents = [], isLoading } = useQuery<EvolutionEvent[]>({
    queryKey: [`/api/languages/${languageId}/evolution`],
    enabled: isOpen,
  });

  // Create evolution event mutation
  const createEventMutation = useMutation({
    mutationFn: (eventData: typeof newEvent) =>
      apiRequest(`/api/languages/${languageId}/evolution`, {
        method: 'POST',
        body: JSON.stringify(eventData),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/languages/${languageId}/evolution`] });
      setNewEvent({
        eventType: 'phonetic_change',
        timeStart: '',
        timeEnd: '',
        description: '',
        evidenceType: 'linguistic',
        evidenceDescription: '',
        sourceReferences: [''],
        geographicRegion: '',
        confidence: 75,
        linguisticDetails: {
          soundChanges: [''],
          grammaticalFeatures: [''],
          vocabularyChanges: [''],
          orthographicChanges: [''],
        },
        culturalContext: '',
      });
      setActiveTab('timeline');
    },
  });

  const handleSubmit = () => {
    if (!newEvent.description || !newEvent.timeStart) return;
    
    const eventData = {
      ...newEvent,
      sourceReferences: newEvent.sourceReferences.filter(ref => ref.trim()),
      linguisticDetails: {
        soundChanges: newEvent.linguisticDetails.soundChanges?.filter(change => change.trim()),
        grammaticalFeatures: newEvent.linguisticDetails.grammaticalFeatures?.filter(feature => feature.trim()),
        vocabularyChanges: newEvent.linguisticDetails.vocabularyChanges?.filter(change => change.trim()),
        orthographicChanges: newEvent.linguisticDetails.orthographicChanges?.filter(change => change.trim()),
      },
    };
    
    createEventMutation.mutate(eventData);
  };

  const updateArrayField = (
    fieldPath: string,
    index: number,
    value: string
  ) => {
    setNewEvent(prev => {
      const keys = fieldPath.split('.');
      const newState = { ...prev };
      let current: any = newState;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      
      const finalKey = keys[keys.length - 1];
      if (!current[finalKey]) current[finalKey] = [];
      current[finalKey][index] = value;
      
      return newState;
    });
  };

  const addArrayField = (fieldPath: string) => {
    setNewEvent(prev => {
      const keys = fieldPath.split('.');
      const newState = { ...prev };
      let current: any = newState;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }
      
      const finalKey = keys[keys.length - 1];
      if (!current[finalKey]) current[finalKey] = [];
      current[finalKey].push('');
      
      return newState;
    });
  };

  const sortedEvents = evolutionEvents.sort((a, b) => {
    const timeA = new Date(a.timeStart).getTime();
    const timeB = new Date(b.timeStart).getTime();
    return timeB - timeA; // Most recent first
  });

  const getEventTypeColor = (type: string) => {
    const colors = {
      phonetic_change: 'bg-blue-100 text-blue-800',
      grammatical_change: 'bg-green-100 text-green-800',
      lexical_change: 'bg-purple-100 text-purple-800',
      contact_influence: 'bg-orange-100 text-orange-800',
      script_change: 'bg-pink-100 text-pink-800',
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden" data-testid="dialog-evolution-timeline">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialog-title">
            <Calendar className="h-5 w-5" />
            Language Evolution Timeline - {languageName}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="timeline" data-testid="tab-timeline">Timeline View</TabsTrigger>
            <TabsTrigger value="add-event" data-testid="tab-add-event">Add Evolution Event</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="flex-1">
            <ScrollArea className="h-96">
              {isLoading ? (
                <div className="flex items-center justify-center py-8" data-testid="loading-evolution">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                    <p className="text-sm text-muted-foreground">Loading evolution events...</p>
                  </div>
                </div>
              ) : sortedEvents.length === 0 ? (
                <div className="text-center py-8" data-testid="empty-evolution-state">
                  <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Evolution Events Yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Start documenting the linguistic evolution of {languageName}
                  </p>
                  <Button onClick={() => setActiveTab('add-event')} data-testid="button-add-first-event">
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Event
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedEvents.map((event, index) => (
                    <Card key={event.id} className="relative" data-testid={`evolution-event-${event.id}`}>
                      {index < sortedEvents.length - 1 && (
                        <div className="absolute left-6 top-16 w-px h-8 bg-border"></div>
                      )}
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0 mt-1"></div>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge 
                                  variant="secondary" 
                                  className={getEventTypeColor(event.eventType)}
                                  data-testid={`badge-event-type-${event.eventType}`}
                                >
                                  {event.eventType.replace('_', ' ').toUpperCase()}
                                </Badge>
                                {getVerificationIcon(event.verificationStatus)}
                              </div>
                              <CardTitle className="text-sm font-medium">
                                {event.timeStart}
                                {event.timeEnd && ` - ${event.timeEnd}`}
                              </CardTitle>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Progress 
                              value={event.confidence} 
                              className="w-16 h-2"
                              data-testid={`confidence-${event.id}`}
                            />
                            <span className="text-xs text-muted-foreground">{event.confidence}%</span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm text-foreground mb-3">{event.description}</p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              Geographic Region
                            </h4>
                            <p className="text-sm">{event.geographicRegion || 'Not specified'}</p>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                              <BookOpen className="h-3 w-3" />
                              Evidence Type
                            </h4>
                            <p className="text-sm capitalize">{event.evidenceType}</p>
                          </div>
                        </div>

                        {event.linguisticDetails && (
                          <div className="mt-4">
                            <h4 className="text-xs font-medium text-muted-foreground mb-2">
                              Linguistic Details
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                              {event.linguisticDetails.soundChanges?.length > 0 && (
                                <div>
                                  <span className="font-medium">Sound Changes:</span>
                                  <ul className="list-disc list-inside ml-2">
                                    {event.linguisticDetails.soundChanges.map((change, idx) => (
                                      <li key={idx}>{change}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {event.linguisticDetails.grammaticalFeatures?.length > 0 && (
                                <div>
                                  <span className="font-medium">Grammar:</span>
                                  <ul className="list-disc list-inside ml-2">
                                    {event.linguisticDetails.grammaticalFeatures.map((feature, idx) => (
                                      <li key={idx}>{feature}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {event.culturalContext && (
                          <div className="mt-3 p-2 bg-muted/50 rounded-md">
                            <h4 className="text-xs font-medium mb-1">Cultural Context</h4>
                            <p className="text-xs">{event.culturalContext}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="add-event" className="space-y-4">
            <ScrollArea className="h-96">
              <div className="space-y-4 pr-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="event-type">Event Type</Label>
                    <Select
                      value={newEvent.eventType}
                      onValueChange={(value) => setNewEvent(prev => ({ ...prev, eventType: value as any }))}
                    >
                      <SelectTrigger data-testid="select-event-type">
                        <SelectValue placeholder="Select event type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phonetic_change">Phonetic Change</SelectItem>
                        <SelectItem value="grammatical_change">Grammatical Change</SelectItem>
                        <SelectItem value="lexical_change">Lexical Change</SelectItem>
                        <SelectItem value="contact_influence">Contact Influence</SelectItem>
                        <SelectItem value="script_change">Script Change</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="evidence-type">Evidence Type</Label>
                    <Select
                      value={newEvent.evidenceType}
                      onValueChange={(value) => setNewEvent(prev => ({ ...prev, evidenceType: value as any }))}
                    >
                      <SelectTrigger data-testid="select-evidence-type">
                        <SelectValue placeholder="Select evidence type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="archaeological">Archaeological</SelectItem>
                        <SelectItem value="historical">Historical</SelectItem>
                        <SelectItem value="linguistic">Linguistic</SelectItem>
                        <SelectItem value="genetic">Genetic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="time-start">Time Period Start</Label>
                    <Input
                      id="time-start"
                      placeholder="e.g., 1200 CE, 15th century"
                      value={newEvent.timeStart}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, timeStart: e.target.value }))}
                      data-testid="input-time-start"
                    />
                  </div>
                  <div>
                    <Label htmlFor="time-end">Time Period End (Optional)</Label>
                    <Input
                      id="time-end"
                      placeholder="e.g., 1500 CE, 17th century"
                      value={newEvent.timeEnd}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, timeEnd: e.target.value }))}
                      data-testid="input-time-end"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="description">Event Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe the linguistic change or evolution event..."
                    value={newEvent.description}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, description: e.target.value }))}
                    rows={3}
                    data-testid="textarea-description"
                  />
                </div>

                <div>
                  <Label htmlFor="geographic-region">Geographic Region</Label>
                  <Input
                    id="geographic-region"
                    placeholder="e.g., Northern England, Normandy, etc."
                    value={newEvent.geographicRegion}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, geographicRegion: e.target.value }))}
                    data-testid="input-geographic-region"
                  />
                </div>

                <div>
                  <Label htmlFor="confidence">Confidence Level: {newEvent.confidence}%</Label>
                  <input
                    type="range"
                    id="confidence"
                    min="0"
                    max="100"
                    value={newEvent.confidence}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, confidence: parseInt(e.target.value) }))}
                    className="w-full"
                    data-testid="range-confidence"
                  />
                </div>

                <div>
                  <Label>Sound Changes</Label>
                  {newEvent.linguisticDetails.soundChanges?.map((change, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="e.g., /p/ > /f/ in initial position"
                        value={change}
                        onChange={(e) => updateArrayField('linguisticDetails.soundChanges', index, e.target.value)}
                        data-testid={`input-sound-change-${index}`}
                      />
                      {index === newEvent.linguisticDetails.soundChanges!.length - 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addArrayField('linguisticDetails.soundChanges')}
                          data-testid="button-add-sound-change"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <Label htmlFor="cultural-context">Cultural Context</Label>
                  <Textarea
                    id="cultural-context"
                    placeholder="Historical and cultural context for this change..."
                    value={newEvent.culturalContext}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, culturalContext: e.target.value }))}
                    rows={2}
                    data-testid="textarea-cultural-context"
                  />
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={() => setActiveTab('timeline')}
                data-testid="button-cancel-add-event"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!newEvent.description || !newEvent.timeStart || createEventMutation.isPending}
                data-testid="button-submit-evolution-event"
              >
                {createEventMutation.isPending ? 'Adding...' : 'Add Evolution Event'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}