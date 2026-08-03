import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, ArrowRight, Globe, Clock, Languages, Link2 } from 'lucide-react';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';

// Types matching the server's UnifiedEntity and EntityRelationship
interface UnifiedEntity {
  id: string;
  name: string;
  nativeName?: string;
  entityType: string;
  region?: string;
  coordinates?: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  description?: string;
}

interface EntityRelationship {
  source: UnifiedEntity;
  target: UnifiedEntity;
  relationshipType: string;
  strength: number;
  sharedAttributes: string[];
}

interface SummaryData {
  totalEntities: number;
  byType: Record<string, number>;
  languageCoverage: number;
  temporalRange: { min: number; max: number };
}

// Color palette for entity types
const ENTITY_COLORS: Record<string, string> = {
  'cuisine': '#f59e0b',
  'music-tradition': '#c026d3',
  'religion': '#2563eb',
  'haplogroup': '#16a34a',
  'civilization': '#dc2626',
  'archaeological-site': '#ea580c',
  'language-range': '#0891b2',
  'musical-instrument': '#7c3aed',
  'cuisine-item': '#d97706',
};

const ENTITY_LABELS: Record<string, string> = {
  'cuisine': 'Cuisine',
  'music-tradition': 'Music',
  'religion': 'Religion',
  'haplogroup': 'Haplogroup',
  'civilization': 'Civilization',
  'archaeological-site': 'Archaeology',
  'language-range': 'Language Range',
  'musical-instrument': 'Instrument',
  'cuisine-item': 'Food',
};

const formatYear = (year: number | null): string => {
  if (year === null) return '—';
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
};

