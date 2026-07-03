import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Network, AlertTriangle } from "lucide-react";
import { NetworkGraph } from "@/components/visualizations/shared/NetworkGraph";
import { Button } from "@/components/ui/button";
import { STALE_TIMES } from "@/lib/queryClient";
import {
  toNetworkGraph,
  labelLegend,
  labelColor,
  isEmptyNeighborhood,
  type NeighborhoodPayload,
} from "@/lib/graph/neighborhood-graph";
import { ProvenanceBadge } from "@/components/graph/Provenance";
import { extractProvenance } from "@/lib/graph/provenance";

/**
 * Renders an entity's shared-graph neighborhood (US-007) by fetching
 * `GET /api/graph/neighborhood/:id?depth=` and projecting the result through the
 * generic {@link NetworkGraph} force renderer: nodes are coloured/typed by their
 * first `:LABEL`, edges are labelled by their `:TYPE`, and the traversal depth is
 * adjustable between 1 and 3 hops.
 *
 * Loading, empty, and graph-unavailable states are all handled here so callers
 * (e.g. the "Show in graph" dialog on entity detail panels) can mount it blindly.
 * This module is intended to be `React.lazy`-loaded — d3 + the force renderer are
 * heavy and only needed once a user actually opens the graph.
 */
export interface GraphNeighborhoodViewProps {
  /** The shared-graph csid to center the neighborhood on. */
  csid: string;
  /** Initial traversal depth (clamped to 1..3). Defaults to 1. */
  initialDepth?: number;
  /** Optional heading shown above the graph. */
  title?: string;
}

const DEPTHS = [1, 2, 3] as const;

export default function GraphNeighborhoodView({
  csid,
  initialDepth = 1,
  title,
}: GraphNeighborhoodViewProps) {
  const [depth, setDepth] = useState(() =>
    Math.min(3, Math.max(1, Math.round(initialDepth))),
  );

  const { data, isLoading, isError } = useQuery<NeighborhoodPayload>({
    queryKey: ["/api/graph/neighborhood", csid, { depth }],
    staleTime: STALE_TIMES.derived,
    retry: false,
  });

  const graph = data ? toNetworkGraph(data) : null;
  const legend = data ? labelLegend(data) : [];
  const rootProvenance = data ? extractProvenance(data.root.properties) : null;

  return (
    <div className="flex flex-col gap-3 h-full min-h-[420px]" data-testid="graph-neighborhood-view">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Network className="h-4 w-4" />
          {title ?? "Graph neighborhood"}
          <ProvenanceBadge provenance={rootProvenance} />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Traversal depth">
          <span className="text-xs text-gray-500 mr-1">Depth</span>
          {DEPTHS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={d === depth ? "default" : "outline"}
              className="h-7 w-7 p-0"
              aria-pressed={d === depth}
              onClick={() => setDepth(d)}
              data-testid={`graph-depth-${d}`}
            >
              {d}
            </Button>
          ))}
        </div>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid="graph-legend">
          {legend.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-[320px]">
        {isLoading ? (
          <div
            className="flex h-full min-h-[320px] items-center justify-center text-gray-400 gap-2 text-sm"
            data-testid="graph-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading graph…
          </div>
        ) : isError ? (
          <div
            className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-gray-500 gap-2 text-sm"
            data-testid="graph-unavailable"
          >
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <p>The shared graph is unavailable right now.</p>
            <p className="text-xs text-gray-400">Graph features will return automatically once it is back online.</p>
          </div>
        ) : isEmptyNeighborhood(data) ? (
          <div
            className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-gray-400 gap-1 text-sm"
            data-testid="graph-empty"
          >
            <Network className="h-5 w-5" />
            <p>No connections found in the shared graph.</p>
          </div>
        ) : (
          graph && (
            <NetworkGraph
              nodes={graph.nodes}
              edges={graph.edges}
              colorScale={labelColor}
              selectedNodeId={csid}
              showLabels
            />
          )
        )}
      </div>
    </div>
  );
}
