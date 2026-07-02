import type { NetworkNode, NetworkLink } from './types';

export interface DeityData {
  id: string;
  name: string;
  nativeName: string;
  mythology: string;
  domain: string[];
  equivalentDeityIds: string[];
}

export interface DeityNetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
  pantheons: string[];
}

/**
 * Transform deity data into a network graph where:
 * - Pantheon nodes are large hub nodes
 * - Deity nodes connect to their pantheon
 * - Syncretism links connect equivalent deities across pantheons
 */
export function buildDeityNetwork(deities: DeityData[]): DeityNetworkData {
  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];
  const pantheonSet = new Set<string>();

  // Collect pantheons
  for (const deity of deities) {
    pantheonSet.add(deity.mythology);
  }
  const pantheons = Array.from(pantheonSet).sort();

  // Create pantheon hub nodes
  for (const pantheon of pantheons) {
    const count = deities.filter((d) => d.mythology === pantheon).length;
    nodes.push({
      id: `pantheon-${pantheon}`,
      name: pantheon.charAt(0).toUpperCase() + pantheon.slice(1),
      type: 'family',
      group: pantheon,
      level: 0,
      size: Math.max(12, Math.min(30, 8 + count * 1.5)),
    });
  }

  // Create deity nodes and link to their pantheon
  for (const deity of deities) {
    nodes.push({
      id: deity.id,
      name: deity.name,
      type: 'language', // reuse the existing type union for node styling
      group: deity.mythology,
      level: 1,
      size: Math.max(4, Math.min(12, 4 + deity.domain.length)),
    });

    links.push({
      source: `pantheon-${deity.mythology}`,
      target: deity.id,
      type: 'family-child',
      strength: 0.7,
    });
  }

  // Create syncretism links between equivalent deities
  const deityIds = new Set(deities.map((d) => d.id));
  const addedLinks = new Set<string>();

  for (const deity of deities) {
    for (const eqId of deity.equivalentDeityIds) {
      if (!deityIds.has(eqId)) continue;
      const key = [deity.id, eqId].sort().join('::');
      if (addedLinks.has(key)) continue;
      addedLinks.add(key);

      links.push({
        source: deity.id,
        target: eqId,
        type: 'language-family', // syncretism link
        strength: 0.3,
      });
    }
  }

  return { nodes, links, pantheons };
}

/**
 * Filter deity network to only include specific pantheons
 */
export function filterDeityNetwork(
  network: DeityNetworkData,
  selectedPantheons: Set<string> | null,
): DeityNetworkData {
  if (!selectedPantheons || selectedPantheons.size === 0) return network;

  const filteredNodes = network.nodes.filter((n) =>
    selectedPantheons.has(n.group),
  );
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredLinks = network.links.filter((l) => {
    const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
    const targetId = typeof l.target === 'string' ? l.target : l.target.id;
    return nodeIds.has(sourceId) && nodeIds.has(targetId);
  });

  return {
    nodes: filteredNodes,
    links: filteredLinks,
    pantheons: network.pantheons.filter((p) => selectedPantheons.has(p)),
  };
}
