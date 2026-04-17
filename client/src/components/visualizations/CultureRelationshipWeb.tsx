import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NetworkGraph, type NetworkGraphNode } from './shared/NetworkGraph';
import {
  buildCultureRelationshipGraph,
  computeTimeBounds,
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
  type BattleLite,
  type CulturalLineageLite,
  type CultureProfileLite,
  type CultureRelationshipLink,
  type LanguageContactLite,
  type RelationshipType,
  type TradeRouteLite,
} from '../../lib/visualization/culture-relationship-web';

interface Props {
  isOpen?: boolean;
  onCultureSelect?: (cultureId: string) => void;
}

const ALL_TYPES: RelationshipType[] = [
  'lineage',
  'linguistic',
  'trade',
  'conflict',
  'religious',
];

function formatYear(year: number): string {
  if (!Number.isFinite(year)) return '?';
  const rounded = Math.round(year);
  return rounded < 0 ? `${Math.abs(rounded)} BCE` : `${rounded} CE`;
}

export function CultureRelationshipWeb({ isOpen = true, onCultureSelect }: Props) {
  const [enabled, setEnabled] = useState<Set<RelationshipType>>(new Set(ALL_TYPES));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sliderRange, setSliderRange] = useState<[number, number] | null>(null);

  const profilesQuery = useQuery<{ profiles: CultureProfileLite[] }>({
    queryKey: ['/api/culture-profiles'],
    enabled: isOpen,
  });
  const lineagesQuery = useQuery<{ lineages: CulturalLineageLite[] }>({
    queryKey: ['/api/cultural-lineages'],
    enabled: isOpen,
  });
  const contactsQuery = useQuery<{ contacts: LanguageContactLite[] }>({
    queryKey: ['/api/language-contacts'],
    enabled: isOpen,
  });
  const routesQuery = useQuery<{ routes: TradeRouteLite[] }>({
    queryKey: ['/api/trade-routes'],
    enabled: isOpen,
  });
  const battlesQuery = useQuery<{ battles: BattleLite[] }>({
    queryKey: ['/api/battles'],
    enabled: isOpen,
  });

  const isLoading =
    profilesQuery.isLoading ||
    lineagesQuery.isLoading ||
    contactsQuery.isLoading ||
    routesQuery.isLoading ||
    battlesQuery.isLoading;

  const profiles = profilesQuery.data?.profiles ?? [];
  const lineages = lineagesQuery.data?.lineages ?? [];
  const contacts = contactsQuery.data?.contacts ?? [];
  const routes = routesQuery.data?.routes ?? [];
  const battles = battlesQuery.data?.battles ?? [];

  const timeBounds = useMemo(
    () => computeTimeBounds({ profiles, lineages, tradeRoutes: routes, battles }),
    [profiles, lineages, routes, battles],
  );

  const activeRange: [number, number] = sliderRange ?? [timeBounds.start, timeBounds.end];

  const graph = useMemo(
    () =>
      buildCultureRelationshipGraph({
        profiles,
        lineages,
        languageContacts: contacts,
        tradeRoutes: routes,
        battles,
        enabledTypes: enabled,
        timeRange: { start: activeRange[0], end: activeRange[1] },
      }),
    [profiles, lineages, contacts, routes, battles, enabled, activeRange],
  );

  const toggleType = (t: RelationshipType) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const selectedNode = selectedId
    ? graph.nodes.find((n) => n.id === selectedId) ?? null
    : null;

  const selectedRelationships: CultureRelationshipLink[] = useMemo(() => {
    if (!selectedId) return [];
    return graph.links.filter(
      (l) =>
        (typeof l.source === 'string' ? l.source : l.source.id) === selectedId ||
        (typeof l.target === 'string' ? l.target : l.target.id) === selectedId,
    );
  }, [graph.links, selectedId]);

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full" data-testid="culture-relationship-web">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-white flex-shrink-0">
        <span className="text-sm font-medium text-gray-700">Relationships:</span>
        {ALL_TYPES.map((t) => {
          const active = enabled.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? 'bg-white text-gray-800 border-gray-300 shadow-sm'
                  : 'bg-gray-100 text-gray-400 border-transparent'
              }`}
              data-testid={`toggle-${t}`}
              aria-pressed={active}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: RELATIONSHIP_COLORS[t], opacity: active ? 1 : 0.4 }}
              />
              {RELATIONSHIP_LABELS[t]}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          <span>{graph.nodes.length} cultures</span>
          <span>·</span>
          <span>{graph.links.length} links</span>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-b bg-gray-50 text-xs flex-shrink-0">
        <span className="font-medium text-gray-600">Time:</span>
        <span className="tabular-nums text-gray-700 w-20">{formatYear(activeRange[0])}</span>
        <input
          type="range"
          min={timeBounds.start}
          max={timeBounds.end}
          value={activeRange[0]}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10);
            setSliderRange([Math.min(next, activeRange[1]), activeRange[1]]);
          }}
          className="flex-1 accent-indigo-500"
          aria-label="Start year"
          data-testid="range-start"
        />
        <input
          type="range"
          min={timeBounds.start}
          max={timeBounds.end}
          value={activeRange[1]}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10);
            setSliderRange([activeRange[0], Math.max(next, activeRange[0])]);
          }}
          className="flex-1 accent-indigo-500"
          aria-label="End year"
          data-testid="range-end"
        />
        <span className="tabular-nums text-gray-700 w-20 text-right">
          {formatYear(activeRange[1])}
        </span>
        <button
          type="button"
          className="px-2 py-0.5 rounded border text-gray-600 hover:bg-gray-100"
          onClick={() => setSliderRange(null)}
          data-testid="range-reset"
        >
          Reset
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading culture relationships…
          </div>
        ) : graph.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium">No cultures match these filters</p>
              <p className="text-sm mt-1">Adjust the time range or enable more relationship types</p>
            </div>
          </div>
        ) : (
          <NetworkGraph
            nodes={graph.nodes}
            links={graph.links}
            selectedNodeId={selectedId}
            nodeColorFn={(node) => (node.id === selectedId ? '#1d4ed8' : '#64748b')}
            linkColorFn={(link) => {
              const type = (link as CultureRelationshipLink).relationshipType;
              return RELATIONSHIP_COLORS[type] ?? '#cbd5e0';
            }}
            nodeRadiusFn={(node) => node.size ?? 6}
            linkDistance={110}
            chargeStrength={-260}
            onNodeClick={((node: NetworkGraphNode) => {
              setSelectedId(node.id);
              onCultureSelect?.(node.id);
            }) as (node: NetworkGraphNode) => void}
            formatTooltip={(type, datum) => {
              if (type === 'node') {
                const n = datum as { name?: string; group?: string; timePeriodStart?: number; timePeriodEnd?: number };
                const name = n.name ?? 'Culture';
                const region = n.group ?? '';
                const period =
                  n.timePeriodStart !== undefined && n.timePeriodEnd !== undefined
                    ? `${formatYear(n.timePeriodStart)} – ${formatYear(n.timePeriodEnd)}`
                    : '';
                return `${name}${region ? `\n${region}` : ''}${period ? `\n${period}` : ''}`;
              }
              const l = datum as CultureRelationshipLink;
              const source = typeof l.source === 'string' ? l.source : (l.source as any).name ?? l.source;
              const target = typeof l.target === 'string' ? l.target : (l.target as any).name ?? l.target;
              return `${source} — ${target}\n${RELATIONSHIP_LABELS[l.relationshipType]}\n${l.description}\nIntensity: ${l.intensity}`;
            }}
          />
        )}
      </div>

      {selectedNode && (
        <div
          className="border-t bg-white px-4 py-3 flex-shrink-0 max-h-48 overflow-auto"
          data-testid="relationship-detail-panel"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {selectedNode.name}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedNode.group} · {formatYear(selectedNode.timePeriodStart)} – {formatYear(selectedNode.timePeriodEnd)}
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-800"
              onClick={() => setSelectedId(null)}
              aria-label="Dismiss selection"
            >
              Close
            </button>
          </div>

          {selectedRelationships.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {selectedRelationships.slice(0, 20).map((l, idx) => {
                const srcId = typeof l.source === 'string' ? l.source : (l.source as any).id;
                const otherId = srcId === selectedNode.id
                  ? (typeof l.target === 'string' ? l.target : (l.target as any).id)
                  : srcId;
                const other = graph.nodes.find((n) => n.id === otherId);
                return (
                  <li
                    key={`${l.relationshipType}-${idx}`}
                    className="text-xs flex items-center gap-2"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: RELATIONSHIP_COLORS[l.relationshipType] }}
                    />
                    <span className="font-medium text-gray-700 w-28 flex-shrink-0 truncate">
                      {RELATIONSHIP_LABELS[l.relationshipType]}
                    </span>
                    <button
                      type="button"
                      className="text-blue-600 hover:underline truncate text-left"
                      onClick={() => other && setSelectedId(other.id)}
                    >
                      {other?.name ?? otherId}
                    </button>
                    <span className="text-gray-400 truncate">· {l.description}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-gray-500 mt-2">
              No relationships match the current filters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default CultureRelationshipWeb;
