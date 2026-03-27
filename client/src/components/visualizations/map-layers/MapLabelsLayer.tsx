import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type {
  LanguageRangeFeature,
  ArchaeologicalSiteFeature,
  CivilizationFeature,
  HistoricalRouteFeature,
  ArchaeologicalCultureFeature,
} from '../../../lib/visualization/geospatial-types';
import {
  type MapLabel,
  type VisibleLabel,
  placeLabels,
  computePriority,
  minZoomForLabel,
  curvedPathForRegion,
  polygonCentroid,
} from '../../../lib/visualization/map-label-engine';
import { VIS_TEXT_COLORS } from '../../../lib/visualization/color-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MapLabelsLayerProps {
  languageRanges?: LanguageRangeFeature[];
  civilizations?: CivilizationFeature[];
  archaeologicalCultures?: ArchaeologicalCultureFeature[];
  archaeologicalSites?: ArchaeologicalSiteFeature[];
  routes?: HistoricalRouteFeature[];
  enabledLabelLayers: Set<string>;
  opacity?: number;
}

// ---------------------------------------------------------------------------
// Label extraction helpers
// ---------------------------------------------------------------------------

function extractRegionLabels(
  features: { geometry: { type: string; coordinates: any }; properties: any }[],
  layerId: string,
  nameKey: string,
  importanceKey?: string,
): MapLabel[] {
  return features.map((f) => {
    const ring: [number, number][] =
      f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates[0][0]
        : f.geometry.coordinates[0];
    const [lng, lat] = polygonCentroid(ring);
    const importance = importanceKey ? f.properties[importanceKey] : undefined;
    return {
      id: `${layerId}-${f.properties.name || f.properties[nameKey]}`,
      text: f.properties.name || f.properties[nameKey] || '',
      type: 'region' as const,
      lat,
      lng,
      priority: computePriority('region', undefined, importance),
      minZoom: minZoomForLabel('region'),
      curvePath: ring,
      layerId,
    };
  });
}

function extractSettlementLabels(sites: ArchaeologicalSiteFeature[]): MapLabel[] {
  return sites.map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const importance = f.properties.importance ?? 50;
    // Derive rank from importance
    let rank: 'capital' | 'major' | 'minor' = 'minor';
    if (importance >= 80) rank = 'capital';
    else if (importance >= 50) rank = 'major';

    return {
      id: `settlement-${f.properties.siteId}`,
      text: f.properties.name,
      type: 'settlement' as const,
      lat,
      lng,
      priority: computePriority('settlement', rank, importance),
      minZoom: minZoomForLabel('settlement', rank),
      settlementRank: rank,
      layerId: 'settlement-labels',
    };
  });
}

