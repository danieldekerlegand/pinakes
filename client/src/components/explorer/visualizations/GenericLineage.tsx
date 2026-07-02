import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";
import type {
  HierarchicalNode,
  RelationalLink,
} from "@/lib/visualization/adapters/types";

interface NestedNode {
  id: string;
  label: string;
  payload: unknown;
  children?: NestedNode[];
}

function nestFlat(flat: HierarchicalNode[]): NestedNode[] {
  const byId = new Map<string, NestedNode>();
  for (const n of flat) {
    byId.set(n.id, { id: n.id, label: n.label, payload: n.payload, children: [] });
  }
  const roots: NestedNode[] = [];
  for (const n of flat) {
    const node = byId.get(n.id)!;
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function pickRoot(flat: HierarchicalNode[]): NestedNode | null {
  const roots = nestFlat(flat);
  if (roots.length === 0) return null;
  if (roots.length === 1) return roots[0];
  return {
    id: "__virtual_root__",
    label: "All",
    payload: null,
    children: roots,
  };
}

/**
 * Set of (parent,child) pairs from the hierarchical tree, used to subtract
 * tree edges from the relational links so the overlay only shows the
 * non-tree (cross-cousin) connections.
 */
function buildTreeEdgeSet(flat: HierarchicalNode[]): Set<string> {
  const set = new Set<string>();
  for (const n of flat) {
    if (n.parentId) {
      const [a, b] = n.parentId < n.id ? [n.parentId, n.id] : [n.id, n.parentId];
      set.add(`${a}|${b}`);
    }
  }
  return set;
}

export default function GenericLineage({ projections, onSelect }: VisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });

  const root = useMemo(
    () => pickRoot(projections.hierarchical ?? []),
    [projections.hierarchical]
  );

  const crossLinks: RelationalLink[] = useMemo(() => {
    const all = projections.relational?.links ?? [];
    const treeEdges = buildTreeEdgeSet(projections.hierarchical ?? []);
    return all.filter((l) => {
      const [a, b] = l.source < l.target ? [l.source, l.target] : [l.target, l.source];
      return !treeEdges.has(`${a}|${b}`);
    });
  }, [projections.hierarchical, projections.relational]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width || 1000, height: rect.height || 700 });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !root) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const margin = { top: 40, right: 140, bottom: 40, left: 140 };
    const innerW = size.width - margin.left - margin.right;
    const innerH = size.height - margin.top - margin.bottom;

    const hierarchy = d3.hierarchy<NestedNode>(root);
    const layout = d3.tree<NestedNode>().size([innerH, innerW]);
    const tree = layout(hierarchy);

    // Build a lookup from node id to its laid-out position so we can draw
    // cross-tree relational edges between arbitrary nodes.
    const positionById = new Map<string, { x: number; y: number }>();
    tree.descendants().forEach((d) => {
      if (d.data.id !== "__virtual_root__") {
        positionById.set(d.data.id, { x: d.y, y: d.x });
      }
    });

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event) => {
        g.attr(
          "transform",
          `translate(${margin.left + event.transform.x},${margin.top + event.transform.y}) scale(${event.transform.k})`
        );
      });
    svg.call(zoom);

    // Tree edges (parent → child)
    const linkGenerator = d3
      .linkHorizontal<d3.HierarchyPointLink<NestedNode>, d3.HierarchyPointNode<NestedNode>>()
      .x((d) => d.y)
      .y((d) => d.x);

    g.append("g")
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1.2)
      .selectAll<SVGPathElement, d3.HierarchyPointLink<NestedNode>>("path")
      .data(tree.links())
      .enter()
      .append("path")
      .attr("d", (d) => linkGenerator(d) ?? "");

    // Cross-tree relational edges (drawn as curved amber arcs above the tree)
    const validCross = crossLinks.filter(
      (l) => positionById.has(l.source) && positionById.has(l.target)
    );

    g.append("g")
      .attr("fill", "none")
      .attr("stroke", "#f59e0b")
      .attr("stroke-opacity", 0.55)
      .attr("stroke-width", 1.2)
      .selectAll<SVGPathElement, RelationalLink>("path")
      .data(validCross)
      .enter()
      .append("path")
      .attr("d", (d) => {
        const a = positionById.get(d.source)!;
        const b = positionById.get(d.target)!;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2 - Math.abs(b.y - a.y) * 0.2 - 30;
        return `M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`;
      })
      .append("title")
      .text((d) => d.kind);

    // Nodes
    const nodes = g
      .append("g")
      .selectAll<SVGGElement, d3.HierarchyPointNode<NestedNode>>("g")
      .data(tree.descendants())
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.y},${d.x})`)
      .attr("cursor", (d) => (d.data.id === "__virtual_root__" ? "default" : "pointer"))
      .on("click", (_, d) => {
        if (d.data.id !== "__virtual_root__") onSelect?.(d.data.id, d.data.payload);
      });

    nodes
      .append("circle")
      .attr("r", (d) => (d.data.id === "__virtual_root__" ? 0 : d.children ? 4 : 3))
      .attr("fill", (d) => (d.children ? "#2563eb" : "#94a3b8"))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    nodes
      .filter((d) => d.data.id !== "__virtual_root__")
      .append("text")
      .attr("x", (d) => (d.children ? -8 : 8))
      .attr("dy", "0.32em")
      .attr("text-anchor", (d) => (d.children ? "end" : "start"))
      .attr("class", "fill-gray-700 text-[10px]")
      .text((d) => (d.data.label.length > 24 ? `${d.data.label.slice(0, 23)}…` : d.data.label));
  }, [root, size, crossLinks, onSelect]);

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no hierarchical data to render.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full bg-white overflow-hidden">
      <svg ref={svgRef} width={size.width} height={size.height} />
      {crossLinks.length > 0 && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-white border border-gray-200 text-[10px] rounded shadow-sm">
          <span className="inline-block w-3 h-px bg-gray-400 align-middle mr-1" />
          tree edge
          <span className="inline-block w-3 h-px bg-amber-500 align-middle ml-3 mr-1" />
          cross-link ({crossLinks.length})
        </div>
      )}
    </div>
  );
}
