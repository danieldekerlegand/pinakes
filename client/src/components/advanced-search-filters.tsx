import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { 
  Filter,
  Search,
  Save,
  Trash2,
  Star,
  Globe,
  Users,
  Calendar,
  BookOpen,
  Settings,
  X,
  Plus
} from "lucide-react";

interface AdvancedSearchFiltersProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: SearchFilters) => void;
}

interface SearchFilters {
  // Language Properties
  languageStatuses: string[];
  regions: string[];
  speakerRanges: string[];
  writingSystems: string[];
  languageFamilies: string[];
  
  // Historical & Temporal
  timeOrigins: string[];
  isHistoricalVariant: boolean | null;
  isDialect: boolean | null;
  
  // Linguistic Features
  phonologicalFeatures: string[];
  grammaticalFeatures: string[];
  lexicalFeatures: string[];
  
  // Data Quality
  translationCompleteness: number[];
  verificationStatus: string[];
  lastScrapedWithin: string | null;
  
  // Custom Criteria
  customQuery: string;
  exactMatch: boolean;
}

interface SavedFilter {
  id: string;
  name: string;
  description: string;
  filters: SearchFilters;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const defaultFilters: SearchFilters = {
  languageStatuses: [],
  regions: [],
  speakerRanges: [],
  writingSystems: [],
  languageFamilies: [],
  timeOrigins: [],
  isHistoricalVariant: null,
  isDialect: null,
  phonologicalFeatures: [],
  grammaticalFeatures: [],
  lexicalFeatures: [],
  translationCompleteness: [0, 100],
  verificationStatus: [],
  lastScrapedWithin: null,
  customQuery: '',
  exactMatch: false,
};

export default function AdvancedSearchFilters({
  isOpen,
  onClose,
  onApplyFilters,
}: AdvancedSearchFiltersProps) {
  const [currentFilters, setCurrentFilters] = useState<SearchFilters>(defaultFilters);
  const [savedFilterName, setSavedFilterName] = useState('');
  const [savedFilterDescription, setSavedFilterDescription] = useState('');
  const [activeTab, setActiveTab] = useState('filters');
  const queryClient = useQueryClient();

  // Fetch available languages and families for filter options
  const { data: languages = [] } = useQuery({
    queryKey: ['/api/languages'],
    enabled: isOpen,
  });

  const { data: languageFamilies = [] } = useQuery({
    queryKey: ['/api/language-families'],
    enabled: isOpen,
  });

  // Fetch saved filters
  const { data: savedFilters = [] } = useQuery<SavedFilter[]>({
    queryKey: ['/api/search-filters'],
    enabled: isOpen,
  });

  // Save filter mutation
  const saveFilterMutation = useMutation({
    mutationFn: (filterData: { name: string; description: string; filters: SearchFilters }) =>
      apiRequest('/api/search-filters', {
        method: 'POST',
        body: JSON.stringify(filterData),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/search-filters'] });
      setSavedFilterName('');
      setSavedFilterDescription('');
      setActiveTab('saved');
    },
  });

  // Delete filter mutation
  const deleteFilterMutation = useMutation({
    mutationFn: (filterId: string) =>
      apiRequest(`/api/search-filters/${filterId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/search-filters'] });
    },
  });

  const handleApplyFilters = () => {
    onApplyFilters(currentFilters);
    onClose();
  };

  const handleResetFilters = () => {
    setCurrentFilters(defaultFilters);
  };

  const handleLoadSavedFilter = (filter: SavedFilter) => {
    setCurrentFilters(filter.filters);
    setActiveTab('filters');
  };

  const handleSaveFilter = () => {
    if (!savedFilterName.trim()) return;
    
    saveFilterMutation.mutate({
      name: savedFilterName.trim(),
      description: savedFilterDescription.trim(),
      filters: currentFilters,
    });
  };

  const updateFilter = (key: keyof SearchFilters, value: any) => {
    setCurrentFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayValue = (key: keyof SearchFilters, value: string) => {
    setCurrentFilters(prev => {
      const currentArray = prev[key] as string[];
      const newArray = currentArray.includes(value)
        ? currentArray.filter(v => v !== value)
        : [...currentArray, value];
      return { ...prev, [key]: newArray };
    });
  };

  const getUniqueValues = (languages: any[], field: string) => {
    const values = languages
      .map(lang => lang[field])
      .filter(Boolean)
      .flat();
    return [...new Set(values)].sort();
  };

  const activeFiltersCount = Object.entries(currentFilters).reduce((count, [key, value]) => {
    if (key === 'translationCompleteness') {
      const range = value as number[];
      return count + (range[0] > 0 || range[1] < 100 ? 1 : 0);
    }
    if (Array.isArray(value)) return count + value.length;
    if (typeof value === 'boolean') return count + (value !== null ? 1 : 0);
    if (typeof value === 'string') return count + (value ? 1 : 0);
    return count;
  }, 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden" data-testid="dialog-advanced-search">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialog-title">
            <Filter className="h-5 w-5" />
            Advanced Search Filters
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeFiltersCount} filter{activeFiltersCount !== 1 ? 's' : ''} active
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="filters" data-testid="tab-filters">
              Current Filters
            </TabsTrigger>
            <TabsTrigger value="saved" data-testid="tab-saved">
              Saved Filters ({savedFilters.length})
            </TabsTrigger>
            <TabsTrigger value="save-new" data-testid="tab-save-new">
              Save Current
            </TabsTrigger>
          </TabsList>

          <TabsContent value="filters" className="flex-1">
            <ScrollArea className="h-96">
              <div className="space-y-6 pr-4">
                {/* Language Properties */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      Language Properties
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium">Language Status</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {['living', 'endangered', 'moribund', 'extinct', 'historical'].map(status => (
                          <div key={status} className="flex items-center space-x-2">
                            <Checkbox
                              id={`status-${status}`}
                              checked={currentFilters.languageStatuses.includes(status)}
                              onCheckedChange={() => toggleArrayValue('languageStatuses', status)}
                              data-testid={`checkbox-status-${status}`}
                            />
                            <label htmlFor={`status-${status}`} className="text-sm capitalize">
                              {status}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium">Geographic Regions</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {getUniqueValues(languages, 'region').slice(0, 8).map(region => (
                          <div key={region} className="flex items-center space-x-2">
                            <Checkbox
                              id={`region-${region}`}
                              checked={currentFilters.regions.includes(region)}
                              onCheckedChange={() => toggleArrayValue('regions', region)}
                              data-testid={`checkbox-region-${region}`}
                            />
                            <label htmlFor={`region-${region}`} className="text-sm">
                              {region}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium">Speaker Count Range</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {[
                          { label: '< 1K', value: '0-1000' },
                          { label: '1K - 10K', value: '1000-10000' },
                          { label: '10K - 100K', value: '10000-100000' },
                          { label: '100K - 1M', value: '100000-1000000' },
                          { label: '> 1M', value: '1000000+' }
                        ].map(range => (
                          <div key={range.value} className="flex items-center space-x-2">
                            <Checkbox
                              id={`speakers-${range.value}`}
                              checked={currentFilters.speakerRanges.includes(range.value)}
                              onCheckedChange={() => toggleArrayValue('speakerRanges', range.value)}
                              data-testid={`checkbox-speakers-${range.value}`}
                            />
                            <label htmlFor={`speakers-${range.value}`} className="text-sm">
                              {range.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Historical & Temporal */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Historical & Temporal
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs font-medium">Historical Variants</Label>
                        <div className="mt-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="historical-only"
                              checked={currentFilters.isHistoricalVariant === true}
                              onCheckedChange={(checked) => 
                                updateFilter('isHistoricalVariant', checked ? true : null)
                              }
                              data-testid="checkbox-historical-only"
                            />
                            <label htmlFor="historical-only" className="text-sm">
                              Historical variants only
                            </label>
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs font-medium">Dialects</Label>
                        <div className="mt-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="dialects-only"
                              checked={currentFilters.isDialect === true}
                              onCheckedChange={(checked) => 
                                updateFilter('isDialect', checked ? true : null)
                              }
                              data-testid="checkbox-dialects-only"
                            />
                            <label htmlFor="dialects-only" className="text-sm">
                              Dialects only
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium">Time Origins</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {[
                          'Ancient (pre-500 CE)',
                          'Medieval (500-1500 CE)', 
                          'Early Modern (1500-1800 CE)',
                          'Modern (1800+ CE)'
                        ].map(period => (
                          <div key={period} className="flex items-center space-x-2">
                            <Checkbox
                              id={`period-${period}`}
                              checked={currentFilters.timeOrigins.includes(period)}
                              onCheckedChange={() => toggleArrayValue('timeOrigins', period)}
                              data-testid={`checkbox-period-${period}`}
                            />
                            <label htmlFor={`period-${period}`} className="text-sm">
                              {period}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Data Quality */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Data Quality & Completeness
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium">
                        Translation Completeness: {currentFilters.translationCompleteness[0]}% - {currentFilters.translationCompleteness[1]}%
                      </Label>
                      <div className="mt-2 space-y-2">
                        <div className="flex gap-4">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="Min %"
                            value={currentFilters.translationCompleteness[0]}
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 0;
                              updateFilter('translationCompleteness', [value, currentFilters.translationCompleteness[1]]);
                            }}
                            data-testid="input-completion-min"
                            className="w-24"
                          />
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="Max %"
                            value={currentFilters.translationCompleteness[1]}
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 100;
                              updateFilter('translationCompleteness', [currentFilters.translationCompleteness[0], value]);
                            }}
                            data-testid="input-completion-max"
                            className="w-24"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium">Verification Status</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {['verified', 'pending', 'disputed'].map(status => (
                          <div key={status} className="flex items-center space-x-2">
                            <Checkbox
                              id={`verification-${status}`}
                              checked={currentFilters.verificationStatus.includes(status)}
                              onCheckedChange={() => toggleArrayValue('verificationStatus', status)}
                              data-testid={`checkbox-verification-${status}`}
                            />
                            <label htmlFor={`verification-${status}`} className="text-sm capitalize">
                              {status}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="last-scraped">Last Scraped Within</Label>
                      <Select
                        value={currentFilters.lastScrapedWithin || ''}
                        onValueChange={(value) => updateFilter('lastScrapedWithin', value || null)}
                      >
                        <SelectTrigger data-testid="select-last-scraped">
                          <SelectValue placeholder="Any time" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Any time</SelectItem>
                          <SelectItem value="24h">Last 24 hours</SelectItem>
                          <SelectItem value="7d">Last week</SelectItem>
                          <SelectItem value="30d">Last month</SelectItem>
                          <SelectItem value="90d">Last 3 months</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Custom Query */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Search className="h-4 w-4" />
                      Custom Search Query
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="custom-query">Search Text</Label>
                      <Textarea
                        id="custom-query"
                        placeholder="Enter custom search query..."
                        value={currentFilters.customQuery}
                        onChange={(e) => updateFilter('customQuery', e.target.value)}
                        rows={2}
                        data-testid="textarea-custom-query"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="exact-match"
                        checked={currentFilters.exactMatch}
                        onCheckedChange={(checked) => updateFilter('exactMatch', checked)}
                        data-testid="checkbox-exact-match"
                      />
                      <label htmlFor="exact-match" className="text-sm">
                        Exact match only
                      </label>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>

            <div className="flex justify-between pt-4 border-t">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleResetFilters}
                  data-testid="button-reset-filters"
                >
                  Reset All
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  data-testid="button-cancel-filters"
                >
                  Cancel
                </Button>
              </div>
              <Button
                onClick={handleApplyFilters}
                data-testid="button-apply-filters"
              >
                Apply Filters ({activeFiltersCount})
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="saved" className="flex-1">
            <ScrollArea className="h-96">
              {savedFilters.length === 0 ? (
                <div className="text-center py-8" data-testid="empty-saved-filters">
                  <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Saved Filters</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create and save custom filter combinations for quick access
                  </p>
                  <Button onClick={() => setActiveTab('save-new')} data-testid="button-create-first-filter">
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Filter
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedFilters.map((filter) => (
                    <Card key={filter.id} data-testid={`saved-filter-${filter.id}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-sm flex items-center gap-2">
                              {filter.isDefault && <Star className="h-3 w-3 text-yellow-500" />}
                              {filter.name}
                            </CardTitle>
                            {filter.description && (
                              <p className="text-xs text-muted-foreground mt-1">{filter.description}</p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleLoadSavedFilter(filter)}
                              data-testid={`button-load-filter-${filter.id}`}
                            >
                              Load
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteFilterMutation.mutate(filter.id)}
                              data-testid={`button-delete-filter-${filter.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="text-xs text-muted-foreground">
                          Created: {new Date(filter.createdAt).toLocaleDateString()}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="save-new" className="space-y-4">
            <div className="space-y-4">
              <Alert>
                <Save className="h-4 w-4" />
                <AlertDescription>
                  Save your current filter configuration for quick access later.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="filter-name">Filter Name *</Label>
                  <Input
                    id="filter-name"
                    placeholder="e.g., European Living Languages"
                    value={savedFilterName}
                    onChange={(e) => setSavedFilterName(e.target.value)}
                    data-testid="input-filter-name"
                  />
                </div>
                <div>
                  <Label htmlFor="filter-description">Description</Label>
                  <Textarea
                    id="filter-description"
                    placeholder="Describe when to use this filter..."
                    value={savedFilterDescription}
                    onChange={(e) => setSavedFilterDescription(e.target.value)}
                    rows={2}
                    data-testid="textarea-filter-description"
                  />
                </div>
              </div>

              {activeFiltersCount > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Current Active Filters</h4>
                  <div className="bg-muted p-3 rounded-md">
                    <p className="text-xs text-muted-foreground">
                      {activeFiltersCount} filter{activeFiltersCount !== 1 ? 's' : ''} configured
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => setActiveTab('filters')}
                  data-testid="button-back-to-filters"
                >
                  Back to Filters
                </Button>
                <Button
                  onClick={handleSaveFilter}
                  disabled={!savedFilterName.trim() || saveFilterMutation.isPending}
                  data-testid="button-save-filter"
                >
                  {saveFilterMutation.isPending ? 'Saving...' : 'Save Filter'}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}