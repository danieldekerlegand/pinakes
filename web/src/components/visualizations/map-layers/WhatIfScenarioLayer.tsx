import React from 'react';
import { Polygon, Polyline, CircleMarker, Tooltip, Popup } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { WhatIfScenario, ScenarioOverlay } from '../../../lib/visualization/what-if-scenarios';

interface WhatIfScenarioLayerProps {
  scenario: WhatIfScenario;
  opacity?: number;
}

// Distinct "speculative" styling: dashed magenta, deliberately unlike any real dataset.
const SPECULATIVE_COLOR = '#a21caf'; // fuchsia-700
const SPECULATIVE_DASH = '8 6';

// GeoJSON stores [lng, lat]; Leaflet wants [lat, lng].
function toLatLng(pos: number[]): LatLngExpression {
  return [pos[1], pos[0]];
}

function OverlayPopup({ overlay }: { overlay: ScenarioOverlay }) {
  return (
    <Popup>
      <div className="min-w-[200px] max-w-[300px]">
        <p className="mb-1 inline-block rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-800">
          Speculative
        </p>
        <h4 className="text-sm font-bold">{overlay.label}</h4>
        {overlay.note && <p className="mt-1 text-xs text-gray-600">{overlay.note}</p>}
      </div>
    </Popup>
  );
}

/**
 * Renders a single What-If scenario's speculative overlay geometry on the map.
 * Purely additive — it never touches or mutates the real datasets underneath.
 */
export function WhatIfScenarioLayer({ scenario, opacity = 0.5 }: WhatIfScenarioLayerProps) {
  return (
    <>
      {scenario.overlays.map((overlay) => {
        const key = `${scenario.id}:${overlay.id}`;

        if (overlay.kind === 'polygon') {
          const rings = (overlay.coordinates as number[][][]).map((ring) => ring.map(toLatLng));
          return (
            <Polygon
              key={key}
              positions={rings}
              pathOptions={{
                color: SPECULATIVE_COLOR,
                weight: 2,
                opacity: 0.9,
                fillColor: SPECULATIVE_COLOR,
                fillOpacity: opacity * 0.4,
                dashArray: SPECULATIVE_DASH,
              }}
            >
              <Tooltip sticky className="text-xs">
                {overlay.label} (speculative)
              </Tooltip>
              <OverlayPopup overlay={overlay} />
            </Polygon>
          );
        }

        if (overlay.kind === 'line') {
          const positions = (overlay.coordinates as number[][]).map(toLatLng);
          return (
            <Polyline
              key={key}
              positions={positions}
              pathOptions={{
                color: SPECULATIVE_COLOR,
                weight: 3,
                opacity: Math.min(1, opacity + 0.4),
                dashArray: SPECULATIVE_DASH,
              }}
            >
              <Tooltip sticky className="text-xs">
                {overlay.label} (speculative)
              </Tooltip>
              <OverlayPopup overlay={overlay} />
            </Polyline>
          );
        }

        // marker
        const center = toLatLng(overlay.coordinates as number[]);
        return (
          <CircleMarker
            key={key}
            center={center}
            radius={7}
            pathOptions={{
              color: SPECULATIVE_COLOR,
              weight: 2,
              opacity: 0.9,
              fillColor: '#f0abfc', // fuchsia-300
              fillOpacity: Math.min(1, opacity + 0.3),
              dashArray: SPECULATIVE_DASH,
            }}
          >
            <Tooltip direction="top" className="text-xs">
              {overlay.label} (speculative)
            </Tooltip>
            <OverlayPopup overlay={overlay} />
          </CircleMarker>
        );
      })}
    </>
  );
}
