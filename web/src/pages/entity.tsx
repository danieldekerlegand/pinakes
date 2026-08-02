import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Copy, Check, ExternalLink, Map as MapIcon } from "lucide-react";
import CiteButton from "@/components/culture-profile/cite-button";

/**
 * Canonical per-entity landing page (US-009) at `/entity/:domain/:id`.
 *
 * This is the permanent, citable URL for a single entity of any major type. It
 * resolves the id via `/api/entity/:domain/:id` (a resolver over the pure
 * `entity-resolver` registry), then renders a stable summary card: name, type,
 * the copyable canonical URL + stable `cs:` id, a Cite action for citable domains
 * (US-008), and links to the richer detail/explorer views. Unknown or renamed ids
 * resolve to a graceful "not found" (AC3) rather than a hard error.
 */

interface ResolvedEntity {
  domain: string;
  id: string;
  name: string;
  entityType: string;
  label: string;
  stableId: string;
  canonicalPath: string;
  canonicalUrl: string;
  apiPath: string;
  citable: boolean;
  citationDomain: string | null;
  viewPath: string | null;
  region: string | null;
  year: number | null;
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (typeof window !== "undefined") {
        window.prompt(`Copy ${label}`, value);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <code className="block truncate text-sm" title={value} data-testid="entity-canonical-value">
          {value}
        </code>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        data-testid="entity-copy"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function EntityPage() {
  const [, params] = useRoute("/entity/:domain/:id");
  const domain = params?.domain ?? "";
  const id = params?.id ?? "";

  const {
    data: entity,
    isLoading,
    isError,
  } = useQuery<ResolvedEntity>({
    queryKey: ["/api/entity", domain, id],
    enabled: !!domain && !!id,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/entity/${encodeURIComponent(domain)}/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Entity not found (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16" data-testid="entity-loading">
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (isError || !entity) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16" data-testid="entity-not-found">
        <Card>
          <CardContent className="pt-6">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-red-500" />
              <h1 className="text-xl font-bold">Entity not found</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              No record matches this canonical URL. The id{" "}
              <code className="rounded bg-muted px-1">{id || "—"}</code> may have been renamed or removed.
            </p>
            <Link href="/explore">
              <Button variant="outline" size="sm" className="mt-4">
                <MapIcon className="mr-2 h-4 w-4" /> Open the Explorer
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const absoluteUrl =
    typeof window !== "undefined" ? `${window.location.origin}${entity.canonicalPath}` : entity.canonicalUrl;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12" data-testid="entity-page">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge variant="secondary" className="mb-2" data-testid="entity-type-badge">
                {entity.label}
              </Badge>
              <CardTitle className="text-2xl" data-testid="entity-name">
                {entity.name}
              </CardTitle>
              {(entity.region || entity.year !== null) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {[entity.region, entity.year !== null ? formatYear(entity.year) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            {entity.citable && entity.citationDomain && (
              <CiteButton domain={entity.citationDomain} entityId={entity.id} filename={entity.name} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyLine label="Canonical URL" value={absoluteUrl} />
          <CopyLine label="Stable ID" value={entity.stableId} />

          <div className="flex flex-wrap gap-2 pt-2">
            {entity.viewPath && (
              <Link href={entity.viewPath}>
                <Button size="sm" data-testid="entity-view-detail">
                  <ExternalLink className="mr-2 h-4 w-4" /> View full detail
                </Button>
              </Link>
            )}
            <Link href="/explore">
              <Button variant="outline" size="sm" data-testid="entity-view-explorer">
                <MapIcon className="mr-2 h-4 w-4" /> Open in Explorer
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
