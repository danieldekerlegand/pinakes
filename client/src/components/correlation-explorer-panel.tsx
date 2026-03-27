import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  X,
  Sparkles,
  BarChart3,
  GitMerge,
  ScatterChart,
  ChevronRight,
  Loader2,
  Cpu,
} from "lucide-react";
import VisualizationRecommendations from "@/components/VisualizationRecommendations";
import { isUsingWorker } from "@/lib/computation-worker";
import * as d3 from "d3";

// Types matching the server API
type DomainType =
  | "language"
  | "cuisine"
  | "music"
  | "religion"
  | "haplogroup"
  | "civilization";

type RelationshipType =
  | "co-occurrence"
  | "temporal-correlation"
  | "geographic-overlap";

interface CorrelationEntry {
  entityA: { id: string; name: string; domain: DomainType };
  entityB: { id: string; name: string; domain: DomainType };
  score: number;
  evidence: string[];
}

interface CorrelationResult {
  domainA: DomainType;
  domainB: DomainType;
  correlations: CorrelationEntry[];
  summary: string;
}

interface PrebuiltQuery {
  id: string;
  name: string;
  description: string;
  request: {
    domainA: DomainType;
    domainB: DomainType;
    relationshipType: RelationshipType;
  };
}

interface PrebuiltQueriesResponse {
  queries: PrebuiltQuery[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const DOMAINS: { value: DomainType; label: string; color: string }[] = [
  { value: "language", label: "Language", color: "#3b82f6" },
  { value: "cuisine", label: "Cuisine", color: "#f97316" },
  { value: "music", label: "Music", color: "#d946ef" },
  { value: "religion", label: "Religion", color: "#6366f1" },
  { value: "haplogroup", label: "Haplogroup", color: "#10b981" },
  { value: "civilization", label: "Civilization", color: "#ef4444" },
];

const RELATIONSHIP_TYPES: {
  value: RelationshipType;
  label: string;
  icon: string;
}[] = [
  { value: "co-occurrence", label: "Co-occurrence", icon: "🔗" },
  { value: "temporal-correlation", label: "Temporal Correlation", icon: "⏳" },
  { value: "geographic-overlap", label: "Geographic Overlap", icon: "🌍" },
];

// Scholarly narratives for prebuilt queries
const NARRATIVES: Record<string, string> = {
  "ie-r1b":
    "The correlation between Indo-European languages and the R1b haplogroup has been debated since the first ancient DNA studies. R1b is the most common Y-chromosome haplogroup in Western Europe, reaching frequencies above 80% in Ireland and the Basque Country. While early models linked R1b to Paleolithic Europeans, ancient DNA from the Yamnaya horizon (~3000 BCE) suggests R1b spread with Indo-European steppe migrations. The co-occurrence pattern reveals how genetic and linguistic expansions can travel together while later decoupling — the Basques carry R1b but speak a non-Indo-European isolate, showing that genes and languages follow different inheritance pathways.",
  "islam-arabic":
    "The spread of Islam from the 7th century CE carried Arabic not just as a liturgical language but as a vehicle for administration, science, and trade. This temporal correlation shows how religious expansion facilitated linguistic borrowing: Persian absorbed Arabic vocabulary for legal and philosophical concepts, Swahili integrated Arabic maritime and commercial terms, and Malay adopted Arabic words through Indian Ocean trade networks. The pattern demonstrates that contact-induced language change intensifies when religion provides both prestige motivation and institutional infrastructure for sustained bilingualism.",
  "austronesian-outrigger":
    "The Austronesian expansion (c. 3000 BCE – 1000 CE) represents the most geographically extensive pre-modern migration. Outrigger canoe technology enabled seafarers from Taiwan to colonize islands across the Pacific and Indian Oceans, reaching as far as Madagascar and Rapa Nui. The geographic overlap between Austronesian-speaking populations and outrigger technology is near-total, making this one of the clearest cases of a co-transmitted cultural package: language, sailing technology, and agricultural practices (taro, breadfruit) moved together as an integrated system.",
  "roman-roads-romance":
    "Roman roads did more than move legions — they channeled the Vulgar Latin that would become the Romance languages. The geographic correlation between Roman infrastructure and modern Romance-speaking areas reveals how road networks created corridors of linguistic influence. Areas with denser road connections (Gaul, Iberia, Italy) became fully Romanized, while peripheral regions (Britain, the Danube frontier) experienced thinner Latin penetration and ultimately shifted to other languages. This pattern illustrates how transportation infrastructure shapes the diffusion and survival of languages over millennia.",
};

function getDomainColor(domain: DomainType): string {
  return DOMAINS.find((d) => d.value === domain)?.color ?? "#6b7280";
}

export default function CorrelationExplorerPanel({ isOpen, onClose }: Props) {
  const [domainA, setDomainA] = useState<DomainType>("language");
  const [domainB, setDomainB] = useState<DomainType>("civilization");
  const [relationshipType, setRelationshipType] =
    useState<RelationshipType>("co-occurrence");
  const [result, setResult] = useState<CorrelationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"sankey" | "scatter">("sankey");
  const [selectedCorrelation, setSelectedCorrelation] =
    useState<CorrelationEntry | null>(null);
  const [activeNarrative, setActiveNarrative] = useState<string | null>(null);

  const sankeyRef = useRef<SVGSVGElement>(null);
  const scatterRef = useRef<SVGSVGElement>(null);

  const { data: prebuiltData } = useQuery<PrebuiltQueriesResponse>({
    queryKey: ["/api/cross-domain/prebuilt-queries"],
    enabled: isOpen,
  });

  const prebuiltQueries = prebuiltData?.queries ?? [];

  const runQuery = useCallback(
    async (dA: DomainType, dB: DomainType, rel: RelationshipType) => {
      setLoading(true);
      setResult(null);
      setSelectedCorrelation(null);
      try {
        const res = await fetch("/api/cross-domain/correlate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domainA: dA,
            domainB: dB,
            relationshipType: rel,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setResult(data);
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleRunQuery = () => {
    setActiveNarrative(null);
    runQuery(domainA, domainB, relationshipType);
  };

  const handlePrebuiltQuery = (query: PrebuiltQuery) => {
    setDomainA(query.request.domainA);
    setDomainB(query.request.domainB);
    setRelationshipType(query.request.relationshipType);
    setActiveNarrative(query.id);
    runQuery(
      query.request.domainA,
      query.request.domainB,
      query.request.relationshipType,
    );
  };

  // Sankey diagram
  const sankeyData = useMemo(() => {
    if (!result || result.correlations.length === 0) return null;

    // Aggregate: group by unique entityA/entityB names, sum scores
    const nodeSet = new Map<string, { name: string; domain: DomainType }>();
    const linkMap = new Map<string, number>();

    for (const c of result.correlations.slice(0, 30)) {
      const aKey = `${c.entityA.domain}:${c.entityA.id}`;
      const bKey = `${c.entityB.domain}:${c.entityB.id}`;
      nodeSet.set(aKey, { name: c.entityA.name, domain: c.entityA.domain });
      nodeSet.set(bKey, { name: c.entityB.name, domain: c.entityB.domain });
      const linkKey = `${aKey}|${bKey}`;
      linkMap.set(linkKey, (linkMap.get(linkKey) ?? 0) + c.score);
    }

    const nodeArray = Array.from(nodeSet.entries()).map(([key, val]) => ({
      key,
      ...val,
    }));
    const nodeIndex = new Map(nodeArray.map((n, i) => [n.key, i]));

    const links = Array.from(linkMap.entries())
      .map(([key, value]) => {
        const [source, target] = key.split("|");
        return {
          source: nodeIndex.get(source) ?? 0,
          target: nodeIndex.get(target) ?? 0,
          value,
        };
      })
      .filter((l) => l.source !== l.target);

    return { nodes: nodeArray, links };
  }, [result]);

  // Draw Sankey
  useEffect(() => {
    if (!sankeyRef.current || !sankeyData || viewMode !== "sankey") return;

    const svg = d3.select(sankeyRef.current);
    svg.selectAll("*").remove();

    const width = 800;
    const height = Math.max(400, sankeyData.nodes.length * 28);
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const { nodes, links } = sankeyData;
    if (nodes.length === 0) return;

    // Split nodes into left (domainA) and right (domainB)
    const leftNodes = nodes.filter(
      (n) => n.domain === result?.domainA,
    );
    const rightNodes = nodes.filter(
      (n) => n.domain !== result?.domainA,
    );

    // Position nodes
    const padding = 4;
    const nodeWidth = 18;
    const leftX = 0;
    const rightX = width - nodeWidth - 160;

    const leftHeight = height / Math.max(leftNodes.length, 1);
    const rightHeight = height / Math.max(rightNodes.length, 1);

    const nodePositions = new Map<
      number,
      { x: number; y: number; h: number }
    >();

    leftNodes.forEach((n, i) => {
      const idx = nodes.indexOf(n);
      nodePositions.set(idx, {
        x: leftX,
        y: i * leftHeight + padding,
        h: leftHeight - padding * 2,
      });
    });

    rightNodes.forEach((n, i) => {
      const idx = nodes.indexOf(n);
      nodePositions.set(idx, {
        x: rightX,
        y: i * rightHeight + padding,
        h: rightHeight - padding * 2,
      });
    });

    // Draw links
    const maxVal = Math.max(...links.map((l) => l.value), 0.01);
    svg
      .append("g")
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("d", (d) => {
        const s = nodePositions.get(d.source);
        const t = nodePositions.get(d.target);
        if (!s || !t) return "";
        const sy = s.y + s.h / 2;
        const ty = t.y + t.h / 2;
        const sx = s.x + nodeWidth;
        const tx = t.x;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      })
      .attr("fill", "none")
      .attr("stroke", (d) => {
        const n = nodes[d.source];
        return getDomainColor(n?.domain ?? "language");
      })
      .attr("stroke-opacity", 0.3)
      .attr("stroke-width", (d) =>
        Math.max(1, (d.value / maxVal) * 12),
      )
      .on("mouseover", function () {
        d3.select(this).attr("stroke-opacity", 0.7);
      })
      .on("mouseout", function () {
        d3.select(this).attr("stroke-opacity", 0.3);
      });

    // Draw nodes
    svg
      .append("g")
      .selectAll("rect")
      .data(nodes)
      .join("rect")
      .attr("x", (_, i) => nodePositions.get(i)?.x ?? 0)
      .attr("y", (_, i) => nodePositions.get(i)?.y ?? 0)
      .attr("width", nodeWidth)
      .attr("height", (_, i) =>
        Math.max(nodePositions.get(i)?.h ?? 8, 8),
      )
      .attr("fill", (d) => getDomainColor(d.domain))
      .attr("rx", 3);

    // Labels
    svg
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("x", (_, i) => {
        const pos = nodePositions.get(i);
        if (!pos) return 0;
        return pos.x < width / 2
          ? pos.x + nodeWidth + 6
          : pos.x - 6;
      })
      .attr("y", (_, i) => {
        const pos = nodePositions.get(i);
        return (pos?.y ?? 0) + (pos?.h ?? 0) / 2;
      })
      .attr("dy", "0.35em")
      .attr("text-anchor", (_, i) => {
        const pos = nodePositions.get(i);
        return (pos?.x ?? 0) < width / 2 ? "start" : "end";
      })
      .attr("font-size", "11px")
      .attr("fill", "#374151")
      .text((d) =>
        d.name.length > 24 ? d.name.slice(0, 22) + "…" : d.name,
      );
  }, [sankeyData, viewMode, result]);

  // Draw scatter plot
  useEffect(() => {
    if (!scatterRef.current || !result || viewMode !== "scatter") return;

    const svg = d3.select(scatterRef.current);
    svg.selectAll("*").remove();

    const width = 800;
    const height = 400;
    const margin = { top: 30, right: 30, bottom: 50, left: 60 };
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const correlations = result.correlations.slice(0, 50);
    if (correlations.length === 0) return;

    const x = d3
      .scaleLinear()
      .domain([0, correlations.length - 1])
      .range([margin.left, width - margin.right]);

    const y = d3
      .scaleLinear()
      .domain([0, 1])
      .range([height - margin.bottom, margin.top]);

    // Axes
    svg
      .append("g")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(0))
      .append("text")
      .attr("x", width / 2)
      .attr("y", 40)
      .attr("fill", "#374151")
      .attr("font-size", "12px")
      .text("Entity Pairs (ranked by score)");

    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5))
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", -45)
      .attr("fill", "#374151")
      .attr("font-size", "12px")
      .attr("text-anchor", "middle")
      .text("Correlation Score");

    // Points
    svg
      .append("g")
      .selectAll("circle")
      .data(correlations)
      .join("circle")
      .attr("cx", (_, i) => x(i))
      .attr("cy", (d) => y(d.score))
      .attr("r", 5)
      .attr("fill", (d) => getDomainColor(d.entityA.domain))
      .attr("fill-opacity", 0.7)
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .attr("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("r", 8).attr("fill-opacity", 1);
        // Tooltip
        svg.selectAll(".tooltip").remove();
        const g = svg
          .append("g")
          .attr("class", "tooltip")
          .attr(
            "transform",
            `translate(${event.offsetX ?? x(correlations.indexOf(d))},${(event.offsetY ?? y(d.score)) - 15})`,
          );
        g.append("rect")
          .attr("x", -80)
          .attr("y", -30)
          .attr("width", 160)
          .attr("height", 28)
          .attr("fill", "white")
          .attr("stroke", "#e5e7eb")
          .attr("rx", 4);
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("y", -12)
          .attr("font-size", "10px")
          .attr("fill", "#374151")
          .text(
            `${d.entityA.name.slice(0, 12)} ↔ ${d.entityB.name.slice(0, 12)}: ${d.score}`,
          );
      })
      .on("mouseout", function () {
        d3.select(this).attr("r", 5).attr("fill-opacity", 0.7);
        svg.selectAll(".tooltip").remove();
      })
      .on("click", (_, d) => setSelectedCorrelation(d));

    // Mean line
    const mean =
      correlations.reduce((s, c) => s + c.score, 0) / correlations.length;
    svg
      .append("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", y(mean))
      .attr("y2", y(mean))
      .attr("stroke", "#9ca3af")
      .attr("stroke-dasharray", "4,4");

    svg
      .append("text")
      .attr("x", width - margin.right + 5)
      .attr("y", y(mean))
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("fill", "#9ca3af")
      .text(`avg: ${mean.toFixed(2)}`);
  }, [result, viewMode]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[950px] bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Correlation Explorer
              </h2>
              <p className="text-indigo-100 text-sm mt-1">
                Discover correlations between cultural domains
              </p>
              <span className="inline-flex items-center gap-1 text-xs text-indigo-200 mt-1">
                <Cpu className="h-3 w-3" />
                {isUsingWorker() ? 'WebWorker enabled' : 'Main thread'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Query Builder */}
          <div className="px-6 py-4 border-b bg-gray-50">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Query Builder
            </h3>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  Domain A
                </label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                  value={domainA}
                  onChange={(e) => setDomainA(e.target.value as DomainType)}
                >
                  {DOMAINS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  Relationship
                </label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                  value={relationshipType}
                  onChange={(e) =>
                    setRelationshipType(e.target.value as RelationshipType)
                  }
                >
                  {RELATIONSHIP_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.icon} {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  Domain B
                </label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                  value={domainB}
                  onChange={(e) => setDomainB(e.target.value as DomainType)}
                >
                  {DOMAINS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={handleRunQuery}
                disabled={loading || domainA === domainB}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Analyze"
                )}
              </Button>
            </div>
            {domainA === domainB && (
              <p className="text-xs text-red-500 mt-1">
                Select two different domains
              </p>
            )}
          </div>

          {/* Pre-built Queries */}
          <div className="px-6 py-4 border-b">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Interesting Queries
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {prebuiltQueries.map((q) => (
                <Card
                  key={q.id}
                  className="p-3 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                  onClick={() => handlePrebuiltQuery(q)}
                >
                  <div className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {q.name}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {q.description.slice(0, 80)}…
                      </p>
                      <div className="flex gap-1 mt-2">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor:
                              getDomainColor(q.request.domainA) + "20",
                            color: getDomainColor(q.request.domainA),
                          }}
                        >
                          {q.request.domainA}
                        </span>
                        <span className="text-xs text-gray-400">↔</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor:
                              getDomainColor(q.request.domainB) + "20",
                            color: getDomainColor(q.request.domainB),
                          }}
                        >
                          {q.request.domainB}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Narrative */}
          {activeNarrative && NARRATIVES[activeNarrative] && (
            <div className="px-6 py-4 border-b bg-amber-50">
              <h3 className="text-sm font-medium text-amber-800 mb-2">
                Scholarly Context
              </h3>
              <p className="text-sm text-amber-900 leading-relaxed">
                {NARRATIVES[activeNarrative]}
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
              <span className="ml-3 text-gray-500">
                Computing correlations…
              </span>
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <>
              {/* Summary */}
              <div className="px-6 py-3 bg-white border-b">
                <p className="text-sm text-gray-600">{result.summary}</p>
              </div>

              {/* View toggle */}
              <div className="px-6 py-3 border-b flex gap-2">
                <Button
                  variant={viewMode === "sankey" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("sankey")}
                  className={
                    viewMode === "sankey" ? "bg-indigo-600" : ""
                  }
                >
                  <GitMerge className="h-4 w-4 mr-1" />
                  Sankey
                </Button>
                <Button
                  variant={viewMode === "scatter" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("scatter")}
                  className={
                    viewMode === "scatter" ? "bg-indigo-600" : ""
                  }
                >
                  <ScatterChart className="h-4 w-4 mr-1" />
                  Scatter
                </Button>
              </div>

              {/* Visualization */}
              <div className="px-6 py-4">
                {result.correlations.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    No correlations found for this combination
                  </div>
                ) : (
                  <>
                    {viewMode === "sankey" && (
                      <div className="border rounded-lg p-2 bg-white overflow-x-auto">
                        <svg
                          ref={sankeyRef}
                          className="w-full"
                          style={{ minHeight: 400 }}
                        />
                      </div>
                    )}
                    {viewMode === "scatter" && (
                      <div className="border rounded-lg p-2 bg-white">
                        <svg
                          ref={scatterRef}
                          className="w-full"
                          style={{ minHeight: 400 }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Correlation list */}
              <div className="px-6 py-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Top Correlations ({result.correlations.length})
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {result.correlations.slice(0, 25).map((c, i) => (
                    <Card
                      key={i}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedCorrelation === c
                          ? "border-indigo-400 bg-indigo-50"
                          : "hover:bg-gray-50"
                      }`}
                      onClick={() =>
                        setSelectedCorrelation(
                          selectedCorrelation === c ? null : c,
                        )
                      }
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: getDomainColor(
                                c.entityA.domain,
                              ),
                            }}
                          />
                          <span className="text-sm font-medium">
                            {c.entityA.name}
                          </span>
                          <span className="text-gray-400">↔</span>
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: getDomainColor(
                                c.entityB.domain,
                              ),
                            }}
                          />
                          <span className="text-sm font-medium">
                            {c.entityB.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${c.score * 100}%`,
                                backgroundColor: getDomainColor(
                                  c.entityA.domain,
                                ),
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">
                            {(c.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      {selectedCorrelation === c && (
                        <div className="mt-2 pt-2 border-t">
                          <p className="text-xs text-gray-500 font-medium mb-1">
                            Evidence:
                          </p>
                          <ul className="text-xs text-gray-600 space-y-0.5">
                            {c.evidence.map((e, j) => (
                              <li key={j} className="flex items-start gap-1">
                                <span className="text-indigo-400 mt-0.5">
                                  •
                                </span>
                                {e}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <BarChart3 className="h-12 w-12 mb-4" />
              <p className="text-sm">
                Select domains and run a query, or try an interesting query above
              </p>
            </div>
          )}

          <VisualizationRecommendations panelType="correlation" onClose={onClose} />
        </div>
      </div>
    </>
  );
}
