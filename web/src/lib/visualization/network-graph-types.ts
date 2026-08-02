// ============================================================================
// Generic NetworkGraph types and utilities
// ============================================================================

export interface GraphNode {
  id: string;
  label: string;
  size?: number;
  group?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  [key: string]: any;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  strength?: number;
  [key: string]: any;
}

export interface GraphData<N extends GraphNode = GraphNode, L extends GraphLink = GraphLink> {
  nodes: N[];
  links: L[];
}

export interface SimulationConfig {
  linkDistance?: number;
  chargeStrength?: number;
  centerStrength?: number;
  collisionRadius?: number;
}

// ============================================================================
// Default styling utilities
// ============================================================================

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function defaultNodeColor(node: GraphNode): string {
  if (!node.group) return DEFAULT_COLORS[0];
  return DEFAULT_COLORS[hashString(node.group) % DEFAULT_COLORS.length];
}

export function defaultNodeRadius(node: GraphNode): number {
  return node.size ?? 6;
}

export function defaultLabelText(node: GraphNode): string {
  return node.label.length > 20 ? node.label.substring(0, 17) + '...' : node.label;
}
