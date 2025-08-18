import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  ChevronRight, 
  ChevronDown, 
  TreePine, 
  Globe, 
  Network, 
  GitBranch, 
  Target, 
  Layers,
  Users,
  FileText,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { LanguageFamilyWithChildren, Language, LanguageWithVariants } from "@shared/schema";

interface LanguageTreeProps {
  searchQuery: string;
  filters: {
    status: string[];
    region: string;
    speakers: string;
  };
  selectedLanguageId: string | null;
  onLanguageSelect: (languageId: string) => void;
}

interface TreeNodeProps {
  family: LanguageFamilyWithChildren;
  level: number;
  searchQuery: string;
  filters: any;
  selectedLanguageId: string | null;
  onLanguageSelect: (languageId: string) => void;
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

function getTaxonomyIcon(taxonomicLevel: string) {
  switch (taxonomicLevel.toLowerCase()) {
    case 'phylum': return Network;
    case 'family': return TreePine;
    case 'subfamily': return GitBranch;
    case 'branch': return Target;
    case 'group': return Layers;
    case 'complex': return Users;
    default: return TreePine;
  }
}

function getTaxonomyColor(taxonomicLevel: string) {
  switch (taxonomicLevel.toLowerCase()) {
    case 'phylum': return 'text-purple-600 bg-purple-100';
    case 'family': return 'text-blue-600 bg-blue-100';
    case 'subfamily': return 'text-green-600 bg-green-100';
    case 'branch': return 'text-orange-600 bg-orange-100';
    case 'group': return 'text-red-600 bg-red-100';
    case 'complex': return 'text-indigo-600 bg-indigo-100';
    default: return 'text-gray-600 bg-gray-100';
  }
}

function TreeNode({ family, level, searchQuery, filters, selectedLanguageId, onLanguageSelect }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level === 0);

  const filteredLanguages = useMemo(() => {
    return family.languages.filter((lang: LanguageWithVariants) => {
      // Apply status filter
      if (filters.status.length > 0 && !filters.status.includes(lang.status)) {
        return false;
      }
      
      // Apply region filter
      if (filters.region && filters.region !== "all-regions") {
        const langRegions = Array.isArray(lang.region) ? lang.region : [lang.region];
        if (!langRegions.some((r: string) => r.toLowerCase().includes(filters.region.toLowerCase()))) {
          return false;
        }
      }
      
      // Apply search filter
      if (searchQuery && !lang.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !lang.nativeName?.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      
      return true;
    });
  }, [family.languages, searchQuery, filters]);

  const hasVisibleContent = filteredLanguages.length > 0 || family.children.length > 0;
  
  if (!hasVisibleContent) return null;

  const TaxonomyIcon = getTaxonomyIcon(family.taxonomicLevel || 'family');
  const colorClasses = getTaxonomyColor(family.taxonomicLevel || 'family');

  return (
    <div className="tree-node mb-2">
      {/* Family Header */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div
          className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
          data-testid={`tree-node-${family.name.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${colorClasses}`}>
              <TaxonomyIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{family.name}</h3>
              <p className="text-sm text-gray-500 capitalize">{family.taxonomicLevel || 'family'}</p>
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
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </div>
        </div>
        
        {/* Languages and Children */}
        {isExpanded && (
          <div className="border-t border-gray-100">
            {/* Languages */}
            {filteredLanguages.length > 0 && (
              <div className="p-4 space-y-3">
                {filteredLanguages.map((language: LanguageWithVariants) => (
                  <div key={language.id} className="language-item">
                    <div
                      className={`flex items-center justify-between p-3 rounded-lg border hover:shadow-sm cursor-pointer transition-colors ${
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
            
            {/* Subfamilies */}
            {family.children.length > 0 && (
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
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}



export default function LanguageTree({ searchQuery, filters, selectedLanguageId, onLanguageSelect }: LanguageTreeProps) {
  const { data: familyTree, isLoading } = useQuery<LanguageFamilyWithChildren[]>({
    queryKey: ['/api/language-families/tree'],
  });

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

  if (!familyTree?.length) {
    return (
      <div className="text-center py-8">
        <TreePine className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600">No language families found.</p>
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
              <p className="text-sm text-gray-600">Taxonomic hierarchy with dialects and variants</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            <div className="flex items-center space-x-1">
              <Network className="h-4 w-4 text-purple-600" />
              <span>Phylum</span>
            </div>
            <div className="flex items-center space-x-1">
              <TreePine className="h-4 w-4 text-blue-600" />
              <span>Family</span>
            </div>
            <div className="flex items-center space-x-1">
              <GitBranch className="h-4 w-4 text-green-600" />
              <span>Subfamily</span>
            </div>
            <div className="flex items-center space-x-1">
              <Target className="h-4 w-4 text-orange-600" />
              <span>Branch</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tree Content */}
      <div className="space-y-2">
        {familyTree.map(family => (
          <TreeNode
            key={family.id}
            family={family}
            level={0}
            searchQuery={searchQuery}
            filters={filters}
            selectedLanguageId={selectedLanguageId}
            onLanguageSelect={onLanguageSelect}
          />
        ))}
      </div>
    </div>
  );
}
