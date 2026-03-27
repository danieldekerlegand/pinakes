import React from 'react';
import Slider from 'rc-slider';
import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, Clock } from 'lucide-react';
import { Button } from '../../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
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
  const [isOpen, setIsOpen] = React.useState(false);

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

  if (!isOpen) {
    return (
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="bg-white shadow-lg"
        >
          <Clock className="h-4 w-4 mr-2" />
          {formatYear(currentYear)} &middot; {getEpochLabel(currentYear)}
          <ChevronUp className="h-4 w-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-white rounded-lg shadow-lg border p-2 w-[calc(100%-2rem)] md:min-w-[400px] md:max-w-[560px] md:w-auto" role="region" aria-label="Time navigation controls">
      <div className="space-y-1.5">
        {/* Header with year and collapse */}
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-gray-900">
            {formatYear(currentYear)}
            <span className="ml-1.5 text-xs font-normal text-gray-500">{getEpochLabel(currentYear)}</span>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setIsOpen(false)}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        {/* Slider */}
        <div className="px-1">
          <Slider
            min={minYear}
            max={maxYear}
            value={currentYear}
            onChange={(value) => {
              if (typeof value === 'number') {
                onYearChange(value);
              }
            }}
            trackStyle={{ backgroundColor: '#3b82f6', height: 4 }}
            railStyle={{ backgroundColor: '#e5e7eb', height: 4 }}
            handleStyle={{
              borderColor: '#3b82f6',
              height: 20,
              width: 20,
              marginTop: -8,
              backgroundColor: '#fff',
              touchAction: 'none',
            }}
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>{formatYear(minYear)}</span>
            <span>{formatYear(maxYear)}</span>
          </div>
        </div>

        {/* Controls - compact row */}
        <div className="flex items-center justify-center gap-1">
          <Button variant="outline" size="sm" onClick={onJumpToStart} title="Jump to start" aria-label="Jump to earliest time period" className="h-7 w-7 p-0">
            <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={onStepBackward} disabled={currentYear <= minYear} title={`Step back ${stepSize} years`} className="h-7 w-7 p-0">
            <SkipBack className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button size="sm" onClick={onPlayPause} className="h-7 w-16" aria-label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? (
              <><Pause className="h-3.5 w-3.5 mr-1" />Pause</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1" />Play</>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={onStepForward} disabled={currentYear >= maxYear} title={`Step forward ${stepSize} years`} className="h-7 w-7 p-0">
            <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={onJumpToEnd} title="Jump to end" className="h-7 w-7 p-0">
            <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>

          {/* Speed & Step inline */}
          <div className="border-l pl-1 ml-1 flex items-center gap-1">
            <Select value={playbackSpeed.toString()} onValueChange={(v) => onSpeedChange(parseInt(v))}>
              <SelectTrigger className="w-[60px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="5">5x</SelectItem>
                <SelectItem value="10">10x</SelectItem>
                <SelectItem value="50">50x</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stepSize.toString()} onValueChange={(v) => onStepSizeChange(parseInt(v))}>
              <SelectTrigger className="w-[72px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10yr</SelectItem>
                <SelectItem value="25">25yr</SelectItem>
                <SelectItem value="50">50yr</SelectItem>
                <SelectItem value="100">100yr</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
