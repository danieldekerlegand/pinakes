import { Loader2, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GraphFeatureGate } from "@/components/graph/GraphFeatureGate";
import { ProvenanceBadge } from "@/components/graph/Provenance";
import { useRelatedEntities } from "@/hooks/use-related-entities";
import {
  humanizeRelationship,
  relatedEntityHref,
} from "@/lib/graph/related-entities";
import type { GraphEntityRef } from "@/components/graph/ShowInGraphButton";
import { hasProvenance } from "@/lib/graph/provenance";

/**
 * Generalised "Related entities" panel (US-006) — the shared successor to the
 * ad-hoc related-badge markup that used to live only in `CultureDataCard.tsx`.
 *
 * Drop it into any entity detail panel with a {@link GraphEntityRef}
 * (language, culture/civilization, battle, religion, …) and it resolves the
 * entity to the shared graph, lists its ranked related entities, and annotates
 * each relationship with its provenance so a researcher can trust it.
 *
 * It is gated behind {@link GraphFeatureGate} (`mode="hide"`), so on a build
 * without the shared graph the section simply doesn't appear — no broken UI.
 */
export interface RelatedEntitiesProps {
  /** The entity whose relations to show. */
  entity: GraphEntityRef;
  /** Section heading. Defaults to "Related entities". */
  title?: string;
  /** Cap the number of related entities shown. Defaults to 8. */
  limit?: number;
  className?: string;
}

export function RelatedEntities({
  entity,
  title = "Related entities",
  limit = 8,
  className,
}: RelatedEntitiesProps) {
  return (
    <GraphFeatureGate backend="neo4j" mode="hide">
      <RelatedEntitiesBody
        entity={entity}
        title={title}
        limit={limit}
        className={className}
      />
    </GraphFeatureGate>
  );
}

function RelatedEntitiesBody({
  entity,
  title,
  limit,
  className,
}: Required<Omit<RelatedEntitiesProps, "className">> & { className?: string }) {
  const { related, isLoading, isError } = useRelatedEntities(entity, { limit });

  // While loading, or when there is genuinely nothing to show, render nothing so
  // the panel doesn't sprout an empty section. (Availability is already gated.)
  if (isError) return null;
  if (isLoading) {
    return (
      <div className={className}>
        <SectionHeading title={title} />
        <div
          className="flex items-center gap-2 text-xs text-gray-400"
          data-testid="related-entities-loading"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Finding connections…
        </div>
      </div>
    );
  }
  if (related.length === 0) return null;

  return (
    <div className={className} data-testid="related-entities">
      <SectionHeading title={title} />
      <ul className="space-y-1.5">
        {related.map((rel) => (
          <li
            key={`${rel.csid}:${rel.relationship}`}
            className="flex items-center justify-between gap-2 rounded-md border border-gray-100 dark:border-gray-800 px-2 py-1.5"
            data-testid={`related-entity-${rel.csid}`}
          >
            <div className="min-w-0 flex-1">
              <a
                href={relatedEntityHref(rel.csid)}
                className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:underline truncate block"
              >
                {rel.name}
              </a>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {humanizeRelationship(rel.relationship)}
                </Badge>
                {rel.type && (
                  <span className="text-[10px] text-gray-400">{rel.type}</span>
                )}
              </div>
            </div>
            {hasProvenance(rel.provenance) && (
              <ProvenanceBadge provenance={rel.provenance} isEdge />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
      <Network className="h-4 w-4 text-gray-400" />
      {title}
    </h3>
  );
}

export default RelatedEntities;
