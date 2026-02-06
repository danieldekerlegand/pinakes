import * as d3 from 'd3';
import type { NetworkNode } from './types';

/**
 * Format large numbers for display (e.g., 1500000 -> "1.5M")
 */
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return 'N/A';

  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

/**
 * Get color for a specific language family
 * Uses a consistent color scale based on family ID
 */
export function getFamilyColor(familyId: string, opacity: number = 1): string {
  const colors = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
    '#6366f1', // indigo
    '#84cc16', // lime
  ];

  // Generate consistent index from family ID
  let hash = 0;
  for (let i = 0; i < familyId.length; i++) {
    hash = familyId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;

  if (opacity < 1) {
    const hex = colors[index];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  return colors[index];
}

/**
 * Get color based on tree level (for hierarchical tree)
 * Mimics the existing color scheme from language-tree.tsx
 */
export function getLevelColor(level: number): string {
  const colors = [
    '#dbeafe', // blue-100 (Level 0)
    '#d1fae5', // green-100 (Level 1)
    '#fed7aa', // orange-100 (Level 2)
    '#e5e7eb', // gray-200 (Level 3+)
  ];
  return colors[Math.min(level, colors.length - 1)];
}

/**
 * Get border color based on tree level
 */
export function getLevelBorderColor(level: number): string {
  const colors = [
    '#3b82f6', // blue-500 (Level 0)
    '#10b981', // green-500 (Level 1)
    '#f97316', // orange-500 (Level 2)
    '#6b7280', // gray-500 (Level 3+)
  ];
  return colors[Math.min(level, colors.length - 1)];
}

/**
 * Get color based on language status
 */
export function getStatusColor(status: string): string {
  const statusColors: { [key: string]: string } = {
    'living': '#10b981', // green
    'endangered': '#f59e0b', // amber
    'extinct': '#6b7280', // gray
    'historical': '#8b5cf6', // purple
    'constructed': '#3b82f6', // blue
    'revived': '#14b8a6', // teal
  };

  return statusColors[status.toLowerCase()] || '#6b7280';
}

/**
 * Create a D3 drag behavior for force simulation nodes
 */
export function createDragBehavior(simulation: d3.Simulation<NetworkNode, any>) {
  function dragstarted(event: d3.D3DragEvent<any, NetworkNode, any>) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event: d3.D3DragEvent<any, NetworkNode, any>) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event: d3.D3DragEvent<any, NetworkNode, any>) {
    if (!event.active) simulation.alphaTarget(0);
    // Keep node fixed after drag (double-click to unpin)
  }

  return d3.drag<any, NetworkNode>()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);
}

/**
 * Create a D3 zoom behavior with constraints
 */
export function createZoomBehavior(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  minZoom: number = 0.1,
  maxZoom: number = 10
) {
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([minZoom, maxZoom])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  return zoom;
}

/**
 * Wrap text in SVG to fit within a specific width
 */
export function wrapText(
  text: d3.Selection<SVGTextElement, any, any, any>,
  width: number
) {
  text.each(function() {
    const text = d3.select(this);
    const words = text.text().split(/\s+/).reverse();
    let word;
    let line: string[] = [];
    let lineNumber = 0;
    const lineHeight = 1.1; // ems
    const y = text.attr('y');
    const dy = parseFloat(text.attr('dy') || '0');
    let tspan = text.text(null).append('tspan').attr('x', 0).attr('y', y).attr('dy', dy + 'em');

    while ((word = words.pop())) {
      line.push(word);
      tspan.text(line.join(' '));
      if (tspan.node()!.getComputedTextLength() > width) {
        line.pop();
        tspan.text(line.join(' '));
        line = [word];
        tspan = text.append('tspan')
          .attr('x', 0)
          .attr('y', y)
          .attr('dy', ++lineNumber * lineHeight + dy + 'em')
          .text(word);
      }
    }
  });
}

/**
 * Calculate tooltip position to keep it within viewport
 */
export function calculateTooltipPosition(
  event: MouseEvent,
  tooltipWidth: number = 200,
  tooltipHeight: number = 100
): { x: number; y: number } {
  const padding = 10;
  let x = event.pageX + padding;
  let y = event.pageY + padding;

  // Check if tooltip goes off-screen horizontally
  if (x + tooltipWidth > window.innerWidth) {
    x = event.pageX - tooltipWidth - padding;
  }

  // Check if tooltip goes off-screen vertically
  if (y + tooltipHeight > window.innerHeight) {
    y = event.pageY - tooltipHeight - padding;
  }

  return { x, y };
}

/**
 * Create a smooth transition for D3 elements
 */
export function createTransition(duration: number = 750) {
  return d3.transition()
    .duration(duration)
    .ease(d3.easeCubicInOut);
}

/**
 * Generate a hierarchical edge path (for tree visualizations)
 */
export function diagonalPath(source: any, target: any): string {
  return `M ${source.y} ${source.x}
          C ${(source.y + target.y) / 2} ${source.x},
            ${(source.y + target.y) / 2} ${target.x},
            ${target.y} ${target.x}`;
}

/**
 * Create a color scale for continuous values
 */
export function createContinuousColorScale(
  domain: [number, number],
  colors: string[] = ['#10b981', '#f59e0b', '#ef4444']
) {
  return d3.scaleSequential()
    .domain(domain)
    .interpolator(d3.interpolateRgbBasis(colors));
}

/**
 * Create a size scale for nodes based on a value
 */
export function createSizeScale(
  domain: [number, number],
  range: [number, number] = [5, 30]
) {
  return d3.scaleSqrt()
    .domain(domain)
    .range(range);
}

/**
 * Truncate text to fit within a maximum length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Debounce function for performance optimization
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function(...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function for performance optimization
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
