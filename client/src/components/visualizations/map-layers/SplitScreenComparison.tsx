import React from 'react';
import { Columns2, X, ArrowLeftRight, Eye, Timer } from 'lucide-react';
import { Button } from '../../ui/button';
import type { ComparisonMode } from '../hooks/useSplitScreen';
import { formatYear } from '../hooks/useSplitScreen';

interface SplitScreenComparisonProps {
  isOpen: boolean;
  mode: ComparisonMode;
  leftYear: number;
  rightYear: number;
  minYear: number;
  maxYear: number;
  dividerPosition: number;
  blinkInterval: number;
  blinkShowingLeft: boolean;
  onClose: () => void;
  onModeChange: (mode: ComparisonMode) => void;
  onLeftYearChange: (year: number) => void;
  onRightYearChange: (year: number) => void;
  onDividerPositionChange: (position: number) => void;
  onBlinkIntervalChange: (interval: number) => void;
  onSwapYears: () => void;
}

export function SplitScreenComparison({
  isOpen,
  mode,
  leftYear,
  rightYear,
  minYear,
  maxYear,
  dividerPosition,
  blinkInterval,
  blinkShowingLeft,
  onClose,
  onModeChange,
  onLeftYearChange,
  onRightYearChange,
  onDividerPositionChange,
  onBlinkIntervalChange,
  onSwapYears,
}: SplitScreenComparisonProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-lg border p-3 w-72">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Columns2 className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-sm">Map Comparison</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Mode Selector */}
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-md p-0.5">
        <button
          onClick={() => onModeChange('swipe')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
            mode === 'swipe'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <Columns2 className="h-3 w-3" />
          Swipe
        </button>
        <button
          onClick={() => onModeChange('blink')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
            mode === 'blink'
              ? 'bg-white text-blue-700 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <Eye className="h-3 w-3" />
          Blink
        </button>
      </div>

      {/* Year Comparison */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-0.5">Left / Period A</label>
            <div className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-xs font-medium">{formatYear(leftYear)}</span>
            </div>
          </div>
          <button
            onClick={onSwapYears}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            title="Swap years"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1 text-right">
            <label className="text-xs text-gray-500 block mb-0.5">Right / Period B</label>
            <div className="flex items-center justify-end gap-1">
              <span className="text-xs font-medium text-orange-600">{formatYear(rightYear)}</span>
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
            </div>
          </div>
        </div>

        {/* Left Year Slider */}
        <div>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={leftYear}
            onChange={(e) => onLeftYearChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-blue-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        {/* Right Year Slider */}
        <div>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={rightYear}
            onChange={(e) => onRightYearChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-orange-100 rounded-lg appearance-none cursor-pointer accent-orange-500"
          />
        </div>

        <div className="flex justify-between text-[10px] text-gray-400">
          <span>{formatYear(minYear)}</span>
          <span>{formatYear(maxYear)}</span>
        </div>
      </div>

      {/* Swipe-specific: Divider Position */}
      {mode === 'swipe' && (
        <div className="mb-3">
          <label className="text-xs text-gray-600 mb-1 block flex items-center gap-1">
            <Columns2 className="h-3 w-3" />
            Divider position: {dividerPosition}%
          </label>
          <input
            type="range"
            min={10}
            max={90}
            value={dividerPosition}
            onChange={(e) => onDividerPositionChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-600"
          />
        </div>
      )}

      {/* Blink-specific: Interval */}
      {mode === 'blink' && (
        <div className="mb-3">
          <label className="text-xs text-gray-600 mb-1 block flex items-center gap-1">
            <Timer className="h-3 w-3" />
            Blink speed: {(blinkInterval / 1000).toFixed(1)}s
          </label>
          <input
            type="range"
            min={200}
            max={5000}
            step={100}
            value={blinkInterval}
            onChange={(e) => onBlinkIntervalChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-600"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>Fast (0.2s)</span>
            <span>Slow (5s)</span>
          </div>

          {/* Blink indicator */}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-gray-500">Showing:</span>
            <span
              className={`font-medium transition-colors ${
                blinkShowingLeft ? 'text-blue-600' : 'text-orange-600'
              }`}
            >
              {blinkShowingLeft ? formatYear(leftYear) : formatYear(rightYear)}
            </span>
            <span
              className={`inline-block w-2 h-2 rounded-full transition-colors ${
                blinkShowingLeft ? 'bg-blue-500' : 'bg-orange-500'
              }`}
            />
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="text-[10px] text-gray-400 border-t pt-2">
        {mode === 'swipe'
          ? 'Drag the divider to compare time periods side by side'
          : 'Map alternates between two time periods'}
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
