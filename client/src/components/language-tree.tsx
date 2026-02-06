import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  TreePine,
  Globe,
  GitBranch,
  Target,
  Users,
  Clock,
  Trash2,
  Database,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type { LanguageFamilyWithChildren, LanguageWithVariants } from "@shared/types";

interface LanguageTreeProps {
  searchQuery: string;
  filters: {
    status: string[];
    region: string;
    speakers: string;
  };
  selectedLanguageId: string | null;
  onLanguageSelect: (languageId: string) => void;
  onRefresh?: () => void;
  expandAll?: number;
  collapseAll?: number;
}

interface TreeNodeProps {
  family: LanguageFamilyWithChildren;
  level: number;
  searchQuery: string;
  filters: any;
  selectedLanguageId: string | null;
  onLanguageSelect: (languageId: string) => void;
  onRefresh?: () => void;
  expandAll?: number;
  collapseAll?: number;
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

function formatSpeakerCount(count: number): string {
  if (count >= 1000000000) return `${(count / 1000000000).toFixed(1)}B`;
  if (count >= 1000000) return `${(count / 1000000).toFixed(0)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
  return count.toString();
}

const getTreeIcon = (level: number) => {
  if (level === 0) return <TreePine className="h-5 w-5" />;
  if (level === 1) return <GitBranch className="h-4 w-4" />;
  return <Target className="h-4 w-4" />;
};

const getTreeColor = (level: number) => {
  switch (level) {
    case 0: return 'text-blue-600 bg-blue-100';
    case 1: return 'text-green-600 bg-green-100';
    case 2: return 'text-orange-600 bg-orange-100';
    default: return 'text-gray-600 bg-gray-100';
  }
};

function WordListBadge({ hasWordList }: { hasWordList?: boolean }) {
  if (!hasWordList) return null;

  return (
    <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
      <Sparkles className="h-3 w-3 mr-1" />
      Word List
    </Badge>
  );
}

function SourceBadge({ source }: { source?: 'northeuralex' | 'scraped' }) {
  if (!source) return null;

  if (source === 'scraped') {
    return (
      <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
        <Sparkles className="h-3 w-3 mr-1" />
        Scraped
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
      <Database className="h-3 w-3 mr-1" />
      NorthEuraLex
    </Badge>
  );
}

function TreeNode({ family, level, searchQuery, filters, selectedLanguageId, onLanguageSelect, onRefresh, expandAll, collapseAll }: TreeNodeProps) {
  // Compute whether this node should be expanded based on props and level
  const computeExpanded = () => {
    // If collapseAll was just triggered, only level 0 expands
    if (collapseAll && collapseAll > 0) {
      return level === 0;
    }
    // If expandAll was just triggered, everything expands
    if (expandAll && expandAll > 0) {
      return true;
    }
    // Default: only level 0 is expanded
    return level === 0;
  };

  const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(null);

  // Determine the final expanded state
  const isExpanded = manuallyExpanded !== null ? manuallyExpanded : computeExpanded();

  // Reset manual state when expand/collapse all is triggered
  useEffect(() => {
    if ((expandAll && expandAll > 0) || (collapseAll && collapseAll > 0)) {
      setManuallyExpanded(null);
    }
  }, [expandAll, collapseAll]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'family' | 'language', id: string, name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const filteredLanguages = useMemo(() => {
    return family.languages.filter((lang: LanguageWithVariants) => {
      // Apply data source filter
      if (filters.dataSource && filters.dataSource.length > 0) {
        if (lang.source && !filters.dataSource.includes(lang.source)) {
          return false;
        }
      }

      // Apply region filter
      if (filters.region && filters.region !== "all-regions") {
        const langRegions = Array.isArray(lang.region) ? lang.region : [lang.region];
        if (!langRegions.some((r: string) => r.toLowerCase().includes(filters.region.toLowerCase()))) {
          return false;
        }
      }

      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = lang.name.toLowerCase().includes(query);
        const matchesNativeName = lang.nativeName?.toLowerCase().includes(query);
        const matchesIso = lang.iso639_1?.toLowerCase().includes(query) || lang.iso639_2?.toLowerCase().includes(query);

        if (!matchesName && !matchesNativeName && !matchesIso) {
          return false;
        }
      }

      return true;
    });
  }, [family.languages, searchQuery, filters]);

  const TreeIcon = getTreeIcon(level);
  const colorClasses = getTreeColor(level);

  // Determine if child families will actually be visible
  const childrenWillShow = family.children.length > 0 && (manuallyExpanded !== null ? manuallyExpanded : !collapseAll);
  // Chevron should reflect actual visibility: if no children, follow isExpanded; if has children, only show down when children visible
  const showExpandedChevron = family.children.length === 0 ? isExpanded : (isExpanded && childrenWillShow);

  const handleDeleteClick = (type: 'family' | 'language', id: string, name: string) => {
    setDeleteTarget({ type, id, name });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    
    setIsDeleting(true);
    try {
      const endpoint = deleteTarget.type === 'family' 
        ? `/api/language-families/${deleteTarget.id}`
        : `/api/languages/${deleteTarget.id}`;
      
      const response = await fetch(endpoint, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Delete operation failed');
      }
      
      toast({
        title: "Success",
        description: `${deleteTarget.type === 'family' ? 'Language family' : 'Language'} deleted successfully`,
      });
      
      onRefresh?.();
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to delete ${deleteTarget.type}`,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="tree-node mb-2">
      {/* Family Header */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div
          className="group flex items-center justify-between p-4 hover:bg-gray-50"
        >
          <div className="flex items-center space-x-3 flex-1 cursor-pointer"
               onClick={() => {
                 // Toggle based on actual visibility state
                 if (family.children.length > 0) {
                   // For families with children, toggle based on whether children are showing
                   setManuallyExpanded(!childrenWillShow);
                 } else {
                   // For families without children, toggle based on isExpanded
                   setManuallyExpanded(!isExpanded);
                 }
               }}
               data-testid={`tree-node-${family.name.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <div className={`p-2 rounded-lg ${colorClasses}`}>
              {TreeIcon}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{family.name}</h3>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className="text-xs">
              {filteredLanguages.length} languages
            </Badge>
            {family.children.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {family.children.length} sub-groups
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-700 hover:bg-red-50 p-2"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteClick('family', family.id, family.name);
              }}
              title="Delete language family"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            {showExpandedChevron ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </div>
        </div>
        
        {/* Languages and Children */}
        {isExpanded && (
          <div className="border-t border-gray-100">
            {/* Languages - if no children, wrap in a virtual secondary level */}
            {family.children.length === 0 && filteredLanguages.length > 0 && (
              <div className="pl-6 pb-4 pt-4">
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-2">
                  <div className="group flex items-center justify-between p-3 bg-gray-50">
                    <div className="flex items-center space-x-3">
                      <div className={`p-1.5 rounded-lg ${getTreeColor(level + 1)}`}>
                        {getTreeIcon(level + 1)}
                      </div>
                      <h4 className="font-medium text-gray-700 text-sm">Languages</h4>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {filteredLanguages.length} languages
                    </Badge>
                  </div>
                  <div className="border-t border-gray-100 p-4 space-y-3">
                    {filteredLanguages.map((language: LanguageWithVariants) => (
                      <div key={language.id} className="language-item">
                        <div
                          className={`group flex items-center justify-between p-3 rounded-lg border hover:shadow-sm cursor-pointer transition-colors ${
                            selectedLanguageId === language.id
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                          }`}
                          onClick={() => onLanguageSelect(language.id)}
                          data-testid={`language-${language.id}`}
                        >
                          <div className="flex items-center space-x-3">
                            <Globe className="h-4 w-4 text-gray-600" />
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-medium text-gray-900">{language.name}</span>
                                {language.nativeName && language.nativeName !== language.name && (
                                  <span className="text-sm text-gray-500">({language.nativeName})</span>
                                )}
                              </div>
                              <div className="flex items-center space-x-2 mt-1">
                                <WordListBadge hasWordList={(language as any).completionPercentage > 0} />
                                <Badge className={getStatusColor(language.status)}>
                                  {language.status}
                                </Badge>
                                {language.totalSpeakers && language.totalSpeakers > 0 && (
                                  <span className="text-xs text-gray-500">
                                    {formatSpeakerCount(language.totalSpeakers)} speakers
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            {language.historicalVariants && language.historicalVariants.length > 0 && (
                              <Badge variant="outline" className="text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                {language.historicalVariants.length} variants
                              </Badge>
                            )}
                            {language.dialects && language.dialects.length > 0 && (
                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                                <Users className="h-3 w-3 mr-1" />
                                {language.dialects.length} dialects
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-700 hover:bg-red-50 p-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick('language', language.id, language.name);
                              }}
                              title="Delete language"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          </div>
                        </div>

                        {/* Variants and Dialects */}
                        {selectedLanguageId === language.id && (
                          <div className="ml-6 mt-2 space-y-2">
                            {language.historicalVariants?.map((variant: any) => (
                              <div key={variant.id} className="flex items-center space-x-2 p-2 bg-amber-50 rounded border">
                                <Clock className="h-3 w-3 text-amber-600" />
                                <span className="text-sm font-medium text-amber-800">{variant.name}</span>
                                <span className="text-xs text-amber-600">
                                  {variant.timeOrigin} - {variant.timeEnd || 'present'}
                                </span>
                                <Badge className={getStatusColor(variant.status)}>
                                  {variant.status}
                                </Badge>
                              </div>
                            ))}
                            {language.dialects?.map((dialect: any) => (
                              <div key={dialect.id} className="flex items-center space-x-2 p-2 bg-green-50 rounded border">
                                <Users className="h-3 w-3 text-green-600" />
                                <span className="text-sm font-medium text-green-800">{dialect.name}</span>
                                <span className="text-xs text-green-600">{dialect.region}</span>
                                <Badge className={getStatusColor(dialect.status)}>
                                  {dialect.status}
                                </Badge>
                                {dialect.totalSpeakers && dialect.totalSpeakers > 0 && (
                                  <span className="text-xs text-green-600">
                                    {formatSpeakerCount(dialect.totalSpeakers)} speakers
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Languages - original rendering for families WITH children */}
            {family.children.length > 0 && filteredLanguages.length > 0 && (
              <div className="p-4 space-y-3">
                {filteredLanguages.map((language: LanguageWithVariants) => (
                  <div key={language.id} className="language-item">
                    <div
                      className={`group flex items-center justify-between p-3 rounded-lg border hover:shadow-sm cursor-pointer transition-colors ${
                        selectedLanguageId === language.id 
                          ? 'bg-blue-50 border-blue-200' 
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                      onClick={() => onLanguageSelect(language.id)}
                      data-testid={`language-${language.id}`}
                    >
                      <div className="flex items-center space-x-3">
                        <Globe className="h-4 w-4 text-gray-600" />
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-900">{language.name}</span>
                            {language.nativeName && language.nativeName !== language.name && (
                              <span className="text-sm text-gray-500">({language.nativeName})</span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 mt-1">
                            <WordListBadge hasWordList={(language as any).completionPercentage > 0} />
                            <Badge className={getStatusColor(language.status)}>
                              {language.status}
                            </Badge>
                            {language.totalSpeakers && language.totalSpeakers > 0 && (
                              <span className="text-xs text-gray-500">
                                {formatSpeakerCount(language.totalSpeakers)} speakers
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        {language.historicalVariants && language.historicalVariants.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            {language.historicalVariants.length} variants
                          </Badge>
                        )}
                        {language.dialects && language.dialects.length > 0 && (
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                            <Users className="h-3 w-3 mr-1" />
                            {language.dialects.length} dialects
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-700 hover:bg-red-50 p-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick('language', language.id, language.name);
                          }}
                          title="Delete language"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </div>
                    
                    {/* Variants and Dialects */}
                    {selectedLanguageId === language.id && (
                      <div className="ml-6 mt-2 space-y-2">
                        {language.historicalVariants?.map((variant: any) => (
                          <div key={variant.id} className="flex items-center space-x-2 p-2 bg-amber-50 rounded border">
                            <Clock className="h-3 w-3 text-amber-600" />
                            <span className="text-sm font-medium text-amber-800">{variant.name}</span>
                            <span className="text-xs text-amber-600">
                              {variant.timeOrigin} - {variant.timeEnd || 'present'}
                            </span>
                            <Badge className={getStatusColor(variant.status)}>
                              {variant.status}
                            </Badge>
                          </div>
                        ))}
                        {language.dialects?.map((dialect: any) => (
                          <div key={dialect.id} className="flex items-center space-x-2 p-2 bg-green-50 rounded border">
                            <Users className="h-3 w-3 text-green-600" />
                            <span className="text-sm font-medium text-green-800">{dialect.name}</span>
                            <span className="text-xs text-green-600">{dialect.region}</span>
                            <Badge className={getStatusColor(dialect.status)}>
                              {dialect.status}
                            </Badge>
                            {dialect.totalSpeakers && dialect.totalSpeakers > 0 && (
                              <span className="text-xs text-green-600">
                                {formatSpeakerCount(dialect.totalSpeakers)} speakers
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {/* Subfamilies - only render if not in collapse-all mode OR if this node was manually expanded */}
            {family.children.length > 0 && (manuallyExpanded !== null ? manuallyExpanded : !collapseAll) && (
              <div className="pl-6 pb-4">
                {family.children.map((child: LanguageFamilyWithChildren) => (
                  <TreeNode
                    key={child.id}
                    family={child}
                    level={level + 1}
                    searchQuery={searchQuery}
                    filters={filters}
                    selectedLanguageId={selectedLanguageId}
                    onLanguageSelect={onLanguageSelect}
                    onRefresh={onRefresh}
                    expandAll={expandAll}
                    collapseAll={collapseAll}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the {deleteTarget?.type} "{deleteTarget?.name}"?
              This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



export default function LanguageTree({ searchQuery, filters, selectedLanguageId, onLanguageSelect, onRefresh, expandAll, collapseAll }: LanguageTreeProps) {
  const { data: familyTree, isLoading } = useQuery<LanguageFamilyWithChildren[]>({
    queryKey: ['/api/language-families/tree'],
  });

  // Filter families by data source
  const filteredFamilyTree = useMemo(() => {
    if (!familyTree) return [];

    return familyTree.filter(family => {
      // Apply search filter to family name
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesFamily = family.name.toLowerCase().includes(query);

        // Also check if any languages in this family match
        const hasMatchingLanguage = family.languages.some((lang: LanguageWithVariants) => {
          const matchesName = lang.name.toLowerCase().includes(query);
          const matchesNativeName = lang.nativeName?.toLowerCase().includes(query);
          const matchesIso = lang.iso639_1?.toLowerCase().includes(query) || lang.iso639_2?.toLowerCase().includes(query);
          return matchesName || matchesNativeName || matchesIso;
        });

        if (!matchesFamily && !hasMatchingLanguage) {
          return false;
        }
      }

      return true;
    });
  }, [familyTree, searchQuery]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="flex items-center p-3">
              <div className="w-6 h-6 bg-gray-200 rounded mr-2" />
              <div className="w-6 h-6 bg-gray-200 rounded mr-3" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded mb-1" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!filteredFamilyTree?.length) {
    return (
      <div className="text-center py-8">
        <TreePine className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600">No language families found matching your filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <TreePine className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Language Family Tree</h2>
              <p className="text-sm text-gray-600">Hierarchical tree structure with dialects and variants</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            <div className="flex items-center space-x-1">
              <TreePine className="h-4 w-4 text-blue-600" />
              <span>Primary Level</span>
            </div>
            <div className="flex items-center space-x-1">
              <GitBranch className="h-4 w-4 text-green-600" />
              <span>Secondary Level</span>
            </div>
            <div className="flex items-center space-x-1">
              <Target className="h-4 w-4 text-orange-600" />
              <span>Tertiary Level</span>
            </div>
            <div className="flex items-center space-x-1">
              <Target className="h-4 w-4 text-gray-600" />
              <span>Deeper Levels</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tree Content */}
      <div className="space-y-2">
        {filteredFamilyTree.map(family => (
          <TreeNode
            key={family.id}
            family={family}
            level={0}
            searchQuery={searchQuery}
            filters={filters}
            selectedLanguageId={selectedLanguageId}
            onLanguageSelect={onLanguageSelect}
            onRefresh={onRefresh}
            expandAll={expandAll}
            collapseAll={collapseAll}
          />
        ))}
      </div>
    </div>
  );
}
