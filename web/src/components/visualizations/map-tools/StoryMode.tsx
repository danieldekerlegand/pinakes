import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
  MapPin,
  Clock,
  Layers,
  Compass,
} from 'lucide-react';
import { Button } from '../../ui/button';
import {
  CURATED_TOURS,
  formatTourYear,
  getTourTimeSpanLabel,
} from './story-mode-data';
import type { HistoricalTour } from './story-mode-data';

// Re-export types and data for consumers
export type { TourStep, HistoricalTour } from './story-mode-data';
export { CURATED_TOURS, formatTourYear, getTourTimeSpanLabel, getTourStepCount, getTourById } from './story-mode-data';

// ── Story Mode Panel props ───────────────────────────────────────────

interface StoryModeProps {
  onNavigate: (center: [number, number], zoom: number) => void;
  onTimeChange: (year: number) => void;
  onLayersChange: (layers: string[]) => void;
  onClose: () => void;
}

function TourSelector({
  onSelect,
  onClose,
}: {
  onSelect: (tour: HistoricalTour) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-600" />
          <h3 className="font-semibold text-sm text-gray-900">Historical Tours</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Guided tours through historical periods with map navigation, timeline control, and layer activation.
      </p>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {CURATED_TOURS.map((tour) => (
          <button
            key={tour.id}
            onClick={() => onSelect(tour)}
            className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <div className="font-medium text-sm text-gray-900">{tour.title}</div>
            <div className="text-xs text-gray-500 mt-1 line-clamp-2">{tour.description}</div>
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {tour.steps.length} stops
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {getTourTimeSpanLabel(tour)}
              </span>
              <span className="flex items-center gap-1">
                <Compass className="w-3 h-3" />
                {tour.coverRegion}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TourPlayer({
  tour,
  onNavigate,
  onTimeChange,
  onLayersChange,
  onBack,
  onClose,
}: {
  tour: HistoricalTour;
  onNavigate: (center: [number, number], zoom: number) => void;
  onTimeChange: (year: number) => void;
  onLayersChange: (layers: string[]) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalSteps = tour.steps.length;
  const step = tour.steps[currentStep];

  // Apply step effects whenever step changes
  useEffect(() => {
    if (!step) return;
    onNavigate(step.center, step.zoom);
    onTimeChange(step.timeYear);
    onLayersChange(step.layers);
  }, [currentStep, step, onNavigate, onTimeChange, onLayersChange]);

  const goNext = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= totalSteps - 1) {
        setIsPlaying(false);
        return prev;
      }
      return prev + 1;
    });
  }, [totalSteps]);

  const goPrev = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Auto-advance timer
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(goNext, 10000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, goNext]);

  if (!step) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="h-6 w-6 p-0 shrink-0">
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <h3 className="font-semibold text-sm text-gray-900 truncate">{tour.title}</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 shrink-0">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Step info badges */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTourYear(step.timeYear)}
        </span>
        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          {step.center[0].toFixed(1)}, {step.center[1].toFixed(1)}
        </span>
        {step.layers.length > 0 && (
          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Layers className="w-3 h-3" />
            {step.layers.length} layers
          </span>
        )}
      </div>

      {/* Narration */}
      <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
        <p className="text-sm text-gray-700 leading-relaxed">{step.narration}</p>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1">
        {tour.steps.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setCurrentStep(i);
              setIsPlaying(false);
            }}
            className={`flex-1 h-1.5 rounded-full transition-colors ${
              i === currentStep
                ? 'bg-blue-500'
                : i < currentStep
                  ? 'bg-blue-300'
                  : 'bg-gray-200'
            }`}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Step {currentStep + 1} of {totalSteps}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentStep === 0}
            className="h-7 px-2"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={isPlaying ? 'destructive' : 'default'}
            size="sm"
            onClick={togglePlay}
            className="h-7 px-3"
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={currentStep >= totalSteps - 1}
            className="h-7 px-2"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main exported component ──────────────────────────────────────────

export function StoryMode({ onNavigate, onTimeChange, onLayersChange, onClose }: StoryModeProps) {
  const [activeTour, setActiveTour] = useState<HistoricalTour | null>(null);

  const handleSelectTour = useCallback((tour: HistoricalTour) => {
    setActiveTour(tour);
  }, []);

  const handleBack = useCallback(() => {
    setActiveTour(null);
  }, []);

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-lg border border-gray-200 p-4 w-80 max-h-[calc(100vh-6rem)] overflow-y-auto">
      {activeTour ? (
        <TourPlayer
          tour={activeTour}
          onNavigate={onNavigate}
          onTimeChange={onTimeChange}
          onLayersChange={onLayersChange}
          onBack={handleBack}
          onClose={onClose}
        />
      ) : (
        <TourSelector onSelect={handleSelectTour} onClose={onClose} />
      )}
    </div>
  );
}
