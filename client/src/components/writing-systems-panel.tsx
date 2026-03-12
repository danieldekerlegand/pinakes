import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X, Type, ChevronRight, Calendar, MapPin, Globe } from "lucide-react";
import * as d3 from "d3";

interface WritingSystem {
  id: string;
  name: string;
  type: string;
  direction: string;
  parentSystemId: string;
  languageIds: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

interface WritingSystemsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Colors for writing system types
const TYPE_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  alphabet: { bg: "bg-blue-500", text: "text-blue-700", fill: "#3b82f6" },
  abjad: { bg: "bg-emerald-500", text: "text-emerald-700", fill: "#10b981" },
  abugida: { bg: "bg-amber-500", text: "text-amber-700", fill: "#f59e0b" },
  syllabary: { bg: "bg-purple-500", text: "text-purple-700", fill: "#8b5cf6" },
  logographic: { bg: "bg-red-500", text: "text-red-700", fill: "#ef4444" },
  featural: { bg: "bg-pink-500", text: "text-pink-700", fill: "#ec4899" },
};

const DIRECTION_LABELS: Record<string, string> = {
  LTR: "Left to Right →",
  RTL: "Right to Left ←",
  TTB: "Top to Bottom ↓",
};

type ViewMode = "tree" | "grid";

interface TreeNode {
  id: string;
  name: string;
  type: string;
  children: TreeNode[];
  data: WritingSystem;
}

