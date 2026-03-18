import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';

interface Deity {
  id: string;
  name: string;
  nativeName: string;
  mythology: string;
  domain: string[];
  equivalentDeityIds: string[];
  attributes: string[];
  symbols: string[];
  description: string;
}

interface MythMotif {
  id: string;
  name: string;
  motifType: string;
  thompsonIndex: string;
  mythologyIds: string[];
  associatedDeityIds: string[];
  region: string;
  description: string;
}

const MYTHOLOGY_COLORS: Record<string, string> = {
  'greek': '#3b82f6',
  'roman': '#ef4444',
  'norse': '#6366f1',
  'hindu': '#f59e0b',
  'egyptian': '#d97706',
  'mesopotamian': '#8b5cf6',
  'japanese': '#ec4899',
  'aztec': '#10b981',
  'slavic': '#06b6d4',
  'celtic': '#84cc16',
};

const MOTIF_TYPE_LABELS: Record<string, string> = {
  'cosmogonic': 'Creation & Cosmos',
  'cosmological': 'World Structure',
  'deity': 'Divine Figures',
  'hero': 'Heroes & Quests',
  'character': 'Archetypes',
  'object': 'Sacred Objects',
  'nature': 'Natural Cycles',
};

export function ComparativeMythologyView() {
  const [selectedMythology, setSelectedMythology] = useState<string | null>(null);
  const [selectedMotifType, setSelectedMotifType] = useState<string | null>(null);
  const [selectedDeityId, setSelectedDeityId] = useState<string | null>(null);

  const { data: deitiesData, isLoading: loadingDeities } = useQuery<{ deities: Deity[]; count: number }>({
    queryKey: ['/api/deities'],
    staleTime: 5 * 60 * 1000,
  });

  const { data: motifsData, isLoading: loadingMotifs } = useQuery<{ motifs: MythMotif[]; count: number }>({
    queryKey: ['/api/myth-motifs'],
    staleTime: 5 * 60 * 1000,
  });

  const deities = deitiesData?.deities ?? [];
  const motifs = motifsData?.motifs ?? [];

  // Unique mythologies from deities
  const mythologies = useMemo(() => {
    const set = new Set(deities.map((d) => d.mythology));
    return Array.from(set).sort();
  }, [deities]);

  // Unique motif types
  const motifTypes = useMemo(() => {
    const set = new Set(motifs.map((m) => m.motifType));
    return Array.from(set).sort();
  }, [motifs]);

  // Build equivalence groups
  const equivalenceGroups = useMemo(() => {
    const deityMap = new Map(deities.map((d) => [d.id, d]));
    const visited = new Set<string>();
    const groups: Deity[][] = [];

    for (const deity of deities) {
      if (visited.has(deity.id)) continue;
      if (deity.equivalentDeityIds.length === 0) continue;

      const group = [deity];
      visited.add(deity.id);

      for (const eqId of deity.equivalentDeityIds) {
        const eq = deityMap.get(eqId);
        if (eq && !visited.has(eq.id)) {
          group.push(eq);
          visited.add(eq.id);
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    return groups.sort((a, b) => b.length - a.length);
  }, [deities]);

  // Filter motifs
  const filteredMotifs = useMemo(() => {
    let result = motifs;
    if (selectedMotifType) {
      result = result.filter((m) => m.motifType === selectedMotifType);
    }
    if (selectedMythology) {
      result = result.filter((m) => m.mythologyIds.includes(selectedMythology));
    }
    return result;
  }, [motifs, selectedMotifType, selectedMythology]);

  // Selected deity details with equivalents
  const selectedDeityDetails = useMemo(() => {
    if (!selectedDeityId) return null;
    const deity = deities.find((d) => d.id === selectedDeityId);
    if (!deity) return null;
    const equivalents = deities.filter((d) => deity.equivalentDeityIds.includes(d.id));
    const relatedMotifs = motifs.filter((m) => m.associatedDeityIds.includes(deity.id));
    return { deity, equivalents, relatedMotifs };
  }, [selectedDeityId, deities, motifs]);

  // Mythology cross-reference matrix: which motifs appear in which mythologies
  const motifMatrix = useMemo(() => {
    const matrix: Record<string, Set<string>> = {};
    for (const motif of motifs) {
      for (const mythId of motif.mythologyIds) {
        if (!matrix[mythId]) matrix[mythId] = new Set();
        matrix[mythId].add(motif.id);
      }
    }
    return matrix;
  }, [motifs]);

  if (loadingDeities || loadingMotifs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500">Loading mythology data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <h2 className="text-2xl font-bold">Comparative Mythology</h2>
      <p className="text-gray-600 text-sm">
        Explore cross-cultural deity equivalences and shared mythological motifs across traditions.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          className={`px-3 py-1 rounded-full text-sm border ${
            !selectedMythology ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'
          }`}
          onClick={() => setSelectedMythology(null)}
        >
          All Traditions
        </button>
        {mythologies.map((myth) => (
          <button
            key={myth}
            className={`px-3 py-1 rounded-full text-sm border capitalize ${
              selectedMythology === myth ? 'text-white' : 'bg-white text-gray-700'
            }`}
            style={selectedMythology === myth ? { backgroundColor: MYTHOLOGY_COLORS[myth] || '#6b7280' } : {}}
            onClick={() => setSelectedMythology(selectedMythology === myth ? null : myth)}
          >
            {myth}
          </button>
        ))}
      </div>

      {/* Deity Equivalence Groups */}
      <section>
        <h3 className="text-lg font-semibold mb-3">Deity Equivalence Groups</h3>
        <p className="text-sm text-gray-500 mb-3">
          Deities across cultures sharing similar roles and attributes, connected by dashed lines on the map.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {equivalenceGroups
            .filter((group) => !selectedMythology || group.some((d) => d.mythology === selectedMythology))
            .map((group, idx) => {
              const sharedDomains = group[0].domain.filter((d) =>
                group.every((deity) => deity.domain.includes(d))
              );
              return (
                <div
                  key={idx}
                  className="border rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedDeityId(group[0].id)}
                >
                  <div className="flex flex-wrap gap-1 mb-2">
                    {sharedDomains.map((d) => (
                      <Badge key={d} variant="secondary" className="text-xs capitalize">{d}</Badge>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {group.map((deity) => (
                      <div key={deity.id} className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: MYTHOLOGY_COLORS[deity.mythology] || '#6b7280' }}
                        />
                        <span className="font-medium text-sm">{deity.name}</span>
                        <span className="text-xs text-gray-400 capitalize">({deity.mythology})</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* Selected Deity Detail */}
      {selectedDeityDetails && (
        <section className="border rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold">{selectedDeityDetails.deity.name}</h3>
              {selectedDeityDetails.deity.nativeName !== selectedDeityDetails.deity.name && (
                <p className="text-sm text-gray-500">{selectedDeityDetails.deity.nativeName}</p>
              )}
            </div>
            <Badge
              variant="outline"
              className="capitalize"
              style={{
                borderColor: MYTHOLOGY_COLORS[selectedDeityDetails.deity.mythology] || '#6b7280',
                color: MYTHOLOGY_COLORS[selectedDeityDetails.deity.mythology] || '#6b7280',
              }}
            >
              {selectedDeityDetails.deity.mythology}
            </Badge>
          </div>

          <p className="text-sm text-gray-600 mb-3">{selectedDeityDetails.deity.description}</p>

          <div className="grid grid-cols-2 gap-4 text-sm mb-3">
            <div>
              <span className="font-medium text-gray-500">Domains:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedDeityDetails.deity.domain.map((d) => (
                  <Badge key={d} variant="secondary" className="text-xs capitalize">{d}</Badge>
                ))}
              </div>
            </div>
            <div>
              <span className="font-medium text-gray-500">Symbols:</span>
              <p className="mt-1">{selectedDeityDetails.deity.symbols.join(', ')}</p>
            </div>
          </div>

          {selectedDeityDetails.equivalents.length > 0 && (
            <div className="mb-3">
              <span className="font-medium text-gray-500 text-sm">Cross-cultural Equivalents:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {selectedDeityDetails.equivalents.map((eq) => (
                  <button
                    key={eq.id}
                    className="flex items-center gap-1 px-2 py-1 border rounded text-sm hover:bg-gray-100"
                    onClick={() => setSelectedDeityId(eq.id)}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: MYTHOLOGY_COLORS[eq.mythology] || '#6b7280' }}
                    />
                    {eq.name}
                    <span className="text-xs text-gray-400 capitalize">({eq.mythology})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedDeityDetails.relatedMotifs.length > 0 && (
            <div>
              <span className="font-medium text-gray-500 text-sm">Associated Motifs:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedDeityDetails.relatedMotifs.map((m) => (
                  <Badge key={m.id} variant="outline" className="text-xs">{m.name}</Badge>
                ))}
              </div>
            </div>
          )}

          <button
            className="mt-3 text-xs text-gray-400 hover:text-gray-600"
            onClick={() => setSelectedDeityId(null)}
          >
            Close
          </button>
        </section>
      )}

      {/* Shared Motifs Section */}
      <section>
        <h3 className="text-lg font-semibold mb-3">Mythological Motifs</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            className={`px-3 py-1 rounded-full text-sm border ${
              !selectedMotifType ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'
            }`}
            onClick={() => setSelectedMotifType(null)}
          >
            All Types
          </button>
          {motifTypes.map((type) => (
            <button
              key={type}
              className={`px-3 py-1 rounded-full text-sm border ${
                selectedMotifType === type ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'
              }`}
              onClick={() => setSelectedMotifType(selectedMotifType === type ? null : type)}
            >
              {MOTIF_TYPE_LABELS[type] || type}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filteredMotifs.map((motif) => (
            <div key={motif.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-medium">{motif.name}</h4>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {MOTIF_TYPE_LABELS[motif.motifType] || motif.motifType}
                  </Badge>
                  <span className="text-xs text-gray-400">{motif.thompsonIndex}</span>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-2">{motif.description}</p>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-400 mr-1">Found in:</span>
                {motif.mythologyIds.map((mythId) => (
                  <span
                    key={mythId}
                    className="w-3 h-3 rounded-full inline-block"
                    style={{ backgroundColor: MYTHOLOGY_COLORS[mythId] || '#6b7280' }}
                    title={mythId}
                  />
                ))}
                <span className="text-xs text-gray-400 ml-1">({motif.region})</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Cross-Reference Matrix */}
      <section>
        <h3 className="text-lg font-semibold mb-3">Motif Distribution Matrix</h3>
        <p className="text-sm text-gray-500 mb-3">
          Shows how many mythological motifs are shared between traditions.
        </p>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="p-2 text-left" />
                {Object.keys(motifMatrix).sort().map((myth) => (
                  <th key={myth} className="p-2 capitalize text-center">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                      style={{ backgroundColor: MYTHOLOGY_COLORS[myth] || '#6b7280' }}
                    />
                    {myth}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(motifMatrix).sort().map((rowMyth) => (
                <tr key={rowMyth}>
                  <td className="p-2 font-medium capitalize">{rowMyth}</td>
                  {Object.keys(motifMatrix).sort().map((colMyth) => {
                    const shared = new Set(
                      [...(motifMatrix[rowMyth] ?? [])].filter((m) => motifMatrix[colMyth]?.has(m))
                    );
                    const count = shared.size;
                    const maxCount = Math.max(...Object.values(motifMatrix).map((s) => s.size));
                    const intensity = maxCount > 0 ? count / maxCount : 0;
                    return (
                      <td
                        key={colMyth}
                        className="p-2 text-center border"
                        style={{
                          backgroundColor: rowMyth === colMyth
                            ? '#f3f4f6'
                            : `rgba(59, 130, 246, ${intensity * 0.6})`,
                          color: intensity > 0.4 && rowMyth !== colMyth ? 'white' : 'inherit',
                        }}
                      >
                        {count}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default ComparativeMythologyView;
