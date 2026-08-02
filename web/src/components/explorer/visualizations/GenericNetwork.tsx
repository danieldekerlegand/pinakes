import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";
import type {
  RelationalLink,
  RelationalNode,
} from "@/lib/visualization/adapters/types";

interface SimNode extends RelationalNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink extends Omit<RelationalLink, "source" | "target"> {
  source: SimNode | string;
  target: SimNode | string;
}

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#7c3aed", "#db2777", "#0891b2", "#ea580c"];

export default function GenericNetwork({ projections, onSelect }: VisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width || 800, height: rect.height || 600 });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { groupColor, legendGroups } = useMemo(() => {
    const map = new Map<string, string>();
    const order: string[] = [];
    for (const node of projections.relational?.nodes ?? []) {
      const key = node.group ?? "_default";
      if (!map.has(key)) {
        map.set(key, COLORS[order.length % COLORS.length]);
        order.push(key);
      }
    }
    return {
      groupColor: (group: string | undefined) => map.get(group ?? "_default") ?? COLORS[0],
      legendGroups: order,
    };
  }, [projections.relational]);

  useEffect(() => {
    const graph = projections.relational;
    const svgEl = svgRef.current;
    if (!svgEl || !graph || graph.nodes.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = graph.links.map((l) => ({ ...l }));

    const sim = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(60).strength(0.4)
      )
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(size.width / 2, size.height / 2))
      .force("collide", d3.forceCollide().radius(12));

    const link = svg
      .append("g")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-opacity", 0.7)
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-width", (d) => Math.min(4, 1 + Math.log((d.weight ?? 1) + 1)));

    const maxMag = Math.max(1, ...nodes.map((n) => n.magnitude ?? 1));

    const node = svg
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", (d) => 4 + ((d.magnitude ?? 1) / maxMag) * 8)
      .attr("fill", (d) => groupColor(d.group))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .attr("cursor", "pointer")
      .on("click", (_, d) => onSelect?.(d.id, d.payload))
      .call(
        d3
          .drag<SVGCircleElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    node.append("title").text((d) => d.label);

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (typeof d.source === "string" ? 0 : d.source.x ?? 0))
        .attr("y1", (d) => (typeof d.source === "string" ? 0 : d.source.y ?? 0))
        .attr("x2", (d) => (typeof d.target === "string" ? 0 : d.target.x ?? 0))
        .attr("y2", (d) => (typeof d.target === "string" ? 0 : d.target.y ?? 0));
      node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
    });

    return () => {
      sim.stop();
    };
  }, [projections.relational, size, groupColor, onSelect]);

  if (!projections.relational || projections.relational.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no relational data to render.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full bg-white">
      <svg ref={svgRef} width={size.width} height={size.height} />
      {legendGroups.length > 1 && (
        <div className="absolute top-2 right-2 max-w-[220px] max-h-[60%] overflow-auto px-2 py-1.5 bg-white/95 backdrop-blur border border-gray-200 rounded shadow-sm text-[10px] space-y-0.5">
          {legendGroups.map((g) => (
            <div key={g} className="flex items-center gap-1.5 text-gray-700">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: groupColor(g) }}
                aria-hidden="true"
              />
              <span className="truncate">{g === "_default" ? "Other" : g}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
