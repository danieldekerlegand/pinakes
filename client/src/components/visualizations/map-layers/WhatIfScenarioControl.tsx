import React, { useState } from 'react';
import { FlaskConical, X, ChevronDown } from 'lucide-react';
import { Button } from '../../ui/button';
import type { WhatIfScenario } from '../../../lib/visualization/what-if-scenarios';
import { SCENARIO_BANNER_TEXT, getScenarioById } from '../../../lib/visualization/what-if-scenarios';

interface WhatIfScenarioControlProps {
  scenarios: WhatIfScenario[];
  activeScenarioId: string | null;
  onSelectScenario: (id: string) => void;
  onClear: () => void;
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function timeRangeLabel(scenario: WhatIfScenario): string | null {
  const { start, end } = scenario.timeRange;
  if (start === null && end === null) return null;
  const lo = start === null ? '…' : formatYear(start);
  const hi = end === null ? '…' : formatYear(end);
  return `${lo} – ${hi}`;
}

/**
 * Toolbar control + persistent speculative banner for the What-If scenario overlay
 * system (US-001). Selecting a scenario is toggle-based (one active at a time).
 */
export function WhatIfScenarioControl({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  onClear,
}: WhatIfScenarioControlProps) {
  const [open, setOpen] = useState(false);
  const active = getScenarioById(scenarios, activeScenarioId);

  if (scenarios.length === 0) return null;

  return (
    <>
      {/* Persistent speculative / educational banner */}
      {active && (
        <div
          role="status"
          className="absolute left-1/2 top-4 z-[1200] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full border-2 border-dashed border-fuchsia-500 bg-fuchsia-50/95 px-4 py-1.5 text-xs font-medium text-fuchsia-900 shadow-lg"
        >
          <FlaskConical className="h-4 w-4 flex-shrink-0" />
          <span className="hidden sm:inline">{SCENARIO_BANNER_TEXT}</span>
          <span className="sm:hidden">Speculative "what-if" overlay</span>
          <button
            onClick={onClear}
            className="ml-1 rounded-full p-0.5 hover:bg-fuchsia-200"
            aria-label="Turn off scenario overlay"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Scenario selector (offset right of the legend, which sits at bottom-4 left-4) */}
      <div className="absolute bottom-4 left-[17.5rem] z-[1000]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          className={`bg-white shadow-lg ${active ? 'border-fuchsia-500 text-fuchsia-700' : ''}`}
          title="What-If scenario overlays"
          aria-expanded={open}
        >
          <FlaskConical className="mr-1.5 h-4 w-4" />
          What-If
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>

        {open && (
          <div className="absolute bottom-11 left-0 w-80 rounded-lg border bg-white p-2 shadow-xl">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-gray-700">Speculative scenarios</span>
              {active && (
                <button
                  onClick={onClear}
                  className="text-xs text-fuchsia-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {scenarios.map((s) => {
                const isActive = s.id === activeScenarioId;
                const range = timeRangeLabel(s);
                return (
                  <button
                    key={s.id}
                    onClick={() => onSelectScenario(s.id)}
                    className={`w-full rounded-md border p-2 text-left transition ${
                      isActive
                        ? 'border-fuchsia-400 bg-fuchsia-50'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{s.title}</span>
                      {isActive && (
                        <span className="mt-0.5 flex-shrink-0 rounded bg-fuchsia-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          ON
                        </span>
                      )}
                    </div>
                    {s.summary && <p className="mt-1 text-xs text-gray-600">{s.summary}</p>}
                    {range && <p className="mt-1 text-[11px] text-gray-500">{range}</p>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 border-t px-1 pt-1.5 text-[10px] text-gray-400">
              Overlays are hypothetical and never change the underlying data.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
