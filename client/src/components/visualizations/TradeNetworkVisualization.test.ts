import { describe, it, expect } from 'vitest';
import { buildSankeyData, buildNetworkData } from '../../lib/visualization/trade-network-transforms';

const MOCK_GOODS = [
  {
    id: 'tg-001',
    name: 'Silk',
    category: 'textile',
    originRegion: 'China',
    tradeRoutes: ['silk-road'],
    timePeriod: '-3000 to 1500',
    associatedLanguages: ['cmn', 'fas'],
  },
  {
    id: 'tg-002',
    name: 'Black Pepper',
    category: 'spice',
    originRegion: 'India',
    tradeRoutes: ['spice-trade'],
    timePeriod: '-2000 to present',
    associatedLanguages: ['mal', 'tam'],
  },
  {
    id: 'tg-003',
    name: 'Cinnamon',
    category: 'spice',
    originRegion: 'Sri Lanka',
    tradeRoutes: ['spice-trade'],
    timePeriod: '-2000 to present',
    associatedLanguages: ['sin'],
  },
  {
    id: 'tg-006',
    name: 'Gold',
    category: 'metal',
    originRegion: 'West Africa',
    tradeRoutes: ['trans-saharan'],
    timePeriod: '-5000 to present',
    associatedLanguages: ['arb', 'hau'],
  },
];

const MOCK_ROUTES = [
  {
    id: 'tr-001',
    name: 'Silk Road',
    routeType: 'land',
    startDate: '-200',
    endDate: '1450',
    tradedGoods: ['tg-001', 'tg-006'],
    keyCities: ["Chang'an", 'Samarkand'],
    controllingPowers: ['Han Dynasty'],
    associatedLanguages: ['cmn', 'fas'],
    economicImpact: 'Major',
  },
  {
    id: 'tr-002',
    name: 'Maritime Spice Route',
    routeType: 'maritime',
    startDate: '-300',
    endDate: '1700',
    tradedGoods: ['tg-002', 'tg-003'],
    keyCities: ['Calicut', 'Malacca'],
    controllingPowers: ['Chola Dynasty'],
    associatedLanguages: ['tam', 'mal'],
    economicImpact: 'Major',
  },
  {
    id: 'tr-003',
    name: 'Trans-Saharan Trade',
    routeType: 'land',
    startDate: '-500',
    endDate: '1800',
    tradedGoods: ['tg-006'],
    keyCities: ['Timbuktu'],
    controllingPowers: ['Mali Empire'],
    associatedLanguages: ['arb', 'hau'],
    economicImpact: 'Major',
  },
];

describe('buildSankeyData', () => {
  it('creates nodes for regions, routes, and categories', () => {
    const { nodes } = buildSankeyData(MOCK_GOODS, MOCK_ROUTES);

    const regionNodes = nodes.filter((n) => n.id.startsWith('region:'));
    const routeNodes = nodes.filter((n) => n.id.startsWith('route:'));
    const categoryNodes = nodes.filter((n) => n.id.startsWith('category:'));

    // 4 unique regions: China, India, Sri Lanka, West Africa
    expect(regionNodes.length).toBe(4);
    // 3 routes
    expect(routeNodes.length).toBe(3);
    // 3 categories: textile, spice, metal
    expect(categoryNodes.length).toBe(3);
  });

  it('creates links from regions to routes', () => {
    const { links } = buildSankeyData(MOCK_GOODS, MOCK_ROUTES);
    const originLinks = links.filter((l) => l.label === 'origin');
    expect(originLinks.length).toBeGreaterThan(0);

    // Check a specific connection: China → Silk Road
    const chinaToSilkRoad = originLinks.find(
      (l) => l.source === 'region:China' && l.target === 'route:tr-001'
    );
    expect(chinaToSilkRoad).toBeDefined();
  });

  it('creates links from routes to categories', () => {
    const { links } = buildSankeyData(MOCK_GOODS, MOCK_ROUTES);
    const tradedLinks = links.filter((l) => l.label === 'traded');
    expect(tradedLinks.length).toBeGreaterThan(0);

    // Silk Road trades textile (silk) and metal (gold)
    const silkRoadToTextile = tradedLinks.find(
      (l) => l.source === 'route:tr-001' && l.target === 'category:textile'
    );
    expect(silkRoadToTextile).toBeDefined();
    expect(silkRoadToTextile!.value).toBe(1);

    const silkRoadToMetal = tradedLinks.find(
      (l) => l.source === 'route:tr-001' && l.target === 'category:metal'
    );
    expect(silkRoadToMetal).toBeDefined();
  });

  it('returns empty data for empty inputs', () => {
    const { nodes, links } = buildSankeyData([], []);
    expect(nodes).toEqual([]);
    expect(links).toEqual([]);
  });

  it('handles goods with no matching routes gracefully', () => {
    const orphanGood = [{
      id: 'tg-999',
      name: 'Mystery Good',
      category: 'unknown',
      originRegion: 'Atlantis',
      tradeRoutes: ['nonexistent-route'],
      timePeriod: '???',
      associatedLanguages: [],
    }];
    const { nodes, links } = buildSankeyData(orphanGood, []);
    // Should still create region and category nodes
    expect(nodes.find((n) => n.id === 'region:Atlantis')).toBeDefined();
    expect(nodes.find((n) => n.id === 'category:unknown')).toBeDefined();
    // No links since there are no routes
    expect(links.length).toBe(0);
  });

  it('aggregates link values when multiple goods share region-route pair', () => {
    const { links } = buildSankeyData(MOCK_GOODS, MOCK_ROUTES);
    // Maritime Spice Route trades 2 spices (pepper + cinnamon)
    const spiceRouteToSpice = links.find(
      (l) => l.source === 'route:tr-002' && l.target === 'category:spice'
    );
    expect(spiceRouteToSpice).toBeDefined();
    expect(spiceRouteToSpice!.value).toBe(2);
  });
});

