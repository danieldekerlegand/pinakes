import React from 'react';
import { Polyline, CircleMarker, Tooltip, Popup } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { CounterfactualTradeRoute } from '../../../lib/visualization/counterfactual-trade-routes';

interface CounterfactualTradeRoutesLayerProps {
  routes: CounterfactualTradeRoute[];
  opacity?: number;
}

// Distinct "speculative trade" styling: dashed teal, deliberately unlike the real
// trade-routes layer (solid, terrain-coloured) and the What-If overlay (fuchsia).
const SPECULATIVE_COLOR = '#0d9488'; // teal-600
const SPECULATIVE_DASH = '2 8';

// GeoJSON stores [lng, lat]; Leaflet wants [lat, lng].
function toLatLng(pos: number[]): LatLngExpression {
  return [pos[1], pos[0]];
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function timeRangeLabel(route: CounterfactualTradeRoute): string | null {
  const { start, end } = route.timeRange;
  if (start === null && end === null) return null;
  const lo = start === null ? '…' : formatYear(start);
  const hi = end === null ? '…' : formatYear(end);
  return `${lo} – ${hi}`;
}

function RoutePopup({ route }: { route: CounterfactualTradeRoute }) {
  const range = timeRangeLabel(route);
  return (
    <Popup>
      <div className="min-w-[220px] max-w-[320px]">
        <p className="mb-1 inline-block rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
          Speculative trade route
        </p>
        <h4 className="text-sm font-bold">{route.name}</h4>
        {route.summary && <p className="mt-1 text-xs text-gray-600">{route.summary}</p>}
        {route.premise && (
          <p className="mt-1.5 text-xs italic text-teal-900">{route.premise}</p>
        )}
        {range && <p className="mt-1.5 text-[11px] text-gray-500">{range}</p>}
        {route.goods.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {route.goods.map((good) => (
              <span
                key={good}
                className="inline-block rounded bg-teal-50 px-2 py-0.5 text-[11px] text-teal-800"
              >
                {good}
              </span>
            ))}
          </div>
        )}
        {route.sources.length > 0 && (
          <p className="mt-2 border-t pt-1 text-[10px] text-gray-400">
            {route.sources.length} note(s) — hypothetical, not a real historical route.
          </p>
        )}
      </div>
    </Popup>
  );
}

/**
 * Renders the active counterfactual trade routes (US-003) as a distinct speculative
 * overlay. Purely additive — it never touches, merges into, or mutates the real
 * trade-routes dataset, and toggles independently of the real `trade-routes` layer.
 */
export function CounterfactualTradeRoutesLayer({
  routes,
  opacity = 0.85,
}: CounterfactualTradeRoutesLayerProps) {
  if (routes.length === 0) return null;

  return (
    <>
      {routes.map((route) => {
        const positions = route.path.map(toLatLng);
        const origin = positions[0];
        const destination = positions[positions.length - 1];

        return (
          <React.Fragment key={route.id}>
            <Polyline
              positions={positions}
              pathOptions={{
                color: SPECULATIVE_COLOR,
                weight: 3,
                opacity,
                dashArray: SPECULATIVE_DASH,
                lineCap: 'round',
              }}
            >
              <Tooltip sticky className="text-xs">
                {route.name} (speculative)
              </Tooltip>
              <RoutePopup route={route} />
            </Polyline>

            {/* Endpoint markers so the speculative corridor reads clearly. */}
            {[origin, destination].map((center, i) => (
              <CircleMarker
                key={`${route.id}-end-${i}`}
                center={center}
                radius={5}
                pathOptions={{
                  color: SPECULATIVE_COLOR,
                  weight: 2,
                  opacity,
                  fillColor: '#5eead4', // teal-300
                  fillOpacity: Math.min(1, opacity),
                }}
              >
                <Tooltip direction="top" className="text-xs">
                  {route.name} (speculative)
                </Tooltip>
                <RoutePopup route={route} />
              </CircleMarker>
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
}
