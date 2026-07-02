import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SankeyFlow } from './shared/SankeyFlow';
import { NetworkGraph } from './shared/NetworkGraph';
import {
  buildSankeyData,
  buildNetworkData,
  type TradeGoodData,
  type TradeRouteData,
} from '../../lib/visualization/trade-network-transforms';

type ViewMode = 'sankey' | 'network';

const CATEGORY_COLORS: Record<string, string> = {
  spice: '#d97706',
  textile: '#7c3aed',
  metal: '#6b7280',
  gemstone: '#2563eb',
  food: '#16a34a',
  material: '#0891b2',
  dye: '#dc2626',
  incense: '#c026d3',
  ceramic: '#ea580c',
  medicine: '#0d9488',
  animal: '#65a30d',
  wood: '#92400e',
};

const ROUTE_TYPE_COLORS: Record<string, string> = {
  land: '#f59e0b',
  maritime: '#3b82f6',
  river: '#10b981',
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] || '#6b7280';
}

function getRouteTypeColor(routeType: string): string {
  return ROUTE_TYPE_COLORS[routeType.toLowerCase()] || '#94a3b8';
}

export interface TradeNetworkVisualizationProps {
  isOpen?: boolean;
}

export function TradeNetworkVisualization({ isOpen = true }: TradeNetworkVisualizationProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('sankey');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedRouteType, setSelectedRouteType] = useState<string>('all');

  const { data: goodsData } = useQuery<{ goods: TradeGoodData[]; count: number }>({
    queryKey: ['/api/trade-goods'],
    enabled: isOpen,
  });

  const { data: routesData } = useQuery<{ routes: TradeRouteData[]; count: number }>({
    queryKey: ['/api/trade-routes'],
    enabled: isOpen,
  });

  const goods = goodsData?.goods ?? [];
  const routes = routesData?.routes ?? [];

  const filteredGoods = useMemo(() => {
    if (selectedCategory === 'all') return goods;
    return goods.filter((g) => g.category === selectedCategory);
  }, [goods, selectedCategory]);

  const filteredRoutes = useMemo(() => {
    if (selectedRouteType === 'all') return routes;
    return routes.filter((r) => r.routeType === selectedRouteType);
  }, [routes, selectedRouteType]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    goods.forEach((g) => cats.add(g.category));
    return Array.from(cats).sort();
  }, [goods]);

  const routeTypes = useMemo(() => {
    const types = new Set<string>();
    routes.forEach((r) => types.add(r.routeType));
    return Array.from(types).sort();
  }, [routes]);

  const sankeyData = useMemo(
    () => buildSankeyData(filteredGoods, filteredRoutes),
    [filteredGoods, filteredRoutes],
  );

  const networkData = useMemo(
    () => buildNetworkData(filteredGoods, filteredRoutes),
    [filteredGoods, filteredRoutes],
  );

  if (!isOpen) return null;

  const hasData = goods.length > 0 || routes.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white flex-shrink-0">
        <div className="flex rounded-lg border overflow-hidden">
          <button
            className={`px-3 py-1.5 text-sm ${viewMode === 'sankey' ? 'bg-blue-100 text-blue-800 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            onClick={() => setViewMode('sankey')}
          >
            Flow (Sankey)
          </button>
          <button
            className={`px-3 py-1.5 text-sm ${viewMode === 'network' ? 'bg-blue-100 text-blue-800 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            onClick={() => setViewMode('network')}
          >
            Network
          </button>
        </div>

        <select
          className="text-sm border rounded px-2 py-1.5 bg-white"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          className="text-sm border rounded px-2 py-1.5 bg-white"
          value={selectedRouteType}
          onChange={(e) => setSelectedRouteType(e.target.value)}
        >
          <option value="all">All Route Types</option>
          {routeTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <div className="ml-auto text-xs text-gray-500">
          {filteredGoods.length} goods · {filteredRoutes.length} routes
        </div>
      </div>

      {/* Visualization */}
      <div className="flex-1 min-h-0 relative">
        {!hasData ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium">No trade data available</p>
              <p className="text-sm mt-1">Scrape trade goods and routes to see the visualization</p>
            </div>
          </div>
        ) : viewMode === 'sankey' ? (
          <SankeyFlow
            nodes={sankeyData.nodes}
            links={sankeyData.links}
            nodeColorFn={(node) => {
              if (node.group === 'region') return '#6366f1';
              if (node.group === 'category') return getCategoryColor(node.name);
              return getRouteTypeColor(node.group);
            }}
            linkColorFn={(link) => {
              if (link.label === 'origin') return '#a78bfa';
              return '#f59e0b';
            }}
            formatTooltip={(type, datum) => {
              if (type === 'node') {
                const prefix = datum.group === 'region' ? 'Region' : datum.group === 'category' ? 'Category' : 'Route';
                return `${prefix}: ${datum.name}`;
              }
              const src = (datum.source as any).name || datum.source;
              const tgt = (datum.target as any).name || datum.target;
              return `${src} → ${tgt}\nGoods: ${datum.value}`;
            }}
          />
        ) : (
          <NetworkGraph
            nodes={networkData.nodes}
            links={networkData.links}
            nodeColorFn={(node) => {
              if (node.id.startsWith('route:')) return getRouteTypeColor(node.group);
              return getCategoryColor(node.group);
            }}
            linkColorFn={(link) => {
              const srcId = typeof link.source === 'string' ? link.source : link.source.id;
              if (srcId.startsWith('route:') && (typeof link.target === 'string' ? link.target : link.target.id).startsWith('route:')) {
                return '#f59e0b';
              }
              return '#cbd5e0';
            }}
            nodeRadiusFn={(node) => node.size ?? 6}
            formatTooltip={(type, datum) => {
              if (type === 'node') {
                const isRoute = datum.id.startsWith('route:');
                return `${isRoute ? 'Trade Route' : 'Trade Good'}: ${datum.name}\nType: ${datum.group}`;
              }
              const src = typeof datum.source === 'string' ? datum.source : datum.source.name;
              const tgt = typeof datum.target === 'string' ? datum.target : datum.target.name;
              return `${src} — ${tgt}${datum.label ? `\n${datum.label}` : ''}`;
            }}
            linkDistance={100}
            chargeStrength={-300}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-t bg-white text-xs flex-shrink-0 flex-wrap">
        {viewMode === 'sankey' ? (
          <>
            <span className="text-gray-500 font-medium">Legend:</span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Region
            </span>
            {Object.entries(ROUTE_TYPE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} /> {type}
              </span>
            ))}
            {categories.slice(0, 6).map((cat) => (
              <span key={cat} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategoryColor(cat) }} /> {cat}
              </span>
            ))}
          </>
        ) : (
          <>
            <span className="text-gray-500 font-medium">Routes:</span>
            {Object.entries(ROUTE_TYPE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} /> {type}
              </span>
            ))}
            <span className="text-gray-500 font-medium ml-2">Goods:</span>
            {categories.slice(0, 6).map((cat) => (
              <span key={cat} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategoryColor(cat) }} /> {cat}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
