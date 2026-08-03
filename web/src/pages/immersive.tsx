/**
 * Immersive globe & virtual museum (US-009).
 *
 * A single deck.gl surface with a three-way toggle — flat map ⇄ 3D globe ⇄
 * virtual museum — over the existing temporal/migration data. The whole flow
 * degrades gracefully:
 *   - WebGL2 + WebXR are feature-detected (`useImmersiveSupport`,
 *     `scenes.detectImmersiveSupport`). Without WebGL2 only the flat map is
 *     offered; without WebXR the 3D scenes still render on-screen (mouse-drag),
 *     just without a headset session.
 *   - The globe runs a time-space fly-through that follows each migration path in
 *     chronological order (`buildFlyThroughPath`).
 *   - The museum renders real glTF/3D models only where a public-domain model
 *     exists (`selectMuseumArtifacts`); every other artifact gets a placeholder
 *     pedestal, clearly labeled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeckGL } from "@deck.gl/react";
import { MapView, _GlobeView as GlobeView, FlyToInterpolator } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, ColumnLayer, BitmapLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { Box, Globe, Landmark, Map as MapIcon, Info, Pause, Play, Headset } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildFlyThroughPath,
  selectMuseumArtifacts,
  selectSceneMode,
  countRenderableModels,
  type FlyThroughKeyframe,
  type MuseumArtifact,
  type MuseumArtifactInput,
  type RouteFeatureLike,
  type SceneMode,
} from "@/lib/immersive/scenes";
import { useImmersiveSupport } from "@/lib/immersive/use-immersive-support";

interface RouteCollection {
  features?: RouteFeatureLike[];
}
interface CivFeature {
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
}
interface CivCollection {
  features?: CivFeature[];
}
interface MaterialCultureItem {
  id: string;
  name: string;
  category?: string;
  originCoordinates?: [number, number]; // [lat, lng]
  associatedLanguages?: string[];
  modelUrl?: string | null;
  modelLicense?: string | null;
}
interface MaterialCultureResponse {
  items?: MaterialCultureItem[];
}

const MODE_META: Record<SceneMode, { label: string; icon: typeof Globe }> = {
  flat: { label: "Flat map", icon: MapIcon },
  globe: { label: "3D globe", icon: Globe },
  museum: { label: "Virtual museum", icon: Landmark },
};

const GLOBE_HOME = { longitude: 20, latitude: 25, zoom: 1.2, pitch: 0, bearing: 0 };
const MAP_HOME = { longitude: 20, latitude: 25, zoom: 1.4, pitch: 0, bearing: 0 };

/** Centroid of a Point/Polygon geometry as [lng, lat], or null. */
function geometryCentroid(geometry: unknown): [number, number] | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g || !Array.isArray(g.coordinates)) return null;
  if (g.type === "Point") {
    const [lng, lat] = g.coordinates as number[];
    if (typeof lng === "number" && typeof lat === "number") return [lng, lat];
    return null;
  }
  // Fallback: average all leaf [lng,lat] pairs.
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (arr: unknown): void => {
    if (!Array.isArray(arr)) return;
    if (typeof arr[0] === "number" && typeof arr[1] === "number") {
      sx += arr[0] as number;
      sy += arr[1] as number;
      n += 1;
      return;
    }
    arr.forEach(walk);
  };
  walk(g.coordinates);
  return n > 0 ? [sx / n, sy / n] : null;
}

