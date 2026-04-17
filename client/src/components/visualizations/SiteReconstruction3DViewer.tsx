import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import {
  BoxFace,
  SiteStructure,
  SiteType,
  computeBoxFaces,
  computeSceneBounds,
  faceFillColor,
  formatPeriod,
  formatSiteType,
  generateBlueprint,
  pointsToSvg,
  sortFacesForRender,
} from "./site-reconstruction-utils";

export interface Site3DReconstruction {
  id: string;
  name: string;
  siteType: SiteType;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string;
  findings: string[];
  importance: number;
  confidence: number;
  description: string;
  excavationStatus: string;
}

export interface SiteReconstruction3DViewerProps {
  sites: Site3DReconstruction[];
  initialSiteId?: string;
  height?: number;
  className?: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;
const YAW_STEP = 15;

export default function SiteReconstruction3DViewer({
  sites,
  initialSiteId,
  height = 360,
  className = "",
}: SiteReconstruction3DViewerProps) {
  const [selectedId, setSelectedId] = useState<string>(
    initialSiteId || sites[0]?.id || "",
  );
  const [yawDeg, setYawDeg] = useState<number>(30);
  const [zoom, setZoom] = useState<number>(1);

  const active = sites.find((s) => s.id === selectedId) || sites[0];

  const structures: SiteStructure[] = useMemo(() => {
    if (!active) return [];
    return generateBlueprint(active.siteType, active.findings, active.importance);
  }, [active]);

  const { faces, viewBox } = useMemo(() => {
    if (structures.length === 0) {
      return { faces: [] as BoxFace[], viewBox: "-100 -100 200 200" };
    }
    const all: BoxFace[] = [];
    for (const s of structures) {
      all.push(...computeBoxFaces(s, yawDeg, 22 * zoom));
    }
    const sorted = sortFacesForRender(all);
    const bounds = computeSceneBounds(structures, yawDeg);
    const scale = 22 * zoom;
    const minX = bounds.minX * scale;
    const maxX = bounds.maxX * scale;
    const minY = bounds.minY * scale;
    const maxY = bounds.maxY * scale;
    const pad = 20;
    const vb = `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + 2 * pad).toFixed(1)} ${(maxY - minY + 2 * pad).toFixed(1)}`;
    return { faces: sorted, viewBox: vb };
  }, [structures, yawDeg, zoom]);

  if (sites.length === 0 || !active) return null;

  return (
    <Card className={`overflow-hidden ${className}`}>
      {/* Site selector */}
      {sites.length > 1 && (
        <div
          className="flex flex-wrap gap-1 p-2 border-b border-gray-200 bg-gray-50"
          data-testid="site-3d-viewer-selector"
        >
          {sites.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                s.id === active.id
                  ? "bg-amber-500 text-white"
                  : "bg-white text-gray-700 hover:bg-amber-50"
              }`}
              data-testid={`site-3d-tab-${s.id}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {active.name}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {formatSiteType(active.siteType)}
            </Badge>
            <span className="text-[10px] text-gray-500">
              {formatPeriod(active.timePeriodStart, active.timePeriodEnd)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setYawDeg((y) => y - YAW_STEP)}
            aria-label="Rotate left"
            data-testid="site-3d-rotate-left"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setYawDeg((y) => y + YAW_STEP)}
            aria-label="Rotate right"
            data-testid="site-3d-rotate-right"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setZoom((z) => Math.min(MAX_ZOOM, z * ZOOM_STEP))
            }
            aria-label="Zoom in"
            data-testid="site-3d-zoom-in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_STEP))
            }
            aria-label="Zoom out"
            data-testid="site-3d-zoom-out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 3D scene */}
      <div
        className="bg-gradient-to-b from-sky-50 to-amber-50"
        style={{ height }}
        data-testid="site-3d-scene"
      >
        <svg
          viewBox={viewBox}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`3D reconstruction of ${active.name}`}
        >
          {/* Ground shadow */}
          <ellipse
            cx={0}
            cy={0}
            rx={100 * zoom}
            ry={30 * zoom}
            fill="rgba(0,0,0,0.08)"
          />
          {faces.map((f) => (
            <polygon
              key={f.id}
              points={pointsToSvg(f.points)}
              fill={faceFillColor(f.color, f.shade)}
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.5}
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>

      {/* Metadata strip */}
      <div className="px-3 py-2 border-t border-gray-200 bg-white text-xs">
        <div className="flex items-center justify-between text-gray-600">
          <span>
            Yaw: {((yawDeg % 360) + 360) % 360}°
          </span>
          <span>Zoom: {zoom.toFixed(2)}×</span>
          <span className="text-gray-500">
            Confidence: {active.confidence}%
          </span>
        </div>
        {active.findings.length > 0 && (
          <div className="mt-1.5 text-gray-700">
            <span className="font-medium text-gray-500">Findings:</span>{" "}
            {active.findings.slice(0, 4).join(" · ")}
            {active.findings.length > 4 ? " …" : ""}
          </div>
        )}
        {active.description && (
          <p className="mt-1 text-gray-600 line-clamp-2">{active.description}</p>
        )}
      </div>
    </Card>
  );
}
