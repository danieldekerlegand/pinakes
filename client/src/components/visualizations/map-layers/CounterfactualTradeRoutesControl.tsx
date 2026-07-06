import React, { useState } from 'react';
import { Route, X, ChevronDown } from 'lucide-react';
import { Button } from '../../ui/button';
import type { CounterfactualTradeRoute } from '../../../lib/visualization/counterfactual-trade-routes';
import { COUNTERFACTUAL_BANNER_TEXT } from '../../../lib/visualization/counterfactual-trade-routes';

interface CounterfactualTradeRoutesControlProps {
  routes: CounterfactualTradeRoute[];
  activeRouteIds: ReadonlySet<string>;
  onToggleRoute: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
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

/**
 * Toggle control + persistent speculative banner for the counterfactual trade-route
 * overlays (US-003). Each route toggles independently, and the whole overlay is
 * independent of the real trade-routes layer.
 */
export function CounterfactualTradeRoutesControl({
  routes,
  activeRouteIds,
  onToggleRoute,
  onSelectAll,
  onClear,
}: CounterfactualTradeRoutesControlProps) {
  const [open, setOpen] = useState(false);
  const activeCount = activeRouteIds.size;

  if (routes.length === 0) return null;

  return (
    <>
      {/* Persistent speculative / educational banner */}
      {activeCount > 0 && (
        <div
          role="status"
          className="absolute left-1/2 top-14 z-[1200] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed border-teal-500 bg-teal-50/95 px-4 py-1.5 text-xs font-medium text-teal-900 shadow-lg"
        >
          <Route className="h-4 w-4 flex-shrink-0" />
          <span className="hidden sm:inline">{COUNTERFACTUAL_BANNER_TEXT}</span>
          <span className="sm:hidden">Speculative trade routes</span>
          <button
            onClick={onClear}
            className="ml-1 rounded-full p-0.5 hover:bg-teal-200"
            aria-label="Turn off counterfactual trade routes"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Selector — offset right of the Urheimat control (left-[24rem]). */}
      <div className="absolute bottom-4 left-[30.5rem] z-[1000]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className={`bg-white shadow-lg ${activeCount > 0 ? 'border-teal-500 text-teal-700' : ''}`}
          title="Counterfactual trade routes"
          aria-expanded={open}
        >
          <Route className="mr-1.5 h-4 w-4" />
          What-If Trade
          {activeCount > 0 && (
            <span className="ml-1.5 rounded-full bg-teal-600 px-1.5 text-[10px] font-semibold text-white">
              {activeCount}
            </span>
          )}
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>

        {open && (
          <div className="absolute bottom-11 left-0 w-80 rounded-lg border bg-white p-2 shadow-xl">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-gray-700">Speculative trade routes</span>
              <div className="flex gap-2">
                <button onClick={onSelectAll} className="text-xs text-teal-600 hover:underline">
                  All
                </button>
                {activeCount > 0 && (
                  <button onClick={onClear} className="text-xs text-teal-600 hover:underline">
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {routes.map((r) => {
                const isActive = activeRouteIds.has(r.id);
                const range = timeRangeLabel(r);
                return (
                  <button
                    key={r.id}
                    onClick={() => onToggleRoute(r.id)}
                    className={`w-full rounded-md border p-2 text-left transition ${
                      isActive
                        ? 'border-teal-400 bg-teal-50'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{r.name}</span>
                      {isActive && (
                        <span className="mt-0.5 flex-shrink-0 rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          ON
                        </span>
                      )}
                    </div>
                    {r.summary && <p className="mt-1 text-xs text-gray-600">{r.summary}</p>}
                    {range && <p className="mt-1 text-[11px] text-gray-500">{range}</p>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 border-t px-1 pt-1.5 text-[10px] text-gray-400">
              Hypothetical routes — separate from the real trade-routes layer and never
              mixed into the underlying data.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
