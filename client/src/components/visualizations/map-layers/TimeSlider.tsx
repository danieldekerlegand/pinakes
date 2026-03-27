import React from 'react';
import Slider from 'rc-slider';
import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '../../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { SLIDER_COLORS } from '../../../lib/visualization/color-theme';
import 'rc-slider/assets/index.css';

interface TimeSliderProps {
  currentYear: number;
  minYear: number;
  maxYear: number;
  isPlaying: boolean;
  playbackSpeed: number;
  stepSize: number;
  onYearChange: (year: number) => void;
  onPlayPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onStepSizeChange: (size: number) => void;
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
}

export function TimeSlider({
  currentYear,
  minYear,
  maxYear,
  isPlaying,
  playbackSpeed,
  stepSize,
  onYearChange,
  onPlayPause,
  onStepForward,
  onStepBackward,
  onSpeedChange,
  onStepSizeChange,
  onJumpToStart,
  onJumpToEnd,
}: TimeSliderProps) {
  const formatYear = (year: number): string => {
    if (year < 0) {
      return `${Math.abs(year)} BCE`;
    }
    return `${year} CE`;
  };

  const getEpochLabel = (year: number): string => {
    if (year < -3000) return 'Prehistoric';
    if (year < -1200) return 'Bronze Age';
    if (year < -500) return 'Iron Age';
    if (year < 500) return 'Classical';
    if (year < 1500) return 'Medieval';
    if (year < 1800) return 'Early Modern';
    return 'Modern';
  };

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-white rounded-lg shadow-lg border p-3 md:p-4 w-[calc(100%-2rem)] md:min-w-[600px] md:max-w-[800px] md:w-auto" role="region" aria-label="Time navigation controls">
      <div className="space-y-3">
        {/* Current Year Display */}
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{formatYear(currentYear)}</div>
          <div className="text-xs text-gray-500">{getEpochLabel(currentYear)} Period</div>
        </div>

        {/* Slider */}
        <div className="px-2 py-1">
          <Slider
            min={minYear}
            max={maxYear}
            value={currentYear}
            onChange={(value) => {
              if (typeof value === 'number') {
                onYearChange(value);
              }
            }}
            trackStyle={{ backgroundColor: SLIDER_COLORS.track, height: 6 }}
            railStyle={{ backgroundColor: SLIDER_COLORS.rail, height: 6 }}
            handleStyle={{
              borderColor: SLIDER_COLORS.track,
              height: 28,
              width: 28,
              marginTop: -11,
              backgroundColor: '#fff',
              touchAction: 'none',
            }}
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatYear(minYear)}</span>
            <span>{formatYear(maxYear)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2">
          {/* Jump to Start */}
          <Button
            variant="outline"
            size="sm"
            onClick={onJumpToStart}
            title="Jump to start"
            aria-label="Jump to earliest time period"
            className="min-w-[40px] min-h-[40px] touch-manipulation"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Step Backward */}
          <Button
            variant="outline"
            size="sm"
            onClick={onStepBackward}
            disabled={currentYear <= minYear}
            title={`Step back ${stepSize} years`}
            aria-label={`Step back ${stepSize} years`}
            className="min-w-[40px] min-h-[40px] touch-manipulation"
          >
            <SkipBack className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Play/Pause */}
          <Button
            size="sm"
            onClick={onPlayPause}
            className="w-20 min-h-[40px] touch-manipulation"
            aria-label={isPlaying ? "Pause timeline playback" : "Play timeline animation"}
          >
            {isPlaying ? (
              <>
                <Pause className="h-4 w-4 mr-1" aria-hidden="true" />
                Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" aria-hidden="true" />
                Play
              </>
            )}
          </Button>

          {/* Step Forward */}
          <Button
            variant="outline"
            size="sm"
            onClick={onStepForward}
            disabled={currentYear >= maxYear}
            title={`Step forward ${stepSize} years`}
            aria-label={`Step forward ${stepSize} years`}
            className="min-w-[40px] min-h-[40px] touch-manipulation"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
          </Button>

          {/* Jump to End */}
          <Button
            variant="outline"
            size="sm"
            onClick={onJumpToEnd}
            title="Jump to end"
            aria-label="Jump to latest time period"
            className="min-w-[40px] min-h-[40px] touch-manipulation"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Speed and Step Size Controls */}
        <div className="flex items-center justify-center gap-4 text-sm">
          {/* Playback Speed */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Speed:</span>
            <Select
              value={playbackSpeed.toString()}
              onValueChange={(value) => onSpeedChange(parseInt(value))}
            >
              <SelectTrigger className="w-[100px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="5">5x</SelectItem>
                <SelectItem value="10">10x</SelectItem>
                <SelectItem value="50">50x</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Step Size */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Step:</span>
            <Select
              value={stepSize.toString()}
              onValueChange={(value) => onStepSizeChange(parseInt(value))}
            >
              <SelectTrigger className="w-[100px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">Decade</SelectItem>
                <SelectItem value="25">25 years</SelectItem>
                <SelectItem value="50">Half century</SelectItem>
                <SelectItem value="100">Century</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Keyboard Shortcuts Hint */}
        <div className="text-xs text-center text-gray-500">
          Space: Play/Pause • ←→: Step • Home/End: Jump
        </div>
      </div>
    </div>
  );
}
