import React, { useState } from 'react';
import { Sparkles, X, ChevronDown } from 'lucide-react';
import { Button } from '../../ui/button';
import type { UrheimatHypothesisFeature } from './UrheimatHypothesisLayer';
import {
  competingFamilies,
  consensusLabel,
  consensusBadgeColor,
  familyLabel,
} from '../../../lib/visualization/urheimat-hypotheses';

interface UrheimatHypothesisControlProps {
  hypotheses: UrheimatHypothesisFeature[];
  activeHypothesisId: string | null;
  onSelectHypothesis: (id: string) => void;
  onClear: () => void;
}

/**
 * Toggle control for competing Urheimat (homeland) hypotheses (US-002). Groups
 * hypotheses by language family and, for each family with ≥2 competing hypotheses,
 * lets the user switch between them. The active hypothesis drives which migration
 * routes the map highlights vs dims (see EnhancedLanguageMapView route wiring).
 *
 * Each hypothesis is clearly labelled as a scholarly hypothesis with its consensus
 * level, key proponents, and source count.
 */
export function UrheimatHypothesisControl({
  hypotheses,
  activeHypothesisId,
  onSelectHypothesis,
  onClear,
}: UrheimatHypothesisControlProps) {
  const [open, setOpen] = useState(false);
  const families = competingFamilies(hypotheses);

  if (families.length === 0) return null;

  const active = activeHypothesisId
    ? hypotheses.find((h) => h.id === activeHypothesisId) ?? null
    : null;

  return (
    <div className="absolute bottom-4 left-[24rem] z-[1000]">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className={`bg-white shadow-lg ${active ? 'border-indigo-500 text-indigo-700' : ''}`}
        title="Compare competing Urheimat (homeland) hypotheses"
        aria-expanded={open}
      >
        <Sparkles className="mr-1.5 h-4 w-4" />
        Urheimat
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>

      {open && (
        <div className="absolute bottom-11 left-0 w-96 rounded-lg border bg-white p-2 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-gray-700">Competing homeland hypotheses</span>
            {active && (
              <button onClick={onClear} className="text-xs text-indigo-600 hover:underline">
                Clear
              </button>
            )}
          </div>

          <div className="max-h-80 space-y-3 overflow-y-auto">
            {families.map((group) => (
              <div key={group.familyId}>
                <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {familyLabel(group.familyId)}
                </div>
                <div className="space-y-1">
                  {group.hypotheses.map((h) => {
                    const isActive = h.id === activeHypothesisId;
                    return (
                      <button
                        key={h.id}
                        onClick={() => onSelectHypothesis(h.id)}
                        className={`w-full rounded-md border p-2 text-left transition ${
                          isActive
                            ? 'border-indigo-400 bg-indigo-50'
                            : 'border-transparent hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900">{h.hypothesisName}</span>
                          {isActive && (
                            <span className="mt-0.5 flex-shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              ON
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-600">{h.proposedRegion}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${consensusBadgeColor(h.scholarlyConsensusLevel)}`}
                          >
                            {h.scholarlyConsensusLevel}% · {consensusLabel(h.scholarlyConsensusLevel)}
                          </span>
                          {h.sources.length > 0 && (
                            <span className="text-[10px] text-gray-400">
                              {h.sources.length} source{h.sources.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        {h.keyProponents.length > 0 && (
                          <p className="mt-1 text-[10px] text-gray-500">
                            {h.keyProponents.slice(0, 3).join(', ')}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-2 border-t px-1 pt-1.5 text-[10px] text-gray-400">
            Scholarly hypotheses. Selecting one highlights the migration routes it implies and dims the
            rest — it never changes the underlying data.
          </p>
        </div>
      )}
    </div>
  );
}