export default function ImmersivePage() {
  const support = useImmersiveSupport();
  const [requestedMode, setRequestedMode] = useState<SceneMode>("globe");
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);

  const routesQ = useQuery<RouteCollection>({ queryKey: ["/api/map/routes"] });
  const civsQ = useQuery<CivCollection>({ queryKey: ["/api/map/civilizations"] });
  const materialQ = useQuery<MaterialCultureResponse>({ queryKey: ["/api/material-culture"] });

  // Which mode we actually render (degrade a requested-but-unavailable mode).
  const selection = useMemo(() => selectSceneMode(requestedMode, support), [requestedMode, support]);
  const mode = selection.mode;

  // --- Data projections -----------------------------------------------------
  const routeFeatures = routesQ.data?.features ?? [];

  const routePaths = useMemo(
    () =>
      routeFeatures
        .map((f) => {
          const coords = (f.geometry as { coordinates?: unknown } | null)?.coordinates;
          const path = Array.isArray(coords)
            ? (coords.filter(
                (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
              ) as [number, number][])
            : [];
          const name = (f.properties?.name as string) ?? "route";
          return { name, path };
        })
        .filter((r) => r.path.length >= 2),
    [routeFeatures],
  );

  const civPoints = useMemo(
    () =>
      (civsQ.data?.features ?? [])
        .map((f) => {
          const c = geometryCentroid(f.geometry);
          if (!c) return null;
          return { name: (f.properties?.name as string) ?? "civilization", position: c };
        })
        .filter((x): x is { name: string; position: [number, number] } => x !== null),
    [civsQ.data],
  );

  const flyThrough = useMemo<FlyThroughKeyframe[]>(
    () => buildFlyThroughPath(routeFeatures),
    [routeFeatures],
  );

  const artifacts = useMemo<MuseumArtifact[]>(() => {
    const inputs: MuseumArtifactInput[] = (materialQ.data?.items ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      category: it.category ?? null,
      cultureName: it.associatedLanguages?.[0] ?? null,
      modelUrl: it.modelUrl ?? null,
      license: it.modelLicense ?? null,
      coordinates:
        Array.isArray(it.originCoordinates) &&
        typeof it.originCoordinates[0] === "number" &&
        typeof it.originCoordinates[1] === "number"
          ? { lat: it.originCoordinates[0], lng: it.originCoordinates[1] }
          : null,
    }));
    return selectMuseumArtifacts(inputs).filter((a) => a.coordinates);
  }, [materialQ.data]);

  const renderableModels = countRenderableModels(artifacts);

  // --- Fly-through animation (globe only) -----------------------------------
  const [viewState, setViewState] = useState<Record<string, unknown>>(GLOBE_HOME);

  useEffect(() => {
    // Reset framing when the mode changes.
    setPlaying(false);
    setFrameIndex(0);
    setViewState(mode === "flat" ? MAP_HOME : GLOBE_HOME);
  }, [mode]);

  useEffect(() => {
    if (!playing || mode !== "globe" || flyThrough.length === 0) return;
    const timer = setInterval(() => {
      setFrameIndex((i) => (i + 1) % flyThrough.length);
    }, 2600);
    return () => clearInterval(timer);
  }, [playing, mode, flyThrough.length]);

  useEffect(() => {
    if (!playing || mode !== "globe" || flyThrough.length === 0) return;
    const kf = flyThrough[frameIndex];
    setViewState({
      longitude: kf.longitude,
      latitude: kf.latitude,
      zoom: Math.max(kf.zoom, 2),
      pitch: 0,
      bearing: 0,
      transitionDuration: 2200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
    });
  }, [playing, mode, frameIndex, flyThrough]);

  // --- Layers ---------------------------------------------------------------
  const layers = useMemo(() => {
    const base = new TileLayer({
      id: "basemap",
      data: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      minZoom: 0,
      maxZoom: 12,
      tileSize: 256,
      renderSubLayers: (props) => {
        const { boundingBox } = props.tile as unknown as {
          boundingBox: [[number, number], [number, number]];
        };
        const [[west, south], [east, north]] = boundingBox;
        return new BitmapLayer(props, {
          data: undefined,
          image: props.data,
          bounds: [west, south, east, north],
        });
      },
    });

    if (mode === "museum") {
      const modelArtifacts = artifacts.filter((a) => a.hasModel && a.coordinates);
      const placeholderArtifacts = artifacts.filter((a) => !a.hasModel && a.coordinates);
      // `scenegraph` is one model URL per layer, so render one layer per distinct
      // public-domain glTF/GLB URL (empty until such models exist in the corpus).
      const modelUrls = Array.from(new Set(modelArtifacts.map((a) => a.modelUrl!)));
      const modelLayers = modelUrls.map(
        (url, i) =>
          new ScenegraphLayer<MuseumArtifact>({
            id: `artifact-models-${i}`,
            data: modelArtifacts.filter((a) => a.modelUrl === url),
            scenegraph: url,
            getPosition: (d) => [d.coordinates!.lng, d.coordinates!.lat],
            getOrientation: [0, 0, 90],
            sizeScale: 40_000,
            pickable: true,
            _lighting: "pbr",
            onClick: (info) => info.object && setSelectedArtifact(info.object.id),
          }),
      );
      return [
        base,
        // Placeholder pedestals for artifacts without a public-domain 3D model.
        new ColumnLayer<MuseumArtifact>({
          id: "artifact-pedestals",
          data: placeholderArtifacts,
          diskResolution: 12,
          radius: 60_000,
          extruded: true,
          pickable: true,
          elevationScale: 1,
          getPosition: (d) => [d.coordinates!.lng, d.coordinates!.lat],
          getElevation: (d) => (d.id === selectedArtifact ? 500_000 : 250_000),
          getFillColor: (d) => (d.id === selectedArtifact ? [124, 58, 237, 230] : [148, 163, 184, 200]),
          onClick: (info) => info.object && setSelectedArtifact(info.object.id),
          updateTriggers: { getElevation: selectedArtifact, getFillColor: selectedArtifact },
        }),
        ...modelLayers,
      ];
    }

    // flat + globe: migration routes + civilization markers.
    return [
      base,
      new PathLayer<{ name: string; path: [number, number][] }>({
        id: "migration-routes",
        data: routePaths,
        widthUnits: "pixels",
        getWidth: 2.5,
        getPath: (d) => d.path,
        getColor: [124, 58, 237, 200],
        pickable: true,
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer<{ name: string; position: [number, number] }>({
        id: "civilizations",
        data: civPoints,
        radiusUnits: "pixels",
        getRadius: 4,
        radiusMinPixels: 2,
        getPosition: (d) => d.position,
        getFillColor: [37, 99, 235, 200],
        pickable: true,
      }),
    ];
  }, [mode, artifacts, routePaths, civPoints, selectedArtifact]);

  const deckView = mode === "flat" ? new MapView({ repeat: true }) : new GlobeView();

  const available = support ? (support.canRender3d ? (["flat", "globe", "museum"] as SceneMode[]) : (["flat"] as SceneMode[])) : (["flat", "globe", "museum"] as SceneMode[]);

  const selectedArtifactData = artifacts.find((a) => a.id === selectedArtifact) ?? null;
  const loading = routesQ.isLoading || civsQ.isLoading || materialQ.isLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-testid="immersive-page">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Box className="h-6 w-6 text-violet-600" />
          <h1 className="text-2xl font-bold">Immersive globe &amp; virtual museum</h1>
          {support && (
            <Badge
              variant="outline"
              className={
                support.hasImmersiveVr
                  ? "border-violet-400 text-violet-700 dark:text-violet-300"
                  : support.canRender3d
                    ? "border-blue-400 text-blue-700 dark:text-blue-300"
                    : "border-muted-foreground/40 text-muted-foreground"
              }
            >
              {support.hasImmersiveVr ? "VR-capable" : support.canRender3d ? "On-screen 3D" : "Flat map only"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Explore space, time, and material culture. Fly the globe along migration
          paths through deep time, or walk a gallery of artifacts. Without a 3D-capable
          browser this falls back to the flat map.
        </p>
      </header>

      {/* Mode toggle */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">View</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Scene mode">
            {(["flat", "globe", "museum"] as SceneMode[]).map((m) => {
              const meta = MODE_META[m];
              const Icon = meta.icon;
              const disabled = !available.includes(m);
              return (
                <Button
                  key={m}
                  size="sm"
                  role="tab"
                  aria-selected={mode === m}
                  variant={mode === m ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => setRequestedMode(m)}
                  data-testid={`mode-${m}`}
                >
                  <Icon className="mr-1.5 h-4 w-4" />
                  {meta.label}
                </Button>
              );
            })}
          </div>

          {mode === "globe" && flyThrough.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPlaying((p) => !p)}
              data-testid="flythrough-toggle"
            >
              {playing ? <Pause className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
              {playing ? "Pause fly-through" : "Fly through migrations"}
            </Button>
          )}

          {support?.hasImmersiveVr && (
            <Badge variant="outline" className="gap-1 border-violet-400 text-violet-700 dark:text-violet-300">
              <Headset className="h-3.5 w-3.5" /> Headset ready
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Degrade notice */}
      {selection.degradedFrom && (
        <Card className="border-amber-400/50 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 text-amber-600" />
            The {MODE_META[selection.degradedFrom].label.toLowerCase()} needs a 3D-capable
            (WebGL2) browser; showing the {MODE_META[mode].label.toLowerCase()} instead.
          </CardContent>
        </Card>
      )}

      {/* Scene */}
      <Card>
        <CardContent className="p-0">
          <div className="relative h-[520px] w-full overflow-hidden rounded-md bg-slate-900">
            <DeckGL
              views={deckView}
              viewState={mode === "globe" && playing ? (viewState as never) : undefined}
              initialViewState={mode === "flat" ? MAP_HOME : GLOBE_HOME}
              controller
              layers={layers}
              onViewStateChange={({ viewState: vs }) => {
                if (mode === "globe" && playing) setViewState(vs as Record<string, unknown>);
              }}
              getTooltip={({ object }) =>
                object ? { text: (object as { name?: string }).name ?? "" } : null
              }
            />
            {loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
                Loading scene…
              </div>
            )}
            {mode === "globe" && playing && flyThrough[frameIndex] && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
                {flyThrough[frameIndex].label}
                {Number.isFinite(flyThrough[frameIndex].year) && (
                  <span className="ml-2 text-white/60">
                    {formatYear(flyThrough[frameIndex].year)}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Museum artifact panel */}
      {mode === "museum" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-violet-600" /> Gallery
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"} ·{" "}
              {renderableModels > 0
                ? `${renderableModels} with public-domain 3D models`
                : "no public-domain 3D models yet — showing placeholder pedestals"}
            </p>
            {selectedArtifactData && (
              <div className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{selectedArtifactData.name}</span>
                  {selectedArtifactData.category && (
                    <Badge variant="secondary" className="text-[10px]">{selectedArtifactData.category}</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {selectedArtifactData.hasModel ? "3D model" : "placeholder"}
                  </Badge>
                </div>
                {selectedArtifactData.cultureName && (
                  <p className="text-xs text-muted-foreground">{selectedArtifactData.cultureName}</p>
                )}
                {selectedArtifactData.attribution && (
                  <p className="text-[11px] text-muted-foreground/80">{selectedArtifactData.attribution}</p>
                )}
                {selectedArtifactData.license && (
                  <p className="text-[11px] text-muted-foreground/80">License: {selectedArtifactData.license}</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" data-testid="artifact-grid">
              {artifacts.slice(0, 24).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedArtifact(a.id)}
                  className={`rounded-md border p-2 text-left text-xs transition ${
                    a.id === selectedArtifact ? "border-violet-400 bg-violet-500/5" : "hover:bg-muted"
                  }`}
                  data-testid={`artifact-${a.id}`}
                >
                  <span className="flex items-center gap-1.5">
                    <Box className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                    <span className="truncate font-medium">{a.name}</span>
                  </span>
                  {a.hasModel && (
                    <span className="mt-1 block text-[10px] text-violet-600">3D model</span>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatYear(year: number): string {
  if (!Number.isFinite(year)) return "";
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}
