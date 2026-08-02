import { useEffect, useMemo, useRef, useState } from "react";
import { DeckGL } from "@deck.gl/react";
import { ColumnLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";

interface ColumnDatum {
  id: string;
  label: string;
  position: [number, number];
  height: number;
  color: [number, number, number];
  group: string;
  payload: unknown;
}

const PALETTE: Array<[number, number, number]> = [
  [37, 99, 235],
  [220, 38, 38],
  [22, 163, 74],
  [202, 138, 4],
  [124, 58, 237],
  [219, 39, 119],
  [8, 145, 178],
  [234, 88, 12],
  [101, 163, 13],
  [79, 70, 229],
  [192, 38, 211],
  [13, 148, 136],
];

const INITIAL_VIEW = {
  longitude: 0,
  latitude: 20,
  zoom: 1.4,
  pitch: 50,
  bearing: 0,
};

const HEIGHT_METERS = 800_000; // tallest column when normalized magnitude = 1

export default function GenericMap3D({ projections, onSelect }: VisualizationProps) {
  const items = projections.spatial ?? [];
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  const data: ColumnDatum[] = useMemo(() => {
    if (items.length === 0) return [];
    const maxMag = items.reduce((m, i) => Math.max(m, i.magnitude ?? 1), 1);
    const groupColor = new Map<string, [number, number, number]>();
    let i = 0;
    const colorFor = (group: string) => {
      const cached = groupColor.get(group);
      if (cached) return cached;
      const color = PALETTE[i % PALETTE.length];
      i += 1;
      groupColor.set(group, color);
      return color;
    };
    return items.map((item) => ({
      id: item.id,
      label: item.label,
      position: [item.lng, item.lat] as [number, number],
      height: ((item.magnitude ?? 1) / maxMag) * HEIGHT_METERS,
      color: colorFor(item.region ?? "Other"),
      group: item.region ?? "Other",
      payload: item.payload,
    }));
  }, [items]);

  // Frame the data on first load
  useEffect(() => {
    if (data.length === 0) return;
    const lats = data.map((d) => d.position[1]);
    const lngs = data.map((d) => d.position[0]);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    setViewState((prev) => ({ ...prev, latitude: centerLat, longitude: centerLng, zoom: 2 }));
  }, [data]);

  const layers = useMemo(
    () => [
      new TileLayer({
        id: "osm-tiles",
        data: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        minZoom: 0,
        maxZoom: 18,
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
      }),
      new ColumnLayer<ColumnDatum>({
        id: "columns",
        data,
        diskResolution: 16,
        radius: 25_000,
        extruded: true,
        pickable: true,
        elevationScale: 1,
        getPosition: (d) => d.position,
        getElevation: (d) => d.height,
        getFillColor: (d) => [...d.color, 220],
        getLineColor: [255, 255, 255, 200],
        material: { ambient: 0.5, diffuse: 0.8, shininess: 32 },
        onClick: (info) => {
          if (info.object) onSelect?.(info.object.id, info.object.payload);
        },
      }),
    ],
    [data, onSelect]
  );

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no spatial data to render.
      </div>
    );
  }

  const allMagnitudesEqual = items.every(
    (i) => (i.magnitude ?? 1) === (items[0].magnitude ?? 1)
  );

  return (
    <div ref={containerRef} className="relative h-full w-full bg-gray-100">
      <DeckGL
        viewState={viewState}
        controller
        layers={layers}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof INITIAL_VIEW)}
        getTooltip={({ object }) =>
          object ? { text: `${(object as ColumnDatum).label}` } : null
        }
      />
      {allMagnitudesEqual && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] rounded">
          All magnitudes equal — columns at uniform height.
        </div>
      )}
    </div>
  );
}
