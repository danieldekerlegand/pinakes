import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info, Layers, MapPin, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  CityLayoutData,
  ZoneShape,
  computeSchematic,
  formatFeatureLabel,
  getFeatureColor,
  getFeatureDescription,
  getLayoutDescription,
} from "./city-layout-utils";

export interface CityLayoutViewerProps {
  layouts: CityLayoutData[];
  initialLayoutId?: string;
  className?: string;
  height?: number | string;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;

export default function CityLayoutViewer({
  layouts,
  initialLayoutId,
  className = "",
  height = 500,
}: CityLayoutViewerProps) {
  const [selectedLayoutId, setSelectedLayoutId] = useState<string>(
    initialLayoutId || layouts[0]?.id || "",
  );
  const [selectedZone, setSelectedZone] = useState<ZoneShape | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const svgWrapperRef = useRef<HTMLDivElement | null>(null);

  const activeLayout =
    layouts.find((l) => l.id === selectedLayoutId) || layouts[0];
  const geometry = useMemo(
    () => (activeLayout ? computeSchematic(activeLayout) : null),
    [activeLayout],
  );

  useEffect(() => {
    setSelectedZone(null);
    setTransform({ x: 0, y: 0, scale: 1 });
  }, [selectedLayoutId]);

  useEffect(() => {
    if (!layouts.find((l) => l.id === selectedLayoutId) && layouts[0]) {
      setSelectedLayoutId(layouts[0].id);
    }
  }, [layouts, selectedLayoutId]);

  const zoomIn = useCallback(() => {
    setTransform((t) => ({
      ...t,
      scale: Math.min(MAX_SCALE, t.scale * ZOOM_STEP),
    }));
  }, []);
  const zoomOut = useCallback(() => {
    setTransform((t) => ({
      ...t,
      scale: Math.max(MIN_SCALE, t.scale / ZOOM_STEP),
    }));
  }, []);
  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as SVGElement | HTMLElement;
    if (target.closest("[data-zone]")) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.x,
      ty: transform.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setTransform((t) => ({
      ...t,
      x: panStartRef.current.tx + dx,
      y: panStartRef.current.ty + dy,
    }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setIsPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released
    }
  };

  useEffect(() => {
    const el = svgWrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setTransform((t) => {
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const newScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, t.scale * factor),
        );
        return { ...t, scale: newScale };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  if (!activeLayout || !geometry) {
    return (
      <Card
        className={`p-4 text-center text-sm text-gray-500 ${className}`}
        data-testid="city-layout-viewer-empty"
      >
        <MapPin className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        <p>No city layout data available.</p>
      </Card>
    );
  }

  const uniqueFeatures = Array.from(
    new Set(geometry.zones.map((z) => z.feature)),
  );

  return (
    <Card
      className={`overflow-hidden ${className}`}
      data-testid="city-layout-viewer"
    >
      <div className="flex items-center justify-between p-3 border-b bg-gray-50">
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <MapPin className="h-4 w-4 text-cyan-600 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">
              {activeLayout.settlementName ||
                activeLayout.settlementId ||
                "City Layout"}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {getLayoutDescription(activeLayout.layoutType)}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-1 flex-shrink-0">
          <Button
            size="icon"
            variant="ghost"
            onClick={zoomOut}
            aria-label="Zoom out"
            title="Zoom out"
            data-testid="city-layout-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={zoomIn}
            aria-label="Zoom in"
            title="Zoom in"
            data-testid="city-layout-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={resetView}
            aria-label="Reset view"
            title="Reset view"
            data-testid="city-layout-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {layouts.length > 1 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-white overflow-x-auto">
          <Layers className="h-3 w-3 text-gray-500 flex-shrink-0" />
          <span className="text-xs text-gray-500 flex-shrink-0 mr-1">
            Layouts:
          </span>
          {layouts.map((l) => (
            <button
              key={l.id}
              data-testid={`layout-selector-${l.id}`}
              onClick={() => setSelectedLayoutId(l.id)}
              className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 whitespace-nowrap transition-colors ${
                selectedLayoutId === l.id
                  ? "bg-cyan-600 text-white border-cyan-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {l.timePeriodLabel ||
                l.settlementName ||
                formatFeatureLabel(l.layoutType)}
            </button>
          ))}
        </div>
      )}

      <div
        ref={svgWrapperRef}
        className="relative bg-amber-50/40 select-none touch-none"
        style={{
          cursor: isPanning ? "grabbing" : "grab",
          height: typeof height === "number" ? `${height}px` : height,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg
          viewBox={`0 0 ${geometry.viewBoxWidth} ${geometry.viewBoxHeight}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
          role="img"
          aria-label={`Schematic map of ${activeLayout.settlementName || "city"}`}
          data-testid="city-layout-svg"
        >
          <g
            transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
          >
            <rect
              x={0}
              y={0}
              width={geometry.viewBoxWidth}
              height={geometry.viewBoxHeight}
              fill="#fefce8"
            />

            {geometry.decorations.map((d, i) => (
              <path
                key={`dec-${i}`}
                d={d.points}
                stroke={d.stroke}
                strokeWidth={d.strokeWidth}
                strokeDasharray={d.dashArray}
                strokeLinecap="round"
                fill="none"
                opacity={0.8}
              />
            ))}

            {geometry.boundary && (
              <rect
                x={geometry.boundary.x}
                y={geometry.boundary.y}
                width={geometry.boundary.width}
                height={geometry.boundary.height}
                fill="none"
                stroke={getFeatureColor("walls")}
                strokeWidth={6}
                data-testid="city-layout-boundary"
              />
            )}

            {geometry.gates?.map((g, i) => (
              <g key={`gate-${i}`} data-testid="city-layout-gate">
                <rect
                  x={g.x - 10}
                  y={g.y - 10}
                  width={20}
                  height={20}
                  fill={getFeatureColor("gates")}
                  stroke="#fff"
                  strokeWidth={2}
                  rx={3}
                >
                  <title>Gate</title>
                </rect>
              </g>
            ))}

            {geometry.zones.map((zone) => {
              const isSelected = selectedZone?.id === zone.id;
              const fontSize = Math.max(
                10,
                Math.min(zone.width / 7, zone.height / 4, 16),
              );
              return (
                <g
                  key={zone.id}
                  data-zone={zone.id}
                  data-testid={`zone-${zone.feature}`}
                  onClick={() => setSelectedZone(zone)}
                  style={{ cursor: "pointer" }}
                >
                  {zone.shape === "ellipse" ? (
                    <ellipse
                      cx={zone.x + zone.width / 2}
                      cy={zone.y + zone.height / 2}
                      rx={zone.width / 2}
                      ry={zone.height / 2}
                      fill={zone.color}
                      fillOpacity={isSelected ? 0.95 : 0.75}
                      stroke={isSelected ? "#0f172a" : "#ffffff"}
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                  ) : (
                    <rect
                      x={zone.x}
                      y={zone.y}
                      width={zone.width}
                      height={zone.height}
                      fill={zone.color}
                      fillOpacity={isSelected ? 0.95 : 0.75}
                      stroke={isSelected ? "#0f172a" : "#ffffff"}
                      strokeWidth={isSelected ? 3 : 1.5}
                      rx={6}
                    />
                  )}
                  <text
                    x={zone.x + zone.width / 2}
                    y={zone.y + zone.height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fill="#ffffff"
                    fontWeight={600}
                    pointerEvents="none"
                    style={{
                      paintOrder: "stroke",
                      stroke: "rgba(0,0,0,0.35)",
                      strokeWidth: 2,
                      strokeLinejoin: "round",
                    }}
                  >
                    {zone.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="absolute bottom-2 left-2 bg-white/85 rounded px-2 py-1 text-[10px] text-gray-600 backdrop-blur-sm">
          Zoom {transform.scale.toFixed(2)}×
        </div>
      </div>

      <div
        className="p-3 border-t bg-gray-50 space-y-2"
        data-testid="city-layout-details"
      >
        {selectedZone ? (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0"
                style={{ backgroundColor: selectedZone.color }}
              />
              <span className="text-sm font-semibold text-gray-900">
                {selectedZone.label}
              </span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {activeLayout.layoutType}
              </Badge>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              {getFeatureDescription(selectedZone.feature)}
            </p>
          </div>
        ) : (
          <div className="flex items-start space-x-2 text-xs text-gray-600">
            <Info className="h-3 w-3 mt-0.5 flex-shrink-0 text-gray-400" />
            <div className="space-y-1">
              <p className="text-gray-700">
                {activeLayout.description ||
                  "Click a zone for its role in the city. Drag to pan, scroll to zoom."}
              </p>
              {uniqueFeatures.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {uniqueFeatures.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 text-[10px] text-gray-700"
                    >
                      <span
                        className="w-2 h-2 rounded-sm"
                        style={{ backgroundColor: getFeatureColor(f) }}
                      />
                      {formatFeatureLabel(f)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
