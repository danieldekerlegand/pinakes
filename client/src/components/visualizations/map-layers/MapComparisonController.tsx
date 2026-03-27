import React from 'react';
import { useMap } from 'react-leaflet';
import { useSplitScreen } from '../hooks/useSplitScreen';
import { SplitScreenComparison, SplitScreenToggle } from './SplitScreenComparison';
import { SwipeDivider } from './SwipeDivider';
import { ComparisonOverlay, useClipDefaultPane } from './ComparisonOverlay';
import type { CivilizationFeature, LanguageRangeFeature } from '../../../lib/visualization/geospatial-types';

interface MapComparisonControllerProps {
  currentYear: number;
  minYear: number;
  maxYear: number;
  /** All civilizations (unfiltered by time — comparison overlay filters internally) */
  allCivilizations: CivilizationFeature[];
  /** All language ranges (unfiltered by time) */
  allLanguageRanges: LanguageRangeFeature[];
  /** Callback to override the displayed year in blink mode */
  onActiveYearChange?: (year: number) => void;
  civilizationOpacity?: number;
  languageRangeOpacity?: number;
}

/**
 * Manages map comparison state and renders the split-screen UI.
 * Must be rendered inside a MapContainer.
 */
export function MapComparisonController({
  currentYear,
  minYear,
  maxYear,
  allCivilizations,
  allLanguageRanges,
  onActiveYearChange,
  civilizationOpacity,
  languageRangeOpacity,
}: MapComparisonControllerProps) {
  const map = useMap();

  const {
    state: splitState,
    activate,
    deactivate,
    toggle,
    setMode,
    setLeftYear,
    setRightYear,
    setDividerPosition,
    setBlinkInterval,
    activeYear,
    swapYears,
  } = useSplitScreen(currentYear, minYear, maxYear);

  // Clip default panes when in swipe mode
  useClipDefaultPane(
    map,
    splitState.dividerPosition,
    splitState.isActive && splitState.mode === 'swipe',
  );

  // Notify parent of active year changes (for blink mode)
  React.useEffect(() => {
    if (onActiveYearChange && splitState.isActive && splitState.mode === 'blink') {
      onActiveYearChange(activeYear);
    }
  }, [activeYear, splitState.isActive, splitState.mode, onActiveYearChange]);

  return (
    <>
      {/* Comparison overlay layers (right side in swipe mode) */}
      {splitState.isActive && splitState.mode === 'swipe' && (
        <ComparisonOverlay
          year={splitState.rightYear}
          dividerPosition={splitState.dividerPosition}
          civilizations={allCivilizations}
          languageRanges={allLanguageRanges}
          civilizationOpacity={civilizationOpacity}
          languageRangeOpacity={languageRangeOpacity}
        />
      )}

      {/* Rendered via portal-like pattern since these are HTML overlays */}
      <MapComparisonUI
        splitState={splitState}
        minYear={minYear}
        maxYear={maxYear}
        onToggle={toggle}
        onClose={deactivate}
        onModeChange={setMode}
        onLeftYearChange={setLeftYear}
        onRightYearChange={setRightYear}
        onDividerPositionChange={setDividerPosition}
        onBlinkIntervalChange={setBlinkInterval}
        onSwapYears={swapYears}
      />
    </>
  );
}

/**
 * HTML overlay components for the comparison UI.
 * Rendered outside the Leaflet pane system.
 */
function MapComparisonUI({
  splitState,
  minYear,
  maxYear,
  onToggle,
  onClose,
  onModeChange,
  onLeftYearChange,
  onRightYearChange,
  onDividerPositionChange,
  onBlinkIntervalChange,
  onSwapYears,
}: {
  splitState: ReturnType<typeof useSplitScreen>['state'];
  minYear: number;
  maxYear: number;
  onToggle: () => void;
  onClose: () => void;
  onModeChange: (mode: 'swipe' | 'blink') => void;
  onLeftYearChange: (year: number) => void;
  onRightYearChange: (year: number) => void;
  onDividerPositionChange: (position: number) => void;
  onBlinkIntervalChange: (interval: number) => void;
  onSwapYears: () => void;
}) {
  // This component needs to be rendered as an HTML overlay on top of the map
  // We use null here — the actual UI is rendered by the parent outside MapContainer
  return null;
}

/**
 * The HTML overlay parts that render OUTSIDE of MapContainer.
 * Import and use this in the parent component.
 */
export function MapComparisonOverlays({
  isActive,
  mode,
  leftYear,
  rightYear,
  dividerPosition,
  blinkInterval,
  blinkShowingLeft,
  minYear,
  maxYear,
  onToggle,
  onClose,
  onModeChange,
  onLeftYearChange,
  onRightYearChange,
  onDividerPositionChange,
  onBlinkIntervalChange,
  onSwapYears,
}: {
  isActive: boolean;
  mode: 'swipe' | 'blink';
  leftYear: number;
  rightYear: number;
  dividerPosition: number;
  blinkInterval: number;
  blinkShowingLeft: boolean;
  minYear: number;
  maxYear: number;
  onToggle: () => void;
  onClose: () => void;
  onModeChange: (mode: 'swipe' | 'blink') => void;
  onLeftYearChange: (year: number) => void;
  onRightYearChange: (year: number) => void;
  onDividerPositionChange: (position: number) => void;
  onBlinkIntervalChange: (interval: number) => void;
  onSwapYears: () => void;
}) {
  return (
    <>
      {/* Toggle button */}
      <div className="absolute top-20 left-4 z-[1000]">
        <SplitScreenToggle isActive={isActive} onToggle={onToggle} />
      </div>

      {/* Swipe divider */}
      {isActive && mode === 'swipe' && (
        <SwipeDivider
          position={dividerPosition}
          leftYear={leftYear}
          rightYear={rightYear}
          onPositionChange={onDividerPositionChange}
        />
      )}

      {/* Blink mode indicator */}
      {isActive && mode === 'blink' && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1001]">
          <div
            className={`px-4 py-2 rounded-full shadow-lg text-sm font-medium transition-colors ${
              blinkShowingLeft
                ? 'bg-blue-500 text-white'
                : 'bg-orange-500 text-white'
            }`}
          >
            {blinkShowingLeft
              ? `Period A: ${leftYear < 0 ? `${Math.abs(leftYear)} BCE` : `${leftYear} CE`}`
              : `Period B: ${rightYear < 0 ? `${Math.abs(rightYear)} BCE` : `${rightYear} CE`}`}
          </div>
        </div>
      )}

      {/* Control panel */}
      <SplitScreenComparison
        isOpen={isActive}
        mode={mode}
        leftYear={leftYear}
        rightYear={rightYear}
        minYear={minYear}
        maxYear={maxYear}
        dividerPosition={dividerPosition}
        blinkInterval={blinkInterval}
        blinkShowingLeft={blinkShowingLeft}
        onClose={onClose}
        onModeChange={onModeChange}
        onLeftYearChange={onLeftYearChange}
        onRightYearChange={onRightYearChange}
        onDividerPositionChange={onDividerPositionChange}
        onBlinkIntervalChange={onBlinkIntervalChange}
        onSwapYears={onSwapYears}
      />
    </>
  );
}