export default function WritingSystemsPanel({ isOpen, onClose }: WritingSystemsPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [selectedSystem, setSelectedSystem] = useState<WritingSystem | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: systemsResponse } = useQuery<{ systems: WritingSystem[]; count: number }>({
    queryKey: ["/api/writing-systems"],
    enabled: isOpen,
  });

  const systems = systemsResponse?.systems || [];

  // Apply filters
  const filteredSystems = useMemo(() => {
    return systems.filter((sys) => {
      if (typeFilter !== "all" && sys.type !== typeFilter) return false;
      if (activeFilter === "active" && !sys.isActive) return false;
      if (activeFilter === "historical" && sys.isActive) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          sys.name.toLowerCase().includes(term) ||
          sys.type.toLowerCase().includes(term) ||
          sys.originRegion.toLowerCase().includes(term) ||
          sys.sampleCharacters.includes(searchTerm)
        );
      }
      return true;
    });
  }, [systems, typeFilter, activeFilter, searchTerm]);

  // Build tree hierarchy from parent-child relationships
  const treeData = useMemo(() => {
    if (systems.length === 0) return null;

    const systemMap = new Map<string, WritingSystem>();
    systems.forEach((s) => systemMap.set(s.id, s));

    // Build tree nodes
    const nodeMap = new Map<string, TreeNode>();
    systems.forEach((s) => {
      nodeMap.set(s.id, { id: s.id, name: s.name, type: s.type, children: [], data: s });
    });

    // Attach children to parents
    const roots: TreeNode[] = [];
    systems.forEach((s) => {
      const node = nodeMap.get(s.id)!;
      if (s.parentSystemId && nodeMap.has(s.parentSystemId)) {
        nodeMap.get(s.parentSystemId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Create a virtual root if multiple roots
    if (roots.length === 1) return roots[0];
    return { id: "root", name: "Writing Systems", type: "root", children: roots, data: null as unknown as WritingSystem };
  }, [systems]);

  // D3 tree rendering
  const renderTree = useCallback(() => {
    if (!svgRef.current || !containerRef.current || !treeData) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const container = containerRef.current;
    const width = container.clientWidth;
    const nodeHeight = 60;

    // Count total leaf nodes for height calculation
    const countLeaves = (node: TreeNode): number => {
      if (node.children.length === 0) return 1;
      return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
    };
    const totalLeaves = countLeaves(treeData);
    const height = Math.max(500, totalLeaves * nodeHeight);

    svg.attr("width", width).attr("height", height);

    const g = svg.append("g").attr("transform", "translate(40, 20)");

    // Create D3 hierarchy
    const root = d3.hierarchy(treeData, (d) => d.children);
    const treeLayout = d3.tree<TreeNode>().size([height - 40, width - 280]);
    treeLayout(root);

    // Links
    g.selectAll(".link")
      .data(root.links())
      .join("path")
      .attr("class", "link")
      .attr("d", (d) => {
        const sy = d.source.y ?? 0;
        const sx = d.source.x ?? 0;
        const ty = d.target.y ?? 0;
        const tx = d.target.x ?? 0;
        return `M ${sy} ${sx}
                C ${(sy + ty) / 2} ${sx},
                  ${(sy + ty) / 2} ${tx},
                  ${ty} ${tx}`;
      })
      .attr("fill", "none")
      .attr("stroke", "#d1d5db")
      .attr("stroke-width", 1.5);

    // Node groups
    const nodes = g
      .selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${d.y}, ${d.x})`)
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        if (d.data.data && d.data.id !== "root") {
          setSelectedSystem(d.data.data);
        }
      });

    // Node circles
    nodes
      .append("circle")
      .attr("r", (d) => (d.data.id === "root" ? 6 : d.data.data?.isActive ? 8 : 6))
      .attr("fill", (d) => {
        if (d.data.id === "root") return "#6b7280";
        const typeColor = TYPE_COLORS[d.data.type];
        return typeColor ? typeColor.fill : "#6b7280";
      })
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .attr("opacity", (d) => (d.data.data?.isActive === false ? 0.6 : 1));

    // Node labels - name
    nodes
      .append("text")
      .attr("dy", -12)
      .attr("x", 0)
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .text((d) => d.data.name);

    // Node labels - sample characters
    nodes
      .filter((d) => d.data.id !== "root" && Boolean(d.data.data?.sampleCharacters))
      .append("text")
      .attr("dy", 20)
      .attr("x", 0)
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "#9ca3af")
      .text((d) => {
        const chars = d.data.data?.sampleCharacters || "";
        return chars.length > 20 ? chars.substring(0, 20) + "…" : chars;
      });

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);
    // Set initial transform
    svg.call(zoom.transform, d3.zoomIdentity.translate(40, 20));
  }, [treeData]);

  useEffect(() => {
    if (viewMode === "tree" && isOpen) {
      // Small delay for DOM to render
      const timer = setTimeout(renderTree, 100);
      return () => clearTimeout(timer);
    }
  }, [viewMode, isOpen, renderTree]);

  if (!isOpen) return null;

  const getTypeColor = (type: string) => TYPE_COLORS[type] || { bg: "bg-gray-500", text: "text-gray-700", fill: "#6b7280" };

  // Get unique types for filter
  const types = Array.from(new Set(systems.map((s) => s.type))).sort();

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-[1100px] max-w-[95vw] bg-white shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Type className="h-5 w-5 mr-2" />
                Writing Systems Explorer
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Explore script evolution, geographic distribution, and writing system details
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex-shrink-0 border-b border-gray-200 p-4 space-y-3">
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <Input
                placeholder="Search writing systems..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Type filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {types.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Active/Historical filter */}
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="historical">Historical</SelectItem>
              </SelectContent>
            </Select>

            {/* View mode toggle */}
            <div className="flex border rounded-lg overflow-hidden">
              <Button
                variant={viewMode === "tree" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("tree")}
                className="rounded-none"
              >
                Family Tree
              </Button>
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="rounded-none"
              >
                Grid View
              </Button>
            </div>
          </div>

          {/* Type legend */}
          <div className="flex flex-wrap gap-2">
            {types.map((type) => {
              const color = getTypeColor(type);
              return (
                <Badge key={type} className={`${color.bg} text-white text-xs`}>
                  {type}
                </Badge>
              );
            })}
            <span className="text-xs text-gray-500 ml-2 self-center">
              {filteredSystems.length} of {systems.length} systems
            </span>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Tree or Grid */}
          <div className={`flex-1 overflow-auto ${selectedSystem ? "border-r" : ""}`}>
            {viewMode === "tree" ? (
              <div ref={containerRef} className="w-full h-full min-h-[500px]">
                <svg ref={svgRef} className="w-full" />
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="p-4 grid grid-cols-2 gap-3">
                  {filteredSystems.map((sys) => {
                    const color = getTypeColor(sys.type);
                    return (
                      <Card
                        key={sys.id}
                        className={`p-3 cursor-pointer hover:shadow-md transition-shadow ${
                          selectedSystem?.id === sys.id ? "ring-2 ring-blue-500" : ""
                        } ${!sys.isActive ? "opacity-75" : ""}`}
                        onClick={() => setSelectedSystem(sys)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-sm truncate">{sys.name}</h4>
                              <Badge className={`${color.bg} text-white text-[10px] px-1.5 py-0`}>
                                {sys.type}
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {sys.direction} · {sys.originRegion} · {sys.characterCount} chars
                            </p>
                          </div>
                          {!sys.isActive && (
                            <Badge variant="outline" className="text-[10px] ml-1 shrink-0">
                              Historical
                            </Badge>
                          )}
                        </div>
                        <div className="mt-2 font-mono text-lg text-gray-700 truncate">
                          {sys.sampleCharacters}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Right: Detail Panel */}
          {selectedSystem && (
            <div className="w-[350px] flex-shrink-0 overflow-y-auto bg-gray-50">
              <div className="p-4 space-y-4">
                {/* Close detail */}
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{selectedSystem.name}</h3>
                  <button
                    onClick={() => setSelectedSystem(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Type & Direction badges */}
                <div className="flex flex-wrap gap-2">
                  <Badge className={`${getTypeColor(selectedSystem.type).bg} text-white`}>
                    {selectedSystem.type}
                  </Badge>
                  <Badge variant="outline">
                    {DIRECTION_LABELS[selectedSystem.direction] || selectedSystem.direction}
                  </Badge>
                  <Badge variant={selectedSystem.isActive ? "default" : "secondary"}>
                    {selectedSystem.isActive ? "Active" : "Historical"}
                  </Badge>
                </div>

                {/* Sample characters - large */}
                <Card className="p-4 bg-white">
                  <p className="text-xs text-gray-500 mb-2">Sample Characters</p>
                  <p
                    className="text-2xl font-serif leading-relaxed text-gray-800"
                    dir={selectedSystem.direction === "RTL" ? "rtl" : "ltr"}
                  >
                    {selectedSystem.sampleCharacters}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    {selectedSystem.characterCount} characters in system
                  </p>
                </Card>

                {/* Origin info */}
                <Card className="p-4 bg-white space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Origin:</span>
                    <span className="font-medium">
                      {selectedSystem.originDate.startsWith("-")
                        ? `${selectedSystem.originDate.slice(1)} BCE`
                        : `${selectedSystem.originDate} CE`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Region:</span>
                    <span className="font-medium">{selectedSystem.originRegion}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-600">Unicode:</span>
                    <span className="font-medium text-xs">{selectedSystem.unicodeBlock}</span>
                  </div>
                </Card>

                {/* Associated Languages */}
                {selectedSystem.languageIds.length > 0 && (
                  <Card className="p-4 bg-white">
                    <p className="text-xs text-gray-500 mb-2">
                      Associated Languages ({selectedSystem.languageIds.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedSystem.languageIds.map((langId) => (
                        <Badge key={langId} variant="outline" className="text-xs">
                          {langId}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Parent system */}
                {selectedSystem.parentSystemId && (
                  <Card className="p-4 bg-white">
                    <p className="text-xs text-gray-500 mb-2">Derived From</p>
                    <button
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                      onClick={() => {
                        const parent = systems.find((s) => s.id === selectedSystem.parentSystemId);
                        if (parent) setSelectedSystem(parent);
                      }}
                    >
                      <ChevronRight className="h-3 w-3" />
                      {systems.find((s) => s.id === selectedSystem.parentSystemId)?.name ||
                        selectedSystem.parentSystemId}
                    </button>
                  </Card>
                )}

                {/* Descendant systems */}
                {(() => {
                  const descendants = systems.filter(
                    (s) => s.parentSystemId === selectedSystem.id
                  );
                  if (descendants.length === 0) return null;
                  return (
                    <Card className="p-4 bg-white">
                      <p className="text-xs text-gray-500 mb-2">
                        Descendant Systems ({descendants.length})
                      </p>
                      <div className="space-y-1">
                        {descendants.map((desc) => (
                          <button
                            key={desc.id}
                            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 w-full text-left"
                            onClick={() => setSelectedSystem(desc)}
                          >
                            <ChevronRight className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{desc.name}</span>
                            <Badge
                              className={`${getTypeColor(desc.type).bg} text-white text-[10px] px-1 py-0 ml-auto flex-shrink-0`}
                            >
                              {desc.type}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </Card>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