// Entity Card Component
function EntityCard({
  entity,
  onSelect,
  isSelected,
  compact = false,
}: {
  entity: UnifiedEntity;
  onSelect: (entity: UnifiedEntity) => void;
  isSelected: boolean;
  compact?: boolean;
}) {
  const color = ENTITY_COLORS[entity.entityType] || '#6b7280';
  const label = ENTITY_LABELS[entity.entityType] || entity.entityType;

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-200' : 'bg-white hover:bg-gray-50 border-gray-200'
      }`}
      onClick={() => onSelect(entity)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-sm truncate">{entity.name}</h4>
            <Badge
              variant="outline"
              className="text-xs shrink-0"
              style={{ borderColor: color, color }}
            >
              {label}
            </Badge>
          </div>
          {entity.nativeName && entity.nativeName !== entity.name && (
            <p className="text-xs text-gray-500 mb-1">{entity.nativeName}</p>
          )}
          {!compact && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
              {entity.region && (
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {entity.region}
                </span>
              )}
              {entity.timeOrigin !== null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatYear(entity.timeOrigin)}
                  {entity.timeEnd !== null && ` – ${formatYear(entity.timeEnd)}`}
                </span>
              )}
              {entity.associatedLanguageIds.length > 0 && (
                <span className="flex items-center gap-1">
                  <Languages className="h-3 w-3" />
                  {entity.associatedLanguageIds.slice(0, 3).join(', ')}
                  {entity.associatedLanguageIds.length > 3 && ` +${entity.associatedLanguageIds.length - 3}`}
                </span>
              )}
            </div>
          )}
        </div>
        <ArrowRight className="h-4 w-4 text-gray-400 shrink-0 mt-1" />
      </div>
    </div>
  );
}

// Relationship Card Component
function RelationshipCard({ relationship }: { relationship: EntityRelationship }) {
  const targetColor = ENTITY_COLORS[relationship.target.entityType] || '#6b7280';
  const targetLabel = ENTITY_LABELS[relationship.target.entityType] || relationship.target.entityType;
  const strengthPercent = Math.round(relationship.strength * 100);

  return (
    <div className="p-3 rounded-lg border bg-white border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-gray-400" />
          <span className="font-medium text-sm">{relationship.target.name}</span>
          <Badge variant="outline" className="text-xs" style={{ borderColor: targetColor, color: targetColor }}>
            {targetLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${strengthPercent}%`,
                backgroundColor: strengthPercent > 70 ? '#16a34a' : strengthPercent > 40 ? '#f59e0b' : '#94a3b8',
              }}
            />
          </div>
          <span className="text-xs text-gray-500 w-8 text-right">{strengthPercent}%</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {relationship.sharedAttributes.map((attr, i) => (
          <Badge key={i} variant="secondary" className="text-xs">
            {attr}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// Main CrossDomainExplorer Component
export function CrossDomainExplorer() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<UnifiedEntity | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search input
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    const timeout = setTimeout(() => setDebouncedQuery(value), 300);
    return () => clearTimeout(timeout);
  }, []);

  // Fetch summary
  const { data: summary } = useQuery<SummaryData>({
    queryKey: ['/api/cross-domain/summary'],
    staleTime: 60 * 1000,
  });

  // Fetch search results
  const { data: searchResults, isLoading: searchLoading } = useQuery<{
    entities: UnifiedEntity[];
    count: number;
  }>({
    queryKey: ['/api/cross-domain/search', { q: debouncedQuery }],
    enabled: debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  // Fetch connections for selected entity
  const { data: connections, isLoading: connectionsLoading } = useQuery<{
    relationships: EntityRelationship[];
    count: number;
  }>({
    queryKey: [
      `/api/cross-domain/connections/${selectedEntity?.entityType}/${selectedEntity?.id}`,
    ],
    enabled: !!selectedEntity,
    staleTime: 30 * 1000,
  });

  // Fetch all entities for browsing when no search
  const { data: allEntities } = useQuery<{
    entities: UnifiedEntity[];
    count: number;
  }>({
    queryKey: ['/api/cross-domain/entities'],
    staleTime: 60 * 1000,
    enabled: debouncedQuery.length < 2,
  });

  const displayEntities = useMemo(() => {
    if (debouncedQuery.length >= 2 && searchResults) {
      return searchResults.entities;
    }
    return allEntities?.entities ?? [];
  }, [debouncedQuery, searchResults, allEntities]);

  const handleEntitySelect = useCallback((entity: UnifiedEntity) => {
    setSelectedEntity((prev) =>
      prev?.id === entity.id && prev?.entityType === entity.entityType ? null : entity
    );
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Summary Bar */}
      {summary && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-gradient-to-r from-blue-50 to-purple-50 border-b text-sm">
          <span className="font-semibold text-gray-700">
            {summary.totalEntities} entities
          </span>
          <span className="text-gray-500">|</span>
          {Object.entries(summary.byType).map(([type, count]) => (
            <span key={type} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: ENTITY_COLORS[type] || '#6b7280' }}
              />
              <span className="text-gray-600">
                {ENTITY_LABELS[type] || type}: {count}
              </span>
            </span>
          ))}
          <span className="text-gray-500">|</span>
          <span className="text-gray-600">
            {summary.languageCoverage} languages
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left Panel: Search & Browse */}
        <div className="w-1/2 border-r flex flex-col">
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search across all domains (e.g., 'latin', 'india', 'percussion')"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {debouncedQuery.length >= 2
                ? `${searchResults?.count ?? '...'} results for "${debouncedQuery}"`
                : `Showing all ${displayEntities.length} entities — type to search`}
            </p>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {searchLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : displayEntities.length === 0 ? (
                <p className="text-center text-gray-500 py-12">
                  {debouncedQuery.length >= 2
                    ? 'No results found'
                    : 'Loading entities...'}
                </p>
              ) : (
                displayEntities.map((entity) => (
                  <EntityCard
                    key={`${entity.entityType}-${entity.id}`}
                    entity={entity}
                    onSelect={handleEntitySelect}
                    isSelected={
                      selectedEntity?.id === entity.id &&
                      selectedEntity?.entityType === entity.entityType
                    }
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel: Connections */}
        <div className="w-1/2 flex flex-col bg-gray-50">
          {selectedEntity ? (
            <>
              <div className="p-4 border-b bg-white">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-bold text-lg">{selectedEntity.name}</h3>
                  <Badge
                    style={{
                      backgroundColor: ENTITY_COLORS[selectedEntity.entityType] || '#6b7280',
                      color: 'white',
                    }}
                  >
                    {ENTITY_LABELS[selectedEntity.entityType] || selectedEntity.entityType}
                  </Badge>
                </div>
                {selectedEntity.nativeName && selectedEntity.nativeName !== selectedEntity.name && (
                  <p className="text-sm text-gray-600 mb-2">{selectedEntity.nativeName}</p>
                )}
                <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                  {selectedEntity.region && (
                    <span className="flex items-center gap-1">
                      <Globe className="h-3.5 w-3.5" />
                      {selectedEntity.region}
                    </span>
                  )}
                  {selectedEntity.timeOrigin !== null && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {formatYear(selectedEntity.timeOrigin)}
                      {selectedEntity.timeEnd !== null && ` – ${formatYear(selectedEntity.timeEnd)}`}
                    </span>
                  )}
                </div>
                {selectedEntity.description && (
                  <p className="text-sm text-gray-500 mt-2">{selectedEntity.description}</p>
                )}
                {selectedEntity.associatedLanguageIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedEntity.associatedLanguageIds.map((lang) => (
                      <Badge key={lang} variant="outline" className="text-xs">
                        {lang}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 border-b bg-white">
                <h4 className="font-semibold text-sm text-gray-700 mb-1">
                  Cross-Domain Connections
                  {connections && (
                    <span className="font-normal text-gray-500 ml-1">
                      ({connections.count} found)
                    </span>
                  )}
                </h4>
                <p className="text-xs text-gray-500">
                  Entities connected through shared languages, regions, or time periods
                </p>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {connectionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                    </div>
                  ) : connections?.relationships.length === 0 ? (
                    <p className="text-center text-gray-500 py-12">
                      No connections found
                    </p>
                  ) : (
                    connections?.relationships.map((rel, i) => (
                      <RelationshipCard key={i} relationship={rel} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-sm">
                <Link2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="font-semibold text-gray-600 mb-2">
                  Cross-Domain Explorer
                </h3>
                <p className="text-sm text-gray-500">
                  Select an entity from the left panel to discover its connections
                  across cuisines, music, religions, haplogroups, civilizations,
                  and more.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CrossDomainExplorer;
