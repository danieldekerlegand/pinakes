import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, TreePine, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { LanguageFamilyWithChildren, Language } from "@shared/schema";

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

function TreeNode({ family, level, searchQuery, filters, selectedLanguageId, onLanguageSelect }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level === 0);

  const filteredLanguages = useMemo(() => {
    return family.languages.filter(lang => {
      // Apply status filter
      if (filters.status.length > 0 && !filters.status.includes(lang.status)) {
        return false;
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

  return (
    <div className="tree-node mb-4">
      <div
        className="flex items-center p-3 hover:bg-gray-50 rounded-md cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid={`tree-node-${family.name.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {family.children.length > 0 || family.languages.length > 0 ? (
          isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400 mr-2" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400 mr-2" />
          )
        ) : (
          <div className="w-6 mr-2" />
        )}
        
        <TreePine className="h-5 w-5 text-primary mr-3" />
        
        <div className="flex-1">
          <h3 className="font-medium text-gray-900" data-testid={`text-family-name-${family.name.toLowerCase().replace(/\s+/g, '-')}`}>
            {family.name}
          </h3>
          <p className="text-sm text-gray-600">
            {formatSpeakerCount(family.totalSpeakers)} speakers • {family.languageCount} languages
          </p>
        </div>
        
        <div className="flex items-center space-x-2">
          <Badge className="language-status-living text-xs">
            Family
          </Badge>
          {family.timeOrigin && (
            <span className="text-xs text-gray-500">{family.timeOrigin}</span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="ml-8 mt-2 space-y-2">
          {/* Child Families */}
          {family.children.map(childFamily => (
            <TreeNode
              key={childFamily.id}
              family={childFamily}
              level={level + 1}
              searchQuery={searchQuery}
              filters={filters}
              selectedLanguageId={selectedLanguageId}
              onLanguageSelect={onLanguageSelect}
            />
          ))}
          
          {/* Languages */}
          {filteredLanguages.map(language => (
            <LanguageNode
              key={language.id}
              language={language}
              isSelected={selectedLanguageId === language.id}
              onSelect={() => onLanguageSelect(language.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LanguageNodeProps {
  language: Language;
  isSelected: boolean;
  onSelect: () => void;
}

function LanguageNode({ language, isSelected, onSelect }: LanguageNodeProps) {
  return (
    <div
      className={`flex items-center p-2 rounded-md cursor-pointer transition-colors ${
        isSelected ? 'bg-blue-100 border border-blue-200' : 'hover:bg-blue-50'
      }`}
      onClick={onSelect}
      data-testid={`language-node-${language.name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <Globe className="h-4 w-4 text-primary mr-3" />
      
      <div className="flex-1">
        <h5 className="text-sm font-medium text-gray-900" data-testid={`text-language-name-${language.name.toLowerCase().replace(/\s+/g, '-')}`}>
          {language.name}
        </h5>
        <p className="text-xs text-gray-600">
          {formatSpeakerCount(language.totalSpeakers)} speakers • {language.region}
        </p>
      </div>
      
      <div className="flex items-center space-x-2">
        <Badge className={`${getStatusColor(language.status)} text-xs`}>
          {language.status}
        </Badge>
        {/* Mock completion percentage */}
        <div className="flex items-center space-x-1">
          <div className="w-12 bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-success h-1.5 rounded-full"
              style={{ width: `${Math.random() * 40 + 60}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">
            {Math.floor(Math.random() * 40 + 60)}%
          </span>
        </div>
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
  );
}
