import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { VisualizationContainer } from './shared/VisualizationContainer';
import {
  type ExtrusionMetric,
  type ExtrudedRegion,
  type RegionInput,
  type ProjectionConfig,
  METRIC_LABELS,
  buildExtrudedRegions,
  darkenColor,
  hexWithAlpha,
  formatMetricValue,
  lerp,
} from '../../lib/visualization/extrusion-utils';
import { CIVILIZATION_PALETTE, VIS_TEXT_COLORS } from '../../lib/visualization/color-theme';
// TooltipData requires id/name/type; we provide them for each hovered region.

interface TimeSnapshot {
  year: number;
  regions: RegionInput[];
}

export interface Extruded3DRegionViewProps {
  /** Array of time snapshots with region data */
  snapshots: TimeSnapshot[];
  /** Currently selected year (controlled) */
  currentYear?: number;
  /** Called when hovering a region */
  onRegionHover?: (regionId: string | null) => void;
  /** Called when clicking a region */
  onRegionClick?: (regionId: string) => void;
}

const DEFAULT_TILT = 30;
const DEFAULT_MAX_HEIGHT = 120;
const ANIMATION_DURATION = 600; // ms

export function Extruded3DRegionView({
  snapshots,
  currentYear,
  onRegionHover,
  onRegionClick,
}: Extruded3DRegionViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null) as React.MutableRefObject<HTMLCanvasElement | null>;
  const animFrameRef = useRef<number>(0);
  const prevRegionsRef = useRef<ExtrudedRegion[]>([]);
  const animStartRef = useRef<number>(0);

  const [metric, setMetric] = useState<ExtrusionMetric>('population');
  const [tiltAngle, setTiltAngle] = useState(DEFAULT_TILT);
  const [maxHeight, setMaxHeight] = useState(DEFAULT_MAX_HEIGHT);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [internalYear, setInternalYear] = useState<number>(
    currentYear ?? snapshots[0]?.year ?? 0,
  );

  const activeYear = currentYear ?? internalYear;

  // Find the snapshot closest to activeYear
  const activeSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null;
    let closest = snapshots[0];
    let minDist = Math.abs(closest.year - activeYear);
    for (const snap of snapshots) {
      const dist = Math.abs(snap.year - activeYear);
      if (dist < minDist) {
        closest = snap;
        minDist = dist;
      }
    }
    return closest;
  }, [snapshots, activeYear]);

  const yearRange = useMemo(() => {
    if (snapshots.length === 0) return { min: 0, max: 0 };
    const years = snapshots.map((s) => s.year);
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [snapshots]);

  // Build projected config based on the active regions
  const buildConfig = useCallback(
    (width: number, height: number): ProjectionConfig => {
      const regions = activeSnapshot?.regions ?? [];
      // Compute bounding box of all regions
      let minLng = 180,
        maxLng = -180,
        minLat = 90,
        maxLat = -90;
      for (const r of regions) {
        for (const ring of r.coordinates) {
          for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }
      if (regions.length === 0) {
        minLng = -30;
        maxLng = 60;
        minLat = 10;
        maxLat = 55;
      }
      const centerLng = (minLng + maxLng) / 2;
      const centerLat = (minLat + maxLat) / 2;
      const spanLng = Math.max(maxLng - minLng, 10);
      const spanLat = Math.max(maxLat - minLat, 10);
      const scaleX = (width * 0.7) / spanLng;
      const scaleY = (height * 0.7) / spanLat;
      const scale = Math.min(scaleX, scaleY);

      return {
        width,
        height,
        centerLng,
        centerLat,
        scale,
        tiltAngle,
        maxExtrusionHeight: maxHeight,
      };
    },
    [activeSnapshot, tiltAngle, maxHeight],
  );

  // Draw the visualization on canvas
  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      regions: ExtrudedRegion[],
      prevRegions: ExtrudedRegion[],
      animProgress: number,
    ) => {
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      // Grid lines for depth reference
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.5;
      const gridSpacing = 40;
      for (let y = 0; y < height; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw each region (sorted back-to-front)
      for (const region of regions) {
        const isHovered = region.id === hoveredId;

        // Find the previous state for animation interpolation
        const prev = prevRegions.find((r) => r.id === region.id);
        const t = animProgress;

        const currentHeight = prev
          ? lerp(prev.extrusionHeight, region.extrusionHeight, t)
          : region.extrusionHeight * t;

        // Recompute top polygon at interpolated height
        const topPoly = region.basePolygon.map(
          ([x, y]) => [x, y - currentHeight] as [number, number],
        );

        // Draw side faces
        for (const face of region.sideFaces) {
          const [bl, br] = face.points;
          const tl = [bl[0], bl[1] - currentHeight] as [number, number];
          const tr = [br[0], br[1] - currentHeight] as [number, number];

          ctx.beginPath();
          ctx.moveTo(bl[0], bl[1]);
          ctx.lineTo(br[0], br[1]);
          ctx.lineTo(tr[0], tr[1]);
          ctx.lineTo(tl[0], tl[1]);
          ctx.closePath();

          const shade = face.isLit ? 0.85 : 0.65;
          ctx.fillStyle = isHovered
            ? darkenColor(region.color, shade + 0.1)
            : darkenColor(region.color, shade);
          ctx.fill();
          ctx.strokeStyle = darkenColor(region.color, 0.5);
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }

        // Draw top face
        if (topPoly.length > 2) {
          ctx.beginPath();
          ctx.moveTo(topPoly[0][0], topPoly[0][1]);
          for (let i = 1; i < topPoly.length; i++) {
            ctx.lineTo(topPoly[i][0], topPoly[i][1]);
          }
          ctx.closePath();

          ctx.fillStyle = isHovered
            ? hexWithAlpha(region.color, 0.95)
            : hexWithAlpha(region.color, 0.85);
          ctx.fill();
          ctx.strokeStyle = darkenColor(region.color, 0.6);
          ctx.lineWidth = isHovered ? 2 : 1;
          ctx.stroke();
        }

        // Draw base shadow
        if (currentHeight > 2) {
          ctx.beginPath();
          ctx.moveTo(region.basePolygon[0][0], region.basePolygon[0][1]);
          for (let i = 1; i < region.basePolygon.length; i++) {
            ctx.lineTo(region.basePolygon[i][0], region.basePolygon[i][1]);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fill();
        }

        // Label on top face
        if (currentHeight > 5 && topPoly.length > 0) {
          // Compute centroid of top polygon
          let cx = 0,
            cy = 0;
          for (const [px, py] of topPoly) {
            cx += px;
            cy += py;
          }
          cx /= topPoly.length;
          cy /= topPoly.length;

          ctx.fillStyle = VIS_TEXT_COLORS.darkest;
          ctx.font = isHovered ? 'bold 12px sans-serif' : '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(region.name, cx, cy - 8);

          ctx.fillStyle = VIS_TEXT_COLORS.axisLabel;
          ctx.font = '10px sans-serif';
          ctx.fillText(formatMetricValue(region.metricValue), cx, cy + 6);
        }
      }

      // Title
      ctx.fillStyle = VIS_TEXT_COLORS.darker;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        `Extruded Regions by ${METRIC_LABELS[metric]}`,
        16,
        16,
      );

      // Year display
      if (activeSnapshot) {
        const yearLabel =
          activeSnapshot.year < 0
            ? `${Math.abs(activeSnapshot.year)} BCE`
            : `${activeSnapshot.year} CE`;
        ctx.fillStyle = VIS_TEXT_COLORS.dark;
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(yearLabel, width - 16, 16);
      }
    },
    [metric, hoveredId, activeSnapshot],
  );

  return (
    <VisualizationContainer
      currentView="extruded-3d-regions"
      interactionHint="Hover regions for details. Use controls to change metric and perspective."
      isEmpty={snapshots.length === 0}
      emptyMessage="No region data available for 3D extrusion"
    >
      {({ width, height, svgRef, showTooltip, hideTooltip }) => {
        // Build regions for rendering
        const config = buildConfig(width, height);
        const regions = activeSnapshot
          ? buildExtrudedRegions(activeSnapshot.regions, metric, config)
          : [];

        // Canvas rendering via effect-like pattern inside render
        // We use a ref callback to trigger drawing
        const canvasCallback = (canvas: HTMLCanvasElement | null) => {
          if (!canvas) return;
          canvasRef.current = canvas;
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          // Animate transition
          const prevRegions = prevRegionsRef.current;
          const startTime = performance.now();
          animStartRef.current = startTime;

          const animate = (now: number) => {
            if (animStartRef.current !== startTime) return; // Superseded
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);

            draw(ctx, width, height, regions, prevRegions, eased);

            if (progress < 1) {
              animFrameRef.current = requestAnimationFrame(animate);
            } else {
              prevRegionsRef.current = regions;
            }
          };

          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = requestAnimationFrame(animate);
        };

        // Hit testing for hover/click
        const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;

          // Test each region's top polygon (reverse order = front first)
          let found: ExtrudedRegion | null = null;
          for (let i = regions.length - 1; i >= 0; i--) {
            const region = regions[i];
            if (pointInPolygon(mx, my, region.topPolygon)) {
              found = region;
              break;
            }
          }

          if (found) {
            setHoveredId(found.id);
            onRegionHover?.(found.id);
            const tooltipData = {
              id: found.id,
              name: found.name,
              type: 'family' as const,
              region: String(found.metadata['region'] ?? ''),
              totalSpeakers: found.metricValue,
              [METRIC_LABELS[metric]]: formatMetricValue(found.metricValue),
            };
            showTooltip(tooltipData, e.clientX - rect.left, e.clientY - rect.top);
          } else {
            setHoveredId(null);
            onRegionHover?.(null);
            hideTooltip();
          }
        };

        const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;

          for (let i = regions.length - 1; i >= 0; i--) {
            if (pointInPolygon(mx, my, regions[i].topPolygon)) {
              onRegionClick?.(regions[i].id);
              break;
            }
          }
        };

        return (
          <div className="w-full h-full flex flex-col">
            {/* Controls */}
            <div className="flex items-center gap-4 px-4 py-2 bg-white border-b text-sm flex-shrink-0">
              <label className="flex items-center gap-1.5">
                <span className="text-gray-600 font-medium">Metric:</span>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as ExtrusionMetric)}
                  className="border rounded px-2 py-1 text-sm"
                >
                  {Object.entries(METRIC_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-gray-600 font-medium">Tilt:</span>
                <input
                  type="range"
                  min={10}
                  max={50}
                  value={tiltAngle}
                  onChange={(e) => setTiltAngle(Number(e.target.value))}
                  className="w-20"
                />
                <span className="text-gray-500 w-8">{tiltAngle}°</span>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-gray-600 font-medium">Height:</span>
                <input
                  type="range"
                  min={40}
                  max={200}
                  value={maxHeight}
                  onChange={(e) => setMaxHeight(Number(e.target.value))}
                  className="w-20"
                />
              </label>
            </div>

            {/* Canvas */}
            <div className="flex-1 relative">
              <canvas
                ref={canvasCallback}
                className="w-full h-full"
                style={{ cursor: hoveredId ? 'pointer' : 'default' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => {
                  setHoveredId(null);
                  onRegionHover?.(null);
                  hideTooltip();
                }}
                onClick={handleClick}
              />
            </div>

            {/* Time slider */}
            {snapshots.length > 1 && currentYear === undefined && (
              <div className="flex items-center gap-3 px-4 py-2 bg-white border-t text-sm flex-shrink-0">
                <span className="text-gray-600 font-medium">Year:</span>
                <input
                  type="range"
                  min={yearRange.min}
                  max={yearRange.max}
                  value={internalYear}
                  onChange={(e) => setInternalYear(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-gray-700 w-20 text-right">
                  {internalYear < 0
                    ? `${Math.abs(internalYear)} BCE`
                    : `${internalYear} CE`}
                </span>
              </div>
            )}

            {/* Legend */}
            {regions.length > 0 && (
              <div className="flex flex-wrap gap-3 px-4 py-2 bg-white border-t text-xs">
                {regions.map((r) => (
                  <div key={r.id} className="flex items-center gap-1">
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="text-gray-700">{r.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }}
    </VisualizationContainer>
  );
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(
  x: number,
  y: number,
  polygon: [number, number][],
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