describe('buildNetworkData', () => {
  it('creates route and good nodes', () => {
    const { nodes } = buildNetworkData(MOCK_GOODS, MOCK_ROUTES);

    const routeNodes = nodes.filter((n) => n.id.startsWith('route:'));
    const goodNodes = nodes.filter((n) => n.id.startsWith('good:'));

    expect(routeNodes.length).toBe(3);
    expect(goodNodes.length).toBe(4);
  });

  it('links goods to routes', () => {
    const { links } = buildNetworkData(MOCK_GOODS, MOCK_ROUTES);
    const goodRouteLinks = links.filter(
      (l) => {
        const src = typeof l.source === 'string' ? l.source : l.source.id;
        const tgt = typeof l.target === 'string' ? l.target : l.target.id;
        return src.startsWith('route:') && tgt.startsWith('good:');
      }
    );

    // Silk Road: 2 goods (silk, gold), Spice Route: 2 goods (pepper, cinnamon), Trans-Saharan: 1 good (gold)
    expect(goodRouteLinks.length).toBe(5);
  });

  it('links routes that share goods', () => {
    const { links } = buildNetworkData(MOCK_GOODS, MOCK_ROUTES);
    const routeRouteLinks = links.filter(
      (l) => {
        const src = typeof l.source === 'string' ? l.source : l.source.id;
        const tgt = typeof l.target === 'string' ? l.target : l.target.id;
        return src.startsWith('route:') && tgt.startsWith('route:');
      }
    );

    // Silk Road and Trans-Saharan share gold (tg-006)
    expect(routeRouteLinks.length).toBe(1);
    const sharedLink = routeRouteLinks[0];
    expect(sharedLink.value).toBe(1);
    expect(sharedLink.label).toBe('1 shared goods');
  });

  it('assigns larger sizes to route nodes based on goods count', () => {
    const { nodes } = buildNetworkData(MOCK_GOODS, MOCK_ROUTES);
    const silkRoad = nodes.find((n) => n.id === 'route:tr-001');
    const transSaharan = nodes.find((n) => n.id === 'route:tr-003');

    expect(silkRoad).toBeDefined();
    expect(transSaharan).toBeDefined();
    // Silk Road has 2 goods → size 14, Trans-Saharan has 1 → size 12
    expect(silkRoad!.size).toBeGreaterThan(transSaharan!.size!);
  });

  it('returns empty data for empty inputs', () => {
    const { nodes, links } = buildNetworkData([], []);
    expect(nodes).toEqual([]);
    expect(links).toEqual([]);
  });

  it('sets good node sizes to 5', () => {
    const { nodes } = buildNetworkData(MOCK_GOODS, MOCK_ROUTES);
    const goodNodes = nodes.filter((n) => n.id.startsWith('good:'));
    goodNodes.forEach((n) => {
      expect(n.size).toBe(5);
    });
  });
});
