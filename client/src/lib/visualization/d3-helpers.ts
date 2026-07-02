import * as d3 from 'd3';
import type { NetworkNode } from './types';
import {
  CORE_PALETTE,
  LEVEL_BG_COLORS,
  LEVEL_BORDER_COLORS,
  STATUS_COLORS,
  INTERACTION_COLORS,
  hexToRgba,
  hashIndex,
} from './color-theme';

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
  const index = hashIndex(familyId, CORE_PALETTE.length);
  const hex = CORE_PALETTE[index];
  if (opacity < 1) {
    return hexToRgba(hex, opacity);
  }
  return hex;
}

/**
 * Get color based on tree level (for hierarchical tree)
 */
export function getLevelColor(level: number): string {
  return LEVEL_BG_COLORS[Math.min(level, LEVEL_BG_COLORS.length - 1)];
}

/**
 * Get border color based on tree level
 */
export function getLevelBorderColor(level: number): string {
  return LEVEL_BORDER_COLORS[Math.min(level, LEVEL_BORDER_COLORS.length - 1)];
}

/**
 * Get color based on language status
 */
export function getStatusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? INTERACTION_COLORS.defaultFallback;
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
