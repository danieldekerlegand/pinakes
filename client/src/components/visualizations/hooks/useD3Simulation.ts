import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { NetworkNode, NetworkLink } from '../../../lib/visualization/types';

interface SimulationConfig {
  linkDistance?: number;
  chargeStrength?: number;
  centerStrength?: number;
  collisionRadius?: number;
}

/**
 * Hook to manage D3 force simulation
 * Provides lifecycle management and configuration updates
 */
export function useD3Simulation(
  nodes: NetworkNode[],
  links: NetworkLink[],
  width: number,
  height: number,
  config: SimulationConfig = {},
  onTick?: () => void
) {
  const simulationRef = useRef<d3.Simulation<NetworkNode, any> | null>(null);

  const {
    linkDistance = 100,
    chargeStrength = -300,
    centerStrength = 1,
    collisionRadius = 10,
  } = config;

  useEffect(() => {
    if (nodes.length === 0) return;

    // Create or update simulation
    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<NetworkNode>(nodes);
    } else {
      simulationRef.current.nodes(nodes);
    }

    const simulation = simulationRef.current;

    // Configure forces
    simulation
      .force(
        'link',
        d3.forceLink<NetworkNode, NetworkLink>(links)
          .id((d) => d.id)
          .distance(linkDistance)
      )
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(centerStrength))
      .force(
        'collision',
        d3.forceCollide<NetworkNode>().radius((d) => d.size + collisionRadius)
      )
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05));

    // Set up tick handler
    if (onTick) {
      simulation.on('tick', onTick);
    }

    // Restart simulation
    simulation.alpha(1).restart();

    return () => {
      simulation.stop();
    };
  }, [
    nodes,
    links,
    width,
    height,
    linkDistance,
    chargeStrength,
    centerStrength,
    collisionRadius,
    onTick,
  ]);

  return simulationRef.current;
}

/**
 * Hook for managing node pinning in force simulation
 */
export function useNodePinning() {
  const pinnedNodes = useRef<Set<string>>(new Set());

  const pin = (nodeId: string, x?: number, y?: number) => {
    pinnedNodes.current.add(nodeId);
    return { fx: x, fy: y };
  };

  const unpin = (nodeId: string) => {
    pinnedNodes.current.delete(nodeId);
    return { fx: null, fy: null };
  };

  const togglePin = (nodeId: string, x?: number, y?: number) => {
    if (pinnedNodes.current.has(nodeId)) {
      return unpin(nodeId);
    } else {
      return pin(nodeId, x, y);
    }
  };

  const isPinned = (nodeId: string) => {
    return pinnedNodes.current.has(nodeId);
  };

  const clearAll = () => {
    pinnedNodes.current.clear();
  };

  return { pin, unpin, togglePin, isPinned, clearAll };
}
