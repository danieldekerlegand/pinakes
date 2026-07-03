import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGraphAvailability } from "@/hooks/use-graph-availability";
import type { GraphBackend } from "@/lib/graph/availability";

/**
 * Gates graph-dependent UI on shared-graph availability (US-005).
 *
 * When the required `backend` is reachable, the children render untouched. When
 * it is offline the gate either:
 *   - `mode="hide"`    — renders `fallback` (default: nothing), or
 *   - `mode="disable"` — renders the children visually dimmed and
 *                        non-interactive, wrapped in a tooltip that explains why.
 *
 * This is the reusable primitive that future graph features (neighborhood view,
 * the culture-scrape explorer adapter, federated search, the research console)
 * wrap their trigger buttons/tabs with, so degradation is consistent and no
 * graph feature is ever presented as clickable-but-broken.
 */
export interface GraphFeatureGateProps {
  /** Which backend this feature needs. Defaults to `any`. */
  backend?: GraphBackend;
  /** `disable` (dim + tooltip) or `hide` (render fallback). Defaults to `disable`. */
  mode?: "disable" | "hide";
  /** What to render when unavailable and `mode="hide"`. Defaults to nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

export function GraphFeatureGate({
  backend = "any",
  mode = "disable",
  fallback = null,
  children,
}: GraphFeatureGateProps) {
  const graph = useGraphAvailability();

  if (graph.isEnabled(backend)) {
    return <>{children}</>;
  }

  if (mode === "hide") {
    return <>{fallback}</>;
  }

  const reason = graph.unavailableReason(backend);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Outer span stays hoverable so the tooltip fires; inner span blocks
            interaction with the disabled feature. */}
        <span
          className="inline-flex cursor-not-allowed opacity-50"
          aria-disabled="true"
          data-testid="graph-feature-gate-disabled"
        >
          <span className="pointer-events-none">{children}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
