/**
 * Automated hypothesis & site-location generation (US-007).
 *
 * Surfaces two families of *generated, explicitly-speculative* research leads from
 * `GET /api/hypotheses`:
 *   - **common-ancestor hypotheses** — clusters of distant, unrelated cultures that
 *     share the same rare trait(s), a lead for shared ancestry / diffusion, and
 *   - **undiscovered-site-region predictions** — gaps along documented migration
 *     corridors, rendered on a Leaflet map as circle overlays whose radius is the
 *     positional **uncertainty** and whose styling encodes confidence.
 *
 * Everything here is framed as a hypothesis, never a conclusion, and is visibly
 * distinct from the curated `urheimat-hypotheses` dataset.
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip } from "react-leaflet";
import { AlertTriangle, FlaskConical, MapPin, Sparkles, Users } from "lucide-react";
import "leaflet/dist/leaflet.css";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type SitePrediction,
  buildUncertaintyCircles,
  overlayCenter,
} from "@/lib/hypotheses/site-overlay";

interface SharedTrait {
  type: string;
  key: string;
  label: string;
  prevalence: number;
  rarity: number;
}
interface AncestorHypothesis {
  id: string;
  members: { id: string; name: string; domain: string }[];
  sharedTraits: SharedTrait[];
  centroid: { lat: number; lng: number } | null;
  spreadKm: number | null;
  confidence: number;
  hypothesis: string;
  provenance: string[];
}
interface HypothesisResponse {
  ancestorHypotheses: AncestorHypothesis[];
  sitePredictions: SitePrediction[];
  stats: {
    nodesConsidered: number;
    clustersFound: number;
    corridorsScanned: number;
    knownSites: number;
  };
  disclaimer: string;
  distinctFromCurated: string;
}

function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

function confidenceTone(c: number): string {
  if (c >= 0.6) return "bg-violet-500/15 text-violet-700 dark:text-violet-300";
  if (c >= 0.4) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

function Section({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

export default function HypothesesPage() {
  const { data, isLoading, isError } = useQuery<HypothesisResponse>({
    queryKey: ["/api/hypotheses"],
  });

  const ancestor = data?.ancestorHypotheses ?? [];
  const predictions = data?.sitePredictions ?? [];

  const circles = useMemo(
    () => buildUncertaintyCircles(predictions),
    [predictions],
  );
  const center = useMemo(() => overlayCenter(predictions), [predictions]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" data-testid="hypotheses-page">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-violet-600" />
          <h1 className="text-2xl font-bold">Automated Hypotheses</h1>
          <Badge variant="outline" className="border-violet-400 text-violet-700 dark:text-violet-300">
            Speculative · AI-generated
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Machine-generated research leads over the shared corpus — clusters of
          distant cultures sharing a rare trait, and regions where an undiscovered
          site may lie along documented migration corridors.
        </p>
      </header>

      <Card className="border-amber-400/50 bg-amber-500/5">
        <CardContent className="flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              {data?.disclaimer ??
                "Generated hypotheses are leads, not conclusions."}
            </p>
            <p className="text-xs text-muted-foreground">
              {data?.distinctFromCurated ??
                "Distinct from the curated urheimat-hypotheses dataset."}
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Generating hypotheses…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Could not generate hypotheses right now.
        </p>
      )}

      {/* ---- Undiscovered-site-region predictions (map overlay w/ uncertainty) ---- */}
      <Section>
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-violet-600" />
          <h2 className="text-lg font-semibold">
            Predicted undiscovered-site regions
          </h2>
          <Badge variant="secondary">{predictions.length}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Each circle marks a stretch of a migration corridor far from any recorded
          site; the <strong>circle radius is the positional uncertainty</strong> and
          fainter, dashed circles are lower-confidence leads.
        </p>
        <Card>
          <CardContent className="p-0">
            <div className="h-[420px] w-full overflow-hidden rounded-md" data-testid="prediction-map">
              <MapContainer
                center={center}
                zoom={2}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
                className="z-0"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {circles.map((c) => (
                  <Circle
                    key={c.id}
                    center={c.center}
                    radius={c.radiusMeters}
                    pathOptions={{
                      color: c.color,
                      weight: c.weight,
                      fillColor: c.color,
                      fillOpacity: c.fillOpacity,
                      dashArray: c.dashed ? "6 6" : undefined,
                    }}
                  >
                    <Tooltip>
                      <div className="max-w-[240px] space-y-1 text-xs">
                        <div className="font-semibold">{c.corridorName}</div>
                        <div>
                          Confidence {pct(c.confidence)} · ±{c.uncertaintyRadiusKm} km
                        </div>
                        <div className="text-muted-foreground">{c.rationale}</div>
                      </div>
                    </Tooltip>
                  </Circle>
                ))}
                {circles.map((c) => (
                  <CircleMarker
                    key={`${c.id}-dot`}
                    center={c.center}
                    radius={3}
                    pathOptions={{ color: c.color, fillColor: c.color, fillOpacity: 1 }}
                  />
                ))}
              </MapContainer>
            </div>
          </CardContent>
        </Card>
        {predictions.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">
            No site-region predictions from the current corridors and known sites.
          </p>
        )}
      </Section>

      {/* ---- Common-ancestor hypotheses ---- */}
      <Section>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-violet-600" />
          <h2 className="text-lg font-semibold">Possible shared-ancestry clusters</h2>
          <Badge variant="secondary">{ancestor.length}</Badge>
        </div>
        {ancestor.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">
            No distant, unrelated cultures currently share a rare-enough trait to
            surface a cluster.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {ancestor.map((h) => (
            <Card key={h.id} data-testid="ancestor-hypothesis">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    {h.members.length} cultures
                  </span>
                  <Badge className={confidenceTone(h.confidence)}>
                    {pct(h.confidence)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {h.members.map((m) => (
                    <Badge key={m.id} variant="outline">
                      {m.name}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {h.sharedTraits.slice(0, 6).map((t) => (
                    <Badge key={t.key} variant="secondary" title={`rarity ${t.rarity}`}>
                      {t.label}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{h.hypothesis}</p>
                {h.spreadKm !== null && (
                  <p className="text-xs text-muted-foreground">
                    Up to ~{h.spreadKm.toLocaleString("en-US")} km apart
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      {data && (
        <p className="text-xs text-muted-foreground">
          Scanned {data.stats.nodesConsidered} cultures ·{" "}
          {data.stats.corridorsScanned} corridors · {data.stats.knownSites} known
          sites.
        </p>
      )}
    </div>
  );
}
