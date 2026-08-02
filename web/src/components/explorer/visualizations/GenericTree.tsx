import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";
import type { HierarchicalNode } from "@/lib/visualization/adapters/types";

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
  // Multiple roots: synthesize a virtual root so d3.hierarchy works
  return {
    id: "__virtual_root__",
    label: "All",
    payload: null,
    children: roots,
  };
}

const NODE_ROW = 22;
const NODE_DEPTH_WIDTH = 220;

export default function GenericTree({ projections, onSelect }: VisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const root = useMemo(
    () => pickRoot(projections.hierarchical ?? []),
    [projections.hierarchical]
  );

  // Track which internal nodes have their children hidden. Bumping
  // collapseVersion re-runs the layout effect.
  const collapsedIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const [collapseVersion, setCollapseVersion] = useState(0);

  // Reset collapsed state when the underlying root changes (dataset switch)
  useEffect(() => {
    collapsedIdsRef.current = new Set();
    seededRef.current = false;
    setCollapseVersion((v) => v + 1);
  }, [root]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width || 800, height: rect.height || 600 });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !root) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const margin = { top: 24, right: 120, bottom: 24, left: 120 };

    // Wrap children accessor so nodes in the collapsed set appear as leaves.
    const wrappedChildren = (d: NestedNode): NestedNode[] | undefined => {
      if (collapsedIdsRef.current.has(d.id)) return undefined;
      return d.children;
    };

    const hierarchy = d3.hierarchy<NestedNode>(root, wrappedChildren);

    // First-time seed: collapse every node with children at depth >= 1 so
    // the user starts with top-level groups visible but nothing nested.
    if (!seededRef.current) {
      const seed = (node: d3.HierarchyNode<NestedNode>, depth: number) => {
        if (depth >= 1 && node.data.id !== "__virtual_root__" && (node.data.children?.length ?? 0) > 0) {
          collapsedIdsRef.current.add(node.data.id);
        }
        node.children?.forEach((child) => seed(child, depth + 1));
      };
      seed(hierarchy, 0);
      seededRef.current = true;
      setCollapseVersion((v) => v + 1);
      return;
    }

    // Fixed per-row size so labels never overlap regardless of leaf count.
    const layout = d3.tree<NestedNode>().nodeSize([NODE_ROW, NODE_DEPTH_WIDTH]);
    const tree = layout(hierarchy);

    const g = svg.append("g").attr("class", "main-group");

    // Zoom + pan with initial centering on the data
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoomBehavior);

    // Links
    const linkGenerator = d3
      .linkHorizontal<d3.HierarchyPointLink<NestedNode>, d3.HierarchyPointNode<NestedNode>>()
      .x((d) => d.y)
      .y((d) => d.x);

    g.append("g")
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1)
      .selectAll<SVGPathElement, d3.HierarchyPointLink<NestedNode>>("path")
      .data(tree.links())
      .enter()
      .append("path")
      .attr("d", (d) => linkGenerator(d) ?? "");

    // Nodes
    const nodes = g
      .append("g")
      .selectAll<SVGGElement, d3.HierarchyPointNode<NestedNode>>("g")
      .data(tree.descendants())
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.y},${d.x})`)
      .attr("cursor", (d) => (d.data.id === "__virtual_root__" ? "default" : "pointer"));

    // Leaves and synthetic root: select on click. Internal nodes: toggle
    // collapse on click (children original > 0 distinguishes internal from leaf).
    nodes.on("click", (event, d) => {
      event.stopPropagation();
      if (d.data.id === "__virtual_root__") return;
      const hasOriginalChildren = (d.data.children?.length ?? 0) > 0;
      if (hasOriginalChildren) {
        if (collapsedIdsRef.current.has(d.data.id)) {
          collapsedIdsRef.current.delete(d.data.id);
        } else {
          collapsedIdsRef.current.add(d.data.id);
        }
        setCollapseVersion((v) => v + 1);
      } else {
        onSelect?.(d.data.id, d.data.payload);
      }
    });

    nodes
      .append("circle")
      .attr("r", (d) => {
        if (d.data.id === "__virtual_root__") return 0;
        const hasOriginalChildren = (d.data.children?.length ?? 0) > 0;
        return hasOriginalChildren ? 4 : 3;
      })
      .attr("fill", (d) => {
        const hasOriginalChildren = (d.data.children?.length ?? 0) > 0;
        return hasOriginalChildren ? "#2563eb" : "#94a3b8";
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    nodes
      .filter((d) => d.data.id !== "__virtual_root__")
      .append("text")
      .attr("x", (d) => {
        const hasOriginalChildren = (d.data.children?.length ?? 0) > 0;
        return hasOriginalChildren ? -8 : 8;
      })
      .attr("dy", "0.32em")
      .attr("text-anchor", (d) => {
        const hasOriginalChildren = (d.data.children?.length ?? 0) > 0;
        return hasOriginalChildren ? "end" : "start";
      })
      .attr("class", "fill-gray-700 text-[10px]")
      .text((d) => (d.data.label.length > 24 ? `${d.data.label.slice(0, 23)}…` : d.data.label));

    // Chevron marker: ▸ for collapsed-with-hidden-children, ▾ for expanded
    nodes
      .filter(
        (d) => d.data.id !== "__virtual_root__" && (d.data.children?.length ?? 0) > 0
      )
      .append("text")
      .attr("class", "collapse-marker")
      .attr("x", -22)
      .attr("y", 0)
      .attr("dy", "0.32em")
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", 700)
      .attr("fill", "#64748b")
      .style("pointer-events", "none")
      .text((d) => (collapsedIdsRef.current.has(d.data.id) ? "▸" : "▾"));

    // Center the laid-out tree in the viewport on first paint
    const bounds = g.node()?.getBBox();
    if (bounds) {
      const translateX = margin.left - bounds.x;
      const translateY = size.height / 2 - bounds.y - bounds.height / 2;
      svg.call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(translateX, translateY).scale(1)
      );
    }
  }, [root, size, onSelect, collapseVersion]);

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no hierarchical data to render.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full bg-white overflow-hidden">
      <svg ref={svgRef} width={size.width} height={size.height} />
    </div>
  );
}
