import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Share2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GraphFeatureGate } from "@/components/graph/GraphFeatureGate";
import { STALE_TIMES } from "@/lib/queryClient";

// The neighborhood view pulls in d3 + the force renderer, so only load it when a
// user actually opens the graph (US-007: "a lazy-loaded React component").
const GraphNeighborhoodView = lazy(
  () => import("@/components/graph/GraphNeighborhoodView"),
);

/** A LinguaScrape entity reference to resolve into a shared-graph node. */
export interface GraphEntityRef {
  /** Canonical node type, e.g. `"language"`, `"culture"`. */
  type: string;
  /** LinguaScrape local id — the strong signal for resolution. */
  id?: string;
  /** Display name — used for the fuzzy fallback when the id doesn't match. */
  name?: string;
  /** Optional region to disambiguate fuzzy candidates. */
  region?: string;
}

interface ResolvedCsid {
  csid: string;
  confidence: number;
  method: "alias" | "fuzzy";
}

interface ResolveResponse {
  resolved: ResolvedCsid | null;
}

/**
 * A "Show in graph" affordance for entity detail panels (US-007). When the shared
 * graph is offline the trigger is gated (dimmed + tooltip) via
 * {@link GraphFeatureGate}; when online, clicking it opens a dialog that resolves
 * the entity to its shared-graph csid (US-006) and renders the neighborhood.
 *
 * Resolution runs server-side against the convergence alias table and only fires
 * once the dialog opens, so it never touches the graph on an unrelated render.
 */
export interface ShowInGraphButtonProps {
  /** The entity to locate in the shared graph. */
  entity: GraphEntityRef;
  /** Button label. Defaults to "Show in graph". */
  label?: string;
  /** Passed through to the trigger Button. */
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

export function ShowInGraphButton({
  entity,
  label = "Show in graph",
  variant = "ghost",
  size = "sm",
  className,
}: ShowInGraphButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <GraphFeatureGate backend="neo4j" mode="disable">
        <Button
          variant={variant}
          size={size}
          className={className}
          onClick={() => setOpen(true)}
          aria-label={label || "Show in graph"}
          title={label || "Show in graph"}
          data-testid="button-show-in-graph"
        >
          <Share2 className={label ? "h-4 w-4 mr-2" : "h-4 w-4"} />
          {label}
        </Button>
      </GraphFeatureGate>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              {entity.name ?? "Entity"} in the shared graph
            </DialogTitle>
            <DialogDescription>
              Cultural connections for this entity in the culture-scrape graph.
            </DialogDescription>
          </DialogHeader>
          {open && <ShowInGraphBody entity={entity} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The dialog body: resolves the entity to a csid, then lazy-loads the
 * neighborhood view. Kept separate so its resolve query only mounts (and fires)
 * while the dialog is open.
 */
function ShowInGraphBody({ entity }: { entity: GraphEntityRef }) {
  const { data, isLoading, isError } = useQuery<ResolveResponse>({
    queryKey: ["/api/graph/resolve", entity],
    staleTime: STALE_TIMES.static,
    retry: false,
  });

  if (isLoading) {
    return (
      <div
        className="flex h-[320px] items-center justify-center gap-2 text-sm text-gray-400"
        data-testid="graph-resolve-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Locating in the graph…
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="flex h-[320px] flex-col items-center justify-center text-center text-sm text-gray-500"
        data-testid="graph-resolve-error"
      >
        The shared graph is unavailable right now.
      </div>
    );
  }

  const resolved = data?.resolved ?? null;
  if (!resolved) {
    return (
      <div
        className="flex h-[320px] flex-col items-center justify-center gap-1 text-center text-sm text-gray-400"
        data-testid="graph-resolve-empty"
      >
        <p>This entity isn't in the shared graph yet.</p>
        <p className="text-xs">It may not have been reconciled during convergence.</p>
      </div>
    );
  }

  return (
    <div className="h-[460px]">
      {resolved.method === "fuzzy" && (
        <div className="mb-2">
          <Badge variant="outline" className="text-xs" data-testid="graph-resolve-confidence">
            Fuzzy match · {Math.round(resolved.confidence * 100)}% confidence
          </Badge>
        </div>
      )}
      <Suspense
        fallback={
          <div className="flex h-[320px] items-center justify-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading graph…
          </div>
        }
      >
        <GraphNeighborhoodView csid={resolved.csid} title={entity.name} />
      </Suspense>
    </div>
  );
}
