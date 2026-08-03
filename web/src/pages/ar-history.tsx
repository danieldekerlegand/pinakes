/**
 * AR historical-layer overlay (US-008).
 *
 * Point your phone at a place and see the historical layers (archaeological sites,
 * civilizations) that sit near your location, drawn on the live camera view for a
 * chosen era. The whole flow degrades gracefully:
 *   - WebXR / camera / geolocation are feature-detected (`useArSupport`,
 *     `historical-layers.detectArSupport`); on an unsupported device we fall back to
 *     a flat radar plot of the same layers with a clear explanation of why.
 *   - Layers reuse the existing temporal map data (`/api/map/archaeological-sites`
 *     + `/api/map/civilizations`), filtered to the user's location + era by the pure
 *     `selectHistoricalLayers`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  Compass,
  Info,
  Landmark,
  MapPin,
  ScanEye,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type GeoFeatureLike,
  type HistoricalLayer,
  selectHistoricalLayers,
} from "@/lib/ar/historical-layers";
import { useArSupport, useGeolocation } from "@/lib/ar/use-ar-support";

interface FeatureCollection {
  features?: GeoFeatureLike[];
}

/** Era presets over the existing temporal map data (year = negative for BCE). */
const ERAS: { label: string; year: number | undefined }[] = [
  { label: "All eras", year: undefined },
  { label: "Neolithic (5000 BCE)", year: -5000 },
  { label: "Bronze Age (2000 BCE)", year: -2000 },
  { label: "Iron Age (800 BCE)", year: -800 },
  { label: "Classical (1 CE)", year: 1 },
  { label: "Medieval (1000 CE)", year: 1000 },
  { label: "Modern (1900 CE)", year: 1900 },
];

const RADIUS_KM = 1000;

function bearingCompass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function reasonMessage(reason: string): string {
  switch (reason) {
    case "insecure-context":
      return "AR needs a secure (https) connection; showing a flat radar instead.";
    case "no-webxr":
      return "This browser has no WebXR — showing a flat radar of nearby layers instead.";
    case "no-immersive-ar":
      return "This device can't start an immersive-AR session — showing a flat radar instead.";
    case "no-geolocation":
      return "Geolocation is unavailable, so AR placement is disabled.";
    default:
      return "";
  }
}

function kindIcon(kind: HistoricalLayer["kind"]) {
  return kind === "civilization" ? Landmark : MapPin;
}

/**
 * Flat radar plot of the selected layers — the graceful fallback (and a live
 * mini-map inside the AR view). Bearing → angle, distance → radius.
 */
function LayerRadar({
  layers,
  radiusKm,
}: {
  layers: HistoricalLayer[];
  radiusKm: number;
}) {
  const size = 260;
  const c = size / 2;
  const maxR = c - 16;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto h-64 w-64"
      data-testid="layer-radar"
      role="img"
      aria-label="Radar of nearby historical layers"
    >
      {[0.33, 0.66, 1].map((f) => (
        <circle key={f} cx={c} cy={c} r={maxR * f} className="fill-none stroke-border" strokeWidth={1} />
      ))}
      <line x1={c} y1={8} x2={c} y2={size - 8} className="stroke-border" strokeWidth={1} />
      <line x1={8} y1={c} x2={size - 8} y2={c} className="stroke-border" strokeWidth={1} />
      <text x={c} y={14} textAnchor="middle" className="fill-muted-foreground text-[9px]">N</text>
      {layers.map((l) => {
        const r = Math.min(1, l.distanceKm / radiusKm) * maxR;
        const rad = (l.bearingDeg - 90) * (Math.PI / 180);
        const x = c + r * Math.cos(rad);
        const y = c + r * Math.sin(rad);
        return (
          <g key={`${l.kind}-${l.id}`}>
            <circle
              cx={x}
              cy={y}
              r={l.activeAtYear ? 5 : 3}
              className={l.activeAtYear ? "fill-violet-500" : "fill-muted-foreground/50"}
            >
              <title>{`${l.name} · ${Math.round(l.distanceKm)} km ${bearingCompass(l.bearingDeg)}`}</title>
            </circle>
          </g>
        );
      })}
      <circle cx={c} cy={c} r={3} className="fill-foreground" />
    </svg>
  );
}

/**
 * Live camera background with layers overlaid as a horizontal band positioned by
 * bearing. Best-effort getUserMedia; on failure it surfaces an error and the page
 * still shows the radar fallback.
 */
