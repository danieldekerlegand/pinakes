import React, { useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useQuery } from '@tanstack/react-query';
import { TreeVisualization, type TreeNodeData, type TreeVisualizationConfig } from './shared/TreeVisualization';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { X, Calendar, MapPin, Globe, Type } from 'lucide-react';

interface WritingSystem {
  id: string;
  name: string;
  type: string;
  direction: string;
  parentSystemId: string;
  languageIds: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  alphabet: '#3b82f6',
  abjad: '#10b981',
  abugida: '#f59e0b',
  syllabary: '#8b5cf6',
  logographic: '#ef4444',
  featural: '#ec4899',
};

const TYPE_LABELS: Record<string, string> = {
  alphabet: 'Alphabet',
  abjad: 'Abjad',
  abugida: 'Abugida',
  syllabary: 'Syllabary',
  logographic: 'Logographic',
  featural: 'Featural',
};

function formatOriginDate(date: string): string {
  if (date.startsWith('-')) return date.slice(1) + ' BCE';
  return date + ' CE';
}

export function WritingSystemEvolutionView() {
  const [selectedSystem, setSelectedSystem] = useState<WritingSystem | null>(null);
  const [tooltip, setTooltip] = useState<{
    node: TreeNodeData | null;
    x: number;
    y: number;
    visible: boolean;
  }>({ node: null, x: 0, y: 0, visible: false });

  const { data: systemsResponse, isLoading } = useQuery<{ systems: WritingSystem[]; count: number }>({
    queryKey: ['/api/writing-systems'],
  });

  const systems = systemsResponse?.systems || [];

  // Build tree from flat parent-child data
  const treeData = useMemo(() => {
    if (systems.length === 0) return null;

    const nodeMap = new Map<string, TreeNodeData & { _system: WritingSystem }>();

    systems.forEach(function (sys) {
      nodeMap.set(sys.id, {
        id: sys.id,
        label: sys.name,
        parentId: sys.parentSystemId || null,
        children: [],
        metadata: {
          type: sys.type,
          direction: sys.direction,
          originDate: sys.originDate,
          originRegion: sys.originRegion,
          sampleCharacters: sys.sampleCharacters,
          characterCount: sys.characterCount,
          isActive: sys.isActive,
        },
        _system: sys,
      });
    });

    const roots: Array<TreeNodeData & { _system: WritingSystem }> = [];
    nodeMap.forEach(function (node) {
      const parentId = node.parentId;
      if (parentId && nodeMap.has(parentId)) {
        nodeMap.get(parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });

    if (roots.length === 1) return roots[0] as TreeNodeData;
    return {
      id: 'root',
      label: 'Writing Systems',
      children: roots,
      metadata: { type: 'root', isActive: true },
    } as TreeNodeData;
  }, [systems]);

  // Build a lookup from id to system for detail panel
  const systemMap = useMemo(() => {
    const map = new Map<string, WritingSystem>();
    systems.forEach(function (sys) { map.set(sys.id, sys); });
    return map;
  }, [systems]);

  const getNodeColor = useCallback(function (node: TreeNodeData): string {
    const type = node.metadata?.type as string;
    if (type === 'root') return '#6b7280';
    return TYPE_COLORS[type] || '#6b7280';
  }, []);

  const getNodeRadius = useCallback(function (node: TreeNodeData, depth: number): number {
    if (node.metadata?.type === 'root') return 6;
    return node.metadata?.isActive ? 8 : 6;
  }, []);

  const getSubLabel = useCallback(function (node: TreeNodeData): string | undefined {
    const chars = node.metadata?.sampleCharacters as string;
    if (!chars || node.id === 'root') return undefined;
    return chars.length > 15 ? chars.substring(0, 15) + '…' : chars;
  }, []);

  const handleNodeClick = useCallback(function (node: TreeNodeData) {
    if (node.id === 'root') return;
    const sys = systemMap.get(node.id);
    if (sys) setSelectedSystem(sys);
  }, [systemMap]);

  const renderNodeTooltip = useCallback(function (node: TreeNodeData): React.ReactNode {
    if (node.id === 'root') return <div className="font-semibold">Writing Systems Root</div>;
    const type = node.metadata?.type as string;
    const region = node.metadata?.originRegion as string;
    const date = node.metadata?.originDate as string;
    const chars = node.metadata?.sampleCharacters as string;
    return (
      <div>
        <div className="font-semibold">{node.label}</div>
        <div className="text-muted-foreground">
          Type: {TYPE_LABELS[type] || type}
        </div>
        {region && <div className="text-muted-foreground">Origin: {region}</div>}
        {date && <div className="text-muted-foreground">Date: {formatOriginDate(date)}</div>}
        {chars && <div className="mt-1 font-mono text-base">{chars.substring(0, 20)}</div>}
        <div className="text-xs text-blue-600 mt-1">Click for details</div>
      </div>
    );
  }, []);

  const legendItems = useMemo(() => {
    const typesInData = new Set<string>();
    systems.forEach(function (sys) { typesInData.add(sys.type); });
    return Array.from(typesInData).sort().map(function (type) {
      return { label: TYPE_LABELS[type] || type, color: TYPE_COLORS[type] || '#6b7280' };
    });
  }, [systems]);

  const config = useMemo<TreeVisualizationConfig<TreeNodeData>>(() => ({
    getChildren: (d) => d.children,
    getId: (d) => d.id,
    // Render the (possibly synthetic) root too, matching the prior behavior.
    skipRoot: false,
    linkOffsetX: 150,
    linkOffsetY: 50,
  }), []);

  const renderNodes = useCallback(
    (
      nodeGroup: d3.Selection<SVGGElement, d3.HierarchyPointNode<TreeNodeData>, SVGGElement, unknown>,
    ) => {
      nodeGroup
        .append('circle')
        .attr('r', (d) => getNodeRadius(d.data, d.depth))
        .attr('fill', (d) => getNodeColor(d.data))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2);

      nodeGroup
        .append('text')
        .attr('dy', '.31em')
        .attr('x', (d) => (d.children ? -12 : 12))
        .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
        .text((d) => d.data.label)
        .attr('font-size', '12px')
        .attr('font-weight', 500)
        .attr('fill', '#1f2937');

      nodeGroup
        .append('text')
        .attr('dy', '1.5em')
        .attr('x', (d) => (d.children ? -12 : 12))
        .attr('text-anchor', (d) => (d.children ? 'end' : 'start'))
        .text((d) => getSubLabel(d.data) ?? '')
        .attr('font-size', '10px')
        .attr('font-family', 'serif')
        .attr('fill', '#9ca3af');

      nodeGroup
        .style('cursor', 'pointer')
        .on('click', function (event, d) {
          event.stopPropagation();
          handleNodeClick(d.data);
        })
        .on('mouseover', function (event, d) {
          setTooltip({ node: d.data, x: event.pageX, y: event.pageY - 10, visible: true });
        })
        .on('mousemove', function (event) {
          setTooltip((prev) => ({ ...prev, x: event.pageX, y: event.pageY - 10 }));
        })
        .on('mouseout', function () {
          setTooltip((prev) => ({ ...prev, visible: false }));
        });
    },
    [getNodeColor, getNodeRadius, getSubLabel, handleNodeClick],
  );

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        Loading writing systems…
      </div>
    );
  }

  if (!treeData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        No writing system data available
      </div>
    );
  }

  return (
    <div className="w-full h-full flex">
      <div className={`flex-1 min-w-0 ${selectedSystem ? 'border-r' : ''}`}>
        <TreeVisualization<TreeNodeData>
          data={treeData}
          config={config}
          renderNodes={renderNodes}
          helpText="Click a script for details • Scroll to zoom • Drag to pan"
        >
          {/* Legend */}
          <div className="absolute top-2 right-2 bg-white/90 border rounded p-2 text-xs space-y-1">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          {/* Hover tooltip */}
          {tooltip.visible && tooltip.node && (
            <div
              className="fixed z-50 pointer-events-none bg-white border rounded shadow-lg p-2 text-sm max-w-xs"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              {renderNodeTooltip(tooltip.node)}
            </div>
          )}
        </TreeVisualization>
      </div>

      {/* Detail panel */}
      {selectedSystem && (
        <div className="w-[320px] flex-shrink-0 overflow-y-auto bg-gray-50 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">{selectedSystem.name}</h3>
            <button
              onClick={function () { setSelectedSystem(null); }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge style={{ backgroundColor: TYPE_COLORS[selectedSystem.type] || '#6b7280' }} className="text-white">
              {TYPE_LABELS[selectedSystem.type] || selectedSystem.type}
            </Badge>
            <Badge variant="outline">{selectedSystem.direction}</Badge>
            <Badge variant={selectedSystem.isActive ? 'default' : 'secondary'}>
              {selectedSystem.isActive ? 'Active' : 'Historical'}
            </Badge>
          </div>

          {/* Sample characters */}
          <Card className="p-4 bg-white">
            <p className="text-xs text-gray-500 mb-2">Sample Characters</p>
            <p
              className="text-2xl font-serif leading-relaxed text-gray-800"
              dir={selectedSystem.direction === 'RTL' ? 'rtl' : 'ltr'}
            >
              {selectedSystem.sampleCharacters}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              {selectedSystem.characterCount} characters in system
            </p>
          </Card>

          {/* Origin info */}
          <Card className="p-4 bg-white space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">Origin:</span>
              <span className="font-medium">{formatOriginDate(selectedSystem.originDate)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">Region:</span>
              <span className="font-medium">{selectedSystem.originRegion}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4 text-gray-400" />
              <span className="text-gray-600">Unicode:</span>
              <span className="font-medium text-xs">{selectedSystem.unicodeBlock}</span>
            </div>
          </Card>

          {/* Parent system */}
          {selectedSystem.parentSystemId && systemMap.has(selectedSystem.parentSystemId) && (
            <Card className="p-4 bg-white">
              <p className="text-xs text-gray-500 mb-2">Derived From</p>
              <button
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                onClick={function () {
                  const parent = systemMap.get(selectedSystem.parentSystemId);
                  if (parent) setSelectedSystem(parent);
                }}
              >
                <Type className="h-3 w-3" />
                {systemMap.get(selectedSystem.parentSystemId)?.name}
              </button>
            </Card>
          )}

          {/* Descendant systems */}
          {(() => {
            const descendants = systems.filter(function (s) {
              return s.parentSystemId === selectedSystem.id;
            });
            if (descendants.length === 0) return null;
            return (
              <Card className="p-4 bg-white">
                <p className="text-xs text-gray-500 mb-2">
                  Descendant Scripts ({descendants.length})
                </p>
                <div className="space-y-1">
                  {descendants.map(function (desc) {
                    return (
                      <button
                        key={desc.id}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 w-full text-left"
                        onClick={function () { setSelectedSystem(desc); }}
                      >
                        <Type className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{desc.name}</span>
                        <Badge
                          style={{ backgroundColor: TYPE_COLORS[desc.type] || '#6b7280' }}
                          className="text-white text-[10px] px-1 py-0 ml-auto flex-shrink-0"
                        >
                          {desc.type}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })()}

          {/* Languages */}
          {selectedSystem.languageIds.length > 0 && (
            <Card className="p-4 bg-white">
              <p className="text-xs text-gray-500 mb-2">
                Associated Languages ({selectedSystem.languageIds.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {selectedSystem.languageIds.map(function (langId) {
                  return (
                    <Badge key={langId} variant="outline" className="text-xs">
                      {langId}
                    </Badge>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
