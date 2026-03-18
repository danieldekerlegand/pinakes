import React, { useState, useCallback } from 'react';
import { Columns2, X } from 'lucide-react';
import { Button } from '../../ui/button';

interface SplitScreenComparisonProps {
  currentYear: number;
  minYear: number;
  maxYear: number;
  isOpen: boolean;
  onClose: () => void;
  onComparisonYearChange: (year: number) => void;
  comparisonYear: number;
}

export function SplitScreenComparison({
  currentYear,
  minYear,
  maxYear,
  isOpen,
  onClose,
  onComparisonYearChange,
  comparisonYear,
}: SplitScreenComparisonProps) {
  const formatYear = (year: number): string => {
    return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-lg border p-3 w-64">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Columns2 className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-sm">Time Comparison</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-3">
        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Current view:</span>
            <span className="font-medium">{formatYear(currentYear)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Comparison:</span>
            <span className="font-medium text-blue-600">{formatYear(comparisonYear)}</span>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-600 mb-1 block">Compare with year:</label>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={comparisonYear}
            onChange={(e) => onComparisonYearChange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            <span>{formatYear(minYear)}</span>
            <span>{formatYear(maxYear)}</span>
          </div>
        </div>

        <div className="text-xs text-gray-500 border-t pt-2">
          Comparison boundaries shown with striped overlay
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Toggle Button (to be placed in map controls)
// ============================================================================

interface SplitScreenToggleProps {
  isActive: boolean;
  onToggle: () => void;
}

export function SplitScreenToggle({ isActive, onToggle }: SplitScreenToggleProps) {
  return (
    <Button
      variant={isActive ? 'default' : 'outline'}
      size="sm"
      onClick={onToggle}
      title="Compare two time periods"
      aria-label="Toggle split-screen time comparison"
      className="min-w-[40px] min-h-[40px] touch-manipulation"
    >
      <Columns2 className="h-4 w-4" />
    </Button>
  );
}