function CameraOverlay({
  layers,
  onError,
}: {
  layers: HistoricalLayer[];
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== "function") {
      onError("No camera available on this device.");
      return;
    }
    md.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch((e: unknown) => {
        onError(e instanceof Error ? e.message : "Camera permission denied.");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onError]);

  return (
    <div
      className="relative h-[420px] w-full overflow-hidden rounded-md bg-black"
      data-testid="ar-camera-overlay"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        playsInline
      />
      <div className="pointer-events-none absolute inset-x-0 top-1/3 flex items-center">
        {layers.map((l) => {
          const Icon = kindIcon(l.kind);
          const left = `${(l.bearingDeg / 360) * 100}%`;
          return (
            <div
              key={`${l.kind}-${l.id}`}
              className="absolute -translate-x-1/2"
              style={{ left }}
            >
              <div className="flex flex-col items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-white">
                <Icon className="h-4 w-4 text-violet-300" />
                <span className="max-w-[90px] truncate text-[11px] font-medium">{l.name}</span>
                <span className="text-[10px] text-white/70">
                  {Math.round(l.distanceKm)} km {bearingCompass(l.bearingDeg)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ArHistoryPage() {
  const support = useArSupport();
  const { state: geo, request: requestLocation } = useGeolocation();
  const [eraIndex, setEraIndex] = useState(0);
  const [arActive, setArActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const sites = useQuery<FeatureCollection>({ queryKey: ["/api/map/archaeological-sites"] });
  const civs = useQuery<FeatureCollection>({ queryKey: ["/api/map/civilizations"] });

  const features = useMemo<GeoFeatureLike[]>(
    () => [...(sites.data?.features ?? []), ...(civs.data?.features ?? [])],
    [sites.data, civs.data],
  );

  const location = geo.status === "ready" ? geo.location : null;
  const era = ERAS[eraIndex];

  const layers = useMemo(
    () =>
      location
        ? selectHistoricalLayers(location, features, {
            year: era.year,
            radiusKm: RADIUS_KM,
            maxLayers: 12,
          })
        : [],
    [location, features, era.year],
  );

  const loadingData = sites.isLoading || civs.isLoading;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6" data-testid="ar-history-page">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ScanEye className="h-6 w-6 text-violet-600" />
          <h1 className="text-2xl font-bold">AR history layers</h1>
          {support && (
            <Badge
              variant="outline"
              className={
                support.supported
                  ? "border-violet-400 text-violet-700 dark:text-violet-300"
                  : "border-muted-foreground/40 text-muted-foreground"
              }
            >
              {support.supported ? "AR ready" : "Fallback mode"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Point your phone at a place to see the historical sites and civilizations
          that once stood near you, for a chosen era. Where AR isn't available, the
          same layers plot on a flat radar.
        </p>
      </header>

      {/* Feature-detection / fallback notice */}
      {support && !support.supported && (
        <Card className="border-amber-400/50 bg-amber-500/5">
          <CardContent className="flex gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm text-muted-foreground">{reasonMessage(support.reason)}</p>
          </CardContent>
        </Card>
      )}

      {/* Controls: location + era */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-4 w-4 text-violet-600" /> Your place &amp; era
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={requestLocation}
              disabled={geo.status === "locating"}
              data-testid="ar-locate-button"
              size="sm"
            >
              <MapPin className="mr-1.5 h-4 w-4" />
              {geo.status === "locating" ? "Locating…" : "Use my location"}
            </Button>
            {geo.status === "ready" && (
              <span className="text-sm text-muted-foreground">
                {geo.location.lat.toFixed(3)}, {geo.location.lng.toFixed(3)}
              </span>
            )}
            {geo.status === "error" && (
              <span className="text-sm text-destructive">{geo.message}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {ERAS.map((e, i) => (
              <Button
                key={e.label}
                size="sm"
                variant={i === eraIndex ? "default" : "outline"}
                onClick={() => setEraIndex(i)}
                data-testid={`ar-era-${i}`}
              >
                {e.label}
              </Button>
            ))}
          </div>

          {support?.supported && location && (
            <div className="flex items-center gap-3">
              <Button
                variant={arActive ? "secondary" : "default"}
                size="sm"
                onClick={() => {
                  setCameraError(null);
                  setArActive((v) => !v);
                }}
                data-testid="ar-toggle-button"
              >
                <Camera className="mr-1.5 h-4 w-4" />
                {arActive ? "Stop camera" : "Enter AR"}
              </Button>
              {cameraError && <span className="text-sm text-destructive">{cameraError}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overlay: AR camera when active + supported, else radar fallback */}
      {location ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {support?.supported && arActive && !cameraError ? (
              <CameraOverlay layers={layers} onError={setCameraError} />
            ) : (
              <LayerRadar layers={layers} radiusKm={RADIUS_KM} />
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              {layers.length} historical layer{layers.length === 1 ? "" : "s"} within{" "}
              {RADIUS_KM} km · {era.label}
            </p>
          </CardContent>
        </Card>
      ) : (
        !loadingData && (
          <p className="text-sm text-muted-foreground">
            Share your location to see the historical layers around you.
          </p>
        )
      )}

      {/* Layer list */}
      {location && layers.length > 0 && (
        <div className="space-y-2" data-testid="ar-layer-list">
          {layers.map((l) => {
            const Icon = kindIcon(l.kind);
            return (
              <Card key={`${l.kind}-${l.id}`}>
                <CardContent className="flex items-start gap-3 p-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{l.kind}</Badge>
                      {!l.activeAtYear && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          outside era
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {Math.round(l.distanceKm)} km {bearingCompass(l.bearingDeg)}
                      {l.timePeriod.label ? ` · ${l.timePeriod.label}` : ""}
                    </p>
                    {l.sources.length > 0 && (
                      <p className="truncate text-[11px] text-muted-foreground/80">
                        {l.sources[0]}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {location && layers.length === 0 && !loadingData && (
        <p className="text-sm text-muted-foreground">
          No historical layers within {RADIUS_KM} km for {era.label}. Try “All eras”.
        </p>
      )}
    </div>
  );
}