function extractRouteLabels(routes: HistoricalRouteFeature[]): MapLabel[] {
  return routes.map((f) => {
    // Place label at midpoint of route
    const coords = f.geometry.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    return {
      id: `route-${f.properties.routeId}`,
      text: f.properties.name,
      type: 'route' as const,
      lat: mid[1],
      lng: mid[0],
      priority: computePriority('route'),
      minZoom: minZoomForLabel('route'),
      layerId: 'route-labels',
    };
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapLabelsLayer({
  languageRanges = [],
  civilizations = [],
  archaeologicalCultures = [],
  archaeologicalSites = [],
  routes = [],
  enabledLabelLayers,
  opacity = 1,
}: MapLabelsLayerProps) {
  const map = useMap();
  const svgOverlayRef = useRef<L.SVGOverlay | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(map.getZoom());

  // Listen for zoom/move changes
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => setZoom(map.getZoom()), // triggers re-render on pan too
  });

  // Build all labels from input features
  const allLabels = useMemo((): MapLabel[] => {
    const labels: MapLabel[] = [];

    if (languageRanges.length > 0) {
      labels.push(
        ...extractRegionLabels(languageRanges, 'region-labels', 'languageName'),
      );
    }
    if (civilizations.length > 0) {
      labels.push(
        ...extractRegionLabels(civilizations, 'civilization-labels', 'name'),
      );
    }
    if (archaeologicalCultures.length > 0) {
      labels.push(
        ...extractRegionLabels(archaeologicalCultures, 'culture-labels', 'name', 'confidence'),
      );
    }
    if (archaeologicalSites.length > 0) {
      labels.push(...extractSettlementLabels(archaeologicalSites));
    }
    if (routes.length > 0) {
      labels.push(...extractRouteLabels(routes));
    }

    return labels;
  }, [languageRanges, civilizations, archaeologicalCultures, archaeologicalSites, routes]);

  // Run placement pipeline
  const visibleLabels = useMemo((): VisibleLabel[] => {
    const project = (lat: number, lng: number) => {
      const pt = map.latLngToContainerPoint(L.latLng(lat, lng));
      if (!pt) return null;
      return { x: pt.x, y: pt.y };
    };
    return placeLabels(allLabels, zoom, enabledLabelLayers, project);
  }, [allLabels, zoom, enabledLabelLayers, map]);

  // Find region labels that have curve paths for SVG textPath rendering
  const regionLabelPaths = useMemo(() => {
    return allLabels
      .filter((l) => l.type === 'region' && l.curvePath && enabledLabelLayers.has(l.layerId))
      .map((l) => ({
        ...l,
        svgPath: curvedPathForRegion(l.curvePath!),
      }));
  }, [allLabels, enabledLabelLayers]);

  // Render labels via a Leaflet pane with a custom SVG element
  useEffect(() => {
    // Create or get the labels pane
    let pane = map.getPane('labelsPane');
    if (!pane) {
      pane = map.createPane('labelsPane');
      pane.style.zIndex = '650';
      pane.style.pointerEvents = 'none';
    }

    // Create SVG container if needed
    if (!svgRef.current) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'map-labels-svg');
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.overflow = 'visible';
      svg.style.pointerEvents = 'none';
      pane.appendChild(svg);
      svgRef.current = svg;
    }

    return () => {
      if (svgRef.current && svgRef.current.parentNode) {
        svgRef.current.parentNode.removeChild(svgRef.current);
        svgRef.current = null;
      }
    };
  }, [map]);

  // Update SVG contents when labels change
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const size = map.getSize();
    svg.setAttribute('width', String(size.x));
    svg.setAttribute('height', String(size.y));

    // Clear previous
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);

    // Render curved region labels as textPath elements
    for (const rl of regionLabelPaths) {
      if (!rl.svgPath) continue;
      // Project path coordinates to screen
      const pathCoords = rl.curvePath!;
      const projectedPath = pathCoords
        .map(([lng, lat]) => map.latLngToContainerPoint(L.latLng(lat, lng)))
        .filter((pt) => pt != null);

      if (projectedPath.length < 3) continue;

      // Build projected SVG path
      const cx = projectedPath.reduce((s, p) => s + p.x, 0) / projectedPath.length;
      const cy = projectedPath.reduce((s, p) => s + p.y, 0) / projectedPath.length;

      // Find principal axis from projected points
      let maxDist = 0;
      let farPt = projectedPath[0];
      for (const pt of projectedPath) {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        const d = dx * dx + dy * dy;
        if (d > maxDist) {
          maxDist = d;
          farPt = pt;
        }
      }

      const halfLen = Math.sqrt(maxDist) * 0.5;
      const angle = Math.atan2(farPt.y - cy, farPt.x - cx);

      let x1 = cx - halfLen * Math.cos(angle);
      let y1 = cy - halfLen * Math.sin(angle);
      let x2 = cx + halfLen * Math.cos(angle);
      let y2 = cy + halfLen * Math.sin(angle);

      // Ensure left-to-right
      if (x1 > x2) {
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
      }

      const perpX = -Math.sin(angle) * halfLen * 0.12;
      const perpY = Math.cos(angle) * halfLen * 0.12;
      const pathD = `M ${x1} ${y1} Q ${cx + perpX} ${cy + perpY} ${x2} ${y2}`;

      const pathId = `label-path-${rl.id}`;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('id', pathId);
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');
      defs.appendChild(path);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('fill', VIS_TEXT_COLORS.darker);
      text.setAttribute('opacity', String(opacity * 0.85));
      text.setAttribute('font-size', '13');
      text.setAttribute('font-weight', '600');
      text.setAttribute('font-family', 'system-ui, sans-serif');
      text.setAttribute('letter-spacing', '1.5');
      text.setAttribute('text-anchor', 'middle');

      const textPath = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
      textPath.setAttribute('href', `#${pathId}`);
      textPath.setAttribute('startOffset', '50%');
      textPath.textContent = rl.text.toUpperCase();
      text.appendChild(textPath);

      // Text shadow for readability
      const shadow = text.cloneNode(true) as SVGTextElement;
      shadow.setAttribute('stroke', 'white');
      shadow.setAttribute('stroke-width', '3');
      shadow.setAttribute('stroke-linejoin', 'round');
      shadow.setAttribute('fill', 'none');
      shadow.setAttribute('opacity', String(opacity * 0.6));

      svg.appendChild(shadow);
      svg.appendChild(text);
    }

    // Render point labels (settlements, routes, non-curved regions)
    for (const label of visibleLabels) {
      // Skip region labels that will be rendered as curved textPaths
      if (label.type === 'region' && label.curvePath) continue;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      // Halo for readability
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      halo.setAttribute('x', String(label.screenX));
      halo.setAttribute('y', String(label.screenY));
      halo.setAttribute('text-anchor', 'middle');
      halo.setAttribute('dominant-baseline', 'middle');
      halo.setAttribute('font-size', String(label.fontSize));
      halo.setAttribute('font-family', 'system-ui, sans-serif');
      halo.setAttribute('font-weight', label.type === 'settlement' ? '500' : '400');
      halo.setAttribute('fill', 'none');
      halo.setAttribute('stroke', 'white');
      halo.setAttribute('stroke-width', '3');
      halo.setAttribute('stroke-linejoin', 'round');
      halo.setAttribute('opacity', String(opacity * 0.7));
      halo.textContent = label.text;
      group.appendChild(halo);

      // Label text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(label.screenX));
      text.setAttribute('y', String(label.screenY));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', String(label.fontSize));
      text.setAttribute('font-family', 'system-ui, sans-serif');
      text.setAttribute('fill', label.type === 'route' ? VIS_TEXT_COLORS.dark : VIS_TEXT_COLORS.darkest);
      text.setAttribute('font-weight', label.type === 'settlement' ? '500' : '400');
      text.setAttribute('font-style', label.type === 'route' ? 'italic' : 'normal');
      text.setAttribute('opacity', String(opacity));
      text.textContent = label.text;
      group.appendChild(text);

      svg.appendChild(group);
    }
  }, [visibleLabels, regionLabelPaths, map, zoom, opacity]);

  return null; // rendering is handled imperatively via SVG
}
