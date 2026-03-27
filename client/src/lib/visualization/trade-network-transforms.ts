import type { SankeyFlowNode, SankeyFlowLink } from '../../components/visualizations/shared/SankeyFlow';
import type { NetworkGraphNode, NetworkGraphLink } from '../../components/visualizations/shared/NetworkGraph';

export interface TradeGoodData {
  id: string;
  name: string;
  category: string;
  originRegion: string;
  tradeRoutes: string[];
  timePeriod: string;
  associatedLanguages: string[];
}

export interface TradeRouteData {
  id: string;
  name: string;
  routeType: string;
  startDate: string;
  endDate: string;
  tradedGoods: string[];
  keyCities: string[];
  controllingPowers: string[];
  associatedLanguages: string[];
  economicImpact: string;
}

export function buildSankeyData(
  goods: TradeGoodData[],
  routes: TradeRouteData[],
): { nodes: SankeyFlowNode[]; links: SankeyFlowLink[] } {
  const nodes: SankeyFlowNode[] = [];
  const links: SankeyFlowLink[] = [];
  const nodeIds = new Set<string>();

  // Create region nodes (sources), route nodes (middle), and good category nodes (targets)
  const regionGoods = new Map<string, TradeGoodData[]>();
  for (const good of goods) {
    const region = good.originRegion || 'Unknown';
    if (!regionGoods.has(region)) regionGoods.set(region, []);
    regionGoods.get(region)!.push(good);
  }

  // Add region nodes
  for (const region of Array.from(regionGoods.keys())) {
    const id = `region:${region}`;
    if (!nodeIds.has(id)) {
      nodes.push({ id, name: region, group: 'region' });
      nodeIds.add(id);
    }
  }

  // Add route nodes
  for (const route of routes) {
    const id = `route:${route.id}`;
    if (!nodeIds.has(id)) {
      nodes.push({ id, name: route.name, group: route.routeType });
      nodeIds.add(id);
    }
  }

  // Add category nodes
  const categorySet = new Set<string>();
  for (const good of goods) {
    categorySet.add(good.category);
  }
  for (const category of Array.from(categorySet)) {
    const id = `category:${category}`;
    if (!nodeIds.has(id)) {
      nodes.push({ id, name: category, group: 'category' });
      nodeIds.add(id);
    }
  }

  // Link regions → routes (via goods that originate in that region and travel that route)
  const regionRouteValues = new Map<string, number>();
  for (const good of goods) {
    const region = good.originRegion || 'Unknown';
    for (const _routeRef of good.tradeRoutes) {
      const route = routes.find((r) => r.tradedGoods.includes(good.id));
      if (route) {
        const key = `region:${region}||route:${route.id}`;
        regionRouteValues.set(key, (regionRouteValues.get(key) || 0) + 1);
      }
    }
  }

  for (const [key, value] of Array.from(regionRouteValues)) {
    const [source, target] = key.split('||');
    if (nodeIds.has(source) && nodeIds.has(target)) {
      links.push({ source, target, value, label: 'origin' });
    }
  }

  // Link routes → categories (via goods traded on that route)
  const routeCategoryValues = new Map<string, number>();
  for (const route of routes) {
    for (const goodId of route.tradedGoods) {
      const good = goods.find((g) => g.id === goodId);
      if (good) {
        const key = `route:${route.id}||category:${good.category}`;
        routeCategoryValues.set(key, (routeCategoryValues.get(key) || 0) + 1);
      }
    }
  }

  for (const [key, value] of Array.from(routeCategoryValues)) {
    const [source, target] = key.split('||');
    if (nodeIds.has(source) && nodeIds.has(target)) {
      links.push({ source, target, value, label: 'traded' });
    }
  }

  return { nodes, links };
}

export function buildNetworkData(
  goods: TradeGoodData[],
  routes: TradeRouteData[],
): { nodes: NetworkGraphNode[]; links: NetworkGraphLink[] } {
  const nodes: NetworkGraphNode[] = [];
  const links: NetworkGraphLink[] = [];
  const nodeIds = new Set<string>();

  // Route nodes (larger)
  for (const route of routes) {
    const id = `route:${route.id}`;
    if (!nodeIds.has(id)) {
      nodes.push({
        id,
        name: route.name,
        group: route.routeType,
        size: 10 + Math.min(route.tradedGoods.length * 2, 20),
      });
      nodeIds.add(id);
    }
  }

  // Good nodes (smaller)
  for (const good of goods) {
    const id = `good:${good.id}`;
    if (!nodeIds.has(id)) {
      nodes.push({
        id,
        name: good.name,
        group: good.category,
        size: 5,
      });
      nodeIds.add(id);
    }
  }

  // Link goods to routes they're traded on
  for (const route of routes) {
    for (const goodId of route.tradedGoods) {
      const good = goods.find((g) => g.id === goodId);
      if (good && nodeIds.has(`route:${route.id}`) && nodeIds.has(`good:${good.id}`)) {
        links.push({
          source: `route:${route.id}`,
          target: `good:${good.id}`,
          value: 1,
          label: route.routeType,
        });
      }
    }
  }

  // Link routes that share goods
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const shared = routes[i].tradedGoods.filter((g) => routes[j].tradedGoods.includes(g));
      if (shared.length > 0) {
        links.push({
          source: `route:${routes[i].id}`,
          target: `route:${routes[j].id}`,
          value: shared.length,
          label: `${shared.length} shared goods`,
        });
      }
    }
  }

  return { nodes, links };
}
