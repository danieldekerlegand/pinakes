import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Pyramid, CircleDot, Network, Crown } from "lucide-react";
import { NetworkGraph } from "./shared/NetworkGraph";
import {
  buildHierarchyTiers,
  buildOrgChart,
  buildPatronNetwork,
  concentricRadii,
  pyramidWidths,
  type HierarchyTier,
  type SocialStructure,
  type VisualizationMode,
} from "./social-hierarchy-utils";

interface SocialStructuresResponse {
  structures: SocialStructure[];
  count: number;
}

interface Props {
  cultureProfileId: string;
  onClassSelect?: (classKey: string) => void;
  className?: string;
}

export function SocialHierarchyView({ cultureProfileId, onClassSelect, className = "" }: Props) {
  const [mode, setMode] = useState<VisualizationMode>("pyramid");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);

  const { data, isLoading } = useQuery<SocialStructuresResponse>({
    queryKey: [`/api/culture-profiles/${cultureProfileId}/social-structures`],
    enabled: !!cultureProfileId,
    staleTime: 5 * 60 * 1000,
  });

  const structures = data?.structures ?? [];

  const tiers = useMemo(() => buildHierarchyTiers(structures), [structures]);

  const handleTierClick = (classKey: string) => {
    setSelectedClass((prev) => (prev === classKey ? null : classKey));
    onClassSelect?.(classKey);
  };

  const primaryOrgStructure = useMemo(
    () => structures.find((s) => s.structureType === "government") ?? structures[0],
    [structures]
  );

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`} data-testid="social-hierarchy-loading">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading social hierarchy…</span>
      </div>
    );
  }

  if (tiers.length === 0) {
    return (
      <div className={`text-center py-12 text-gray-500 ${className}`} data-testid="social-hierarchy-empty">
        No social hierarchy data available for this culture.
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`} data-testid="social-hierarchy-view">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <Crown className="h-5 w-5 text-amber-600" />
          <h3 className="text-base font-semibold text-gray-900">Social Hierarchy</h3>
          <Badge variant="outline" className="text-xs">{tiers.length} tiers</Badge>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as VisualizationMode)}>
          <TabsList>
            <TabsTrigger value="pyramid" data-testid="mode-pyramid">
              <Pyramid className="h-3.5 w-3.5 mr-1" /> Pyramid
            </TabsTrigger>
            <TabsTrigger value="circles" data-testid="mode-circles">
              <CircleDot className="h-3.5 w-3.5 mr-1" /> Circles
            </TabsTrigger>
            <TabsTrigger value="org-chart" data-testid="mode-org-chart">Org Chart</TabsTrigger>
            <TabsTrigger value="network" data-testid="mode-network">
              <Network className="h-3.5 w-3.5 mr-1" /> Network
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Card className="p-4">
        {mode === "pyramid" && (
          <PyramidView tiers={tiers} selectedClass={selectedClass} onTierClick={handleTierClick} />
        )}
        {mode === "circles" && (
          <ConcentricView tiers={tiers} selectedClass={selectedClass} onTierClick={handleTierClick} />
        )}
        {mode === "org-chart" && primaryOrgStructure && (
          <OrgChartView structure={primaryOrgStructure} />
        )}
        {mode === "network" && (
          <PatronNetworkView tiers={tiers} onNodeClick={handleTierClick} selectedClass={selectedClass} />
        )}
      </Card>

      {selectedClass && (
        <div className="text-xs text-gray-600 px-1" data-testid="selected-class-info">
          Filtering by class: <span className="font-semibold">{selectedClass}</span>.{" "}
          <button
            className="underline text-blue-600"
            onClick={() => {
              setSelectedClass(null);
              onClassSelect?.("");
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function PyramidView({
  tiers,
  selectedClass,
  onTierClick,
}: {
  tiers: HierarchyTier[];
  selectedClass: string | null;
  onTierClick: (classKey: string) => void;
}) {
  const widths = pyramidWidths(tiers.length);
  return (
    <div className="flex flex-col items-center space-y-1" data-testid="pyramid-view">
      {tiers.map((tier, idx) => {
        const width = widths[idx];
        const isSelected = selectedClass === tier.classKey;
        return (
          <button
            key={tier.id}
            className={`text-center text-white font-medium py-2.5 rounded transition-all hover:opacity-90 ${
              isSelected ? "ring-2 ring-offset-2 ring-blue-500" : ""
            }`}
            style={{ width: `${width}%`, backgroundColor: tier.color, minWidth: "120px" }}
            onClick={() => onTierClick(tier.classKey)}
            data-testid={`pyramid-tier-${tier.classKey}`}
            title={tier.description}
          >
            <div className="text-sm font-semibold">{tier.label}</div>
            <div className="text-xs opacity-90">
              ≈{tier.populationPercent}% · {tier.roles.length} roles
            </div>
          </button>
        );
      })}
      <TierLegend tiers={tiers} />
    </div>
  );
}

function ConcentricView({
  tiers,
  selectedClass,
  onTierClick,
}: {
  tiers: HierarchyTier[];
  selectedClass: string | null;
  onTierClick: (classKey: string) => void;
}) {
  const radii = concentricRadii(tiers.length);
  const reversed = [...tiers].reverse();
  return (
    <div className="flex flex-col items-center" data-testid="circles-view">
      <svg viewBox="-110 -110 220 220" className="w-full max-w-md h-auto">
        {reversed.map((tier, idx) => {
          const r = radii[radii.length - 1 - idx];
          const isSelected = selectedClass === tier.classKey;
          return (
            <g key={tier.id}>
              <circle
                cx={0}
                cy={0}
                r={r}
                fill={tier.color}
                fillOpacity={0.85}
                stroke={isSelected ? "#1d4ed8" : "#fff"}
                strokeWidth={isSelected ? 2.5 : 1.5}
                style={{ cursor: "pointer" }}
                onClick={() => onTierClick(tier.classKey)}
                data-testid={`circle-${tier.classKey}`}
              >
                <title>
                  {tier.label} · {tier.populationPercent}%
                </title>
              </circle>
            </g>
          );
        })}
        {tiers.map((tier, idx) => {
          const ringCenter = idx === 0 ? 0 : (radii[idx - 1] + radii[idx]) / 2;
          return (
            <text
              key={`label-${tier.id}`}
              x={0}
              y={-ringCenter + 3}
              textAnchor="middle"
              fontSize={idx === 0 ? 8 : 6}
              fill="#fff"
              pointerEvents="none"
            >
              {tier.label}
            </text>
          );
        })}
      </svg>
      <TierLegend tiers={tiers} />
    </div>
  );
}

function OrgChartView({ structure }: { structure: SocialStructure }) {
  const { nodes, edges } = useMemo(() => buildOrgChart(structure), [structure]);

  if (nodes.length === 0) {
    return <div className="text-sm text-gray-500 py-8 text-center">No roles defined for this structure.</div>;
  }

  const root = nodes[0];
  const subs = nodes.slice(1);

  return (
    <div className="space-y-4" data-testid="org-chart-view">
      <div className="text-center">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Head of {structure.name}</div>
        <div className="inline-block px-4 py-2 rounded bg-amber-700 text-white font-semibold">
          {root.label}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2 border-t pt-4">
        {subs.map((node) => (
          <div
            key={node.id}
            className="px-3 py-1.5 rounded border bg-gray-50 text-sm text-gray-800"
            data-testid={`org-role-${node.id}`}
          >
            {node.label}
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500 text-center">
        {edges.length} reporting relationships · {nodes.length} roles
      </div>
    </div>
  );
}

function PatronNetworkView({
  tiers,
  onNodeClick,
  selectedClass,
}: {
  tiers: HierarchyTier[];
  onNodeClick: (classKey: string) => void;
  selectedClass: string | null;
}) {
  const { nodes, edges } = useMemo(() => buildPatronNetwork(tiers), [tiers]);

  const graphNodes = nodes.map((n) => ({
    id: n.id,
    label: n.label,
    category: n.category,
    metadata: { rank: n.rank },
  }));

  return (
    <div className="h-[400px]" data-testid="network-view">
      <NetworkGraph
        nodes={graphNodes}
        edges={edges.map((e) => ({ source: e.source, target: e.target, type: e.type }))}
        nodeColorFn={(n) => {
          const tier = tiers.find((t) => t.id === n.id);
          return tier?.color ?? "#6b7280";
        }}
        linkColorFn={(l) => (l.label === "authority" ? "#374151" : "#9ca3af")}
        selectedNodeId={selectedClass}
        onNodeClick={(n: any) => onNodeClick(n.id)}
        showLabels
      />
    </div>
  );
}

function TierLegend({ tiers }: { tiers: HierarchyTier[] }) {
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5 w-full" data-testid="tier-legend">
      {tiers.map((tier) => (
        <div key={tier.id} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-gray-50">
          <div className="w-3 h-3 rounded-sm mt-0.5 flex-shrink-0" style={{ backgroundColor: tier.color }} />
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate">{tier.label}</div>
            <div className="text-gray-600 truncate">
              {tier.roles.slice(0, 4).join(", ")}
              {tier.roles.length > 4 && "…"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default SocialHierarchyView;
