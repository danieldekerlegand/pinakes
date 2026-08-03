import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  ArrowLeft,
  MapPin,
  Clock,
} from "lucide-react";

interface NarrativeStep {
  text: string;
  mapCenter: [number, number];
  mapZoom: number;
  timePoint: number;
  highlightedEntities: string[];
  layerConfig: { layers: string[] };
}

interface NarrativeSummary {
  id: string;
  title: string;
  description: string;
  steps: NarrativeStep[];
}

interface NarrativesResponse {
  narratives: NarrativeSummary[];
  count: number;
}

function NarrativeList() {
  const { data, isLoading, error } = useQuery<NarrativesResponse>({
    queryKey: ["/api/narratives"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-400 py-12">
        Failed to load narratives.
      </div>
    );
  }

  const narratives = data?.narratives ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Dashboard
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="w-8 h-8 text-blue-400" />
          <h1 className="text-3xl font-bold">Guided Stories</h1>
        </div>
        <p className="text-gray-400 mb-10 max-w-2xl">
          Pre-built guided tours that walk you through fascinating linguistic stories.
          Each narrative auto-navigates through maps, timelines, and layers as the story progresses.
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          {narratives.map((n) => (
            <Link key={n.id} href={`/stories/${n.id}`}>
              <Card className="bg-gray-900 border-gray-800 hover:border-blue-500/50 transition-colors cursor-pointer p-6 h-full">
                <h2 className="text-lg font-semibold text-white mb-2">{n.title}</h2>
                <p className="text-gray-400 text-sm mb-4 line-clamp-3">{n.description}</p>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {n.steps.length} steps
                  </span>
                  {n.steps.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatYear(n.steps[0].timePoint)} &rarr; {formatYear(n.steps[n.steps.length - 1].timePoint)}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {narratives.length === 0 && (
          <div className="text-center text-gray-500 py-16">
            No narratives available yet.
          </div>
        )}
      </div>
    </div>
  );
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function NarrativePlayer() {
  const [, params] = useRoute("/stories/:id");
  const id = params?.id;
  const [, setLocation] = useLocation();

  const { data: narrative, isLoading, error } = useQuery<NarrativeSummary>({
    queryKey: ["/api/narratives", id],
    enabled: !!id,
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSteps = narrative?.steps.length ?? 0;
  const step = narrative?.steps[currentStep];

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

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(goNext, 8000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, goNext]);

  // Reset step when narrative changes
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !narrative) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-white">
        <p className="text-red-400 mb-4">Narrative not found.</p>
        <Button variant="outline" onClick={() => setLocation("/stories")}>
          Back to Stories
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/stories">
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-1" />
                All Stories
              </Button>
            </Link>
            <span className="text-gray-600">|</span>
            <h1 className="text-lg font-semibold truncate max-w-md">{narrative.title}</h1>
          </div>
          <div className="text-sm text-gray-500">
            Step {currentStep + 1} of {totalSteps}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="max-w-3xl w-full">
          {step && (
            <>
              {/* Map/Timeline info bar */}
              <div className="flex items-center gap-4 mb-6 text-sm">
                <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatYear(step.timePoint)}
                </span>
                <span className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {step.mapCenter[0].toFixed(1)}, {step.mapCenter[1].toFixed(1)}
                </span>
                {step.highlightedEntities.length > 0 && (
                  <span className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full">
                    {step.highlightedEntities.join(", ")}
                  </span>
                )}
                {step.layerConfig.layers.length > 0 && (
                  <span className="bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full text-xs">
                    {step.layerConfig.layers.join(", ")}
                  </span>
                )}
              </div>

              {/* Story text card */}
              <Card className="bg-gray-900 border-gray-800 p-8 mb-8">
                <p className="text-gray-200 text-lg leading-relaxed">{step.text}</p>
              </Card>

              {/* Progress bar */}
              <div className="flex gap-1 mb-8">
                {narrative.steps.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { setCurrentStep(i); setIsPlaying(false); }}
                    className={`flex-1 h-1.5 rounded-full transition-colors ${
                      i === currentStep
                        ? "bg-blue-500"
                        : i < currentStep
                          ? "bg-blue-500/40"
                          : "bg-gray-700"
                    }`}
                  />
                ))}
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrev}
                  disabled={currentStep === 0}
                  className="border-gray-700"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>

                <Button
                  variant={isPlaying ? "destructive" : "default"}
                  size="sm"
                  onClick={togglePlay}
                  className="min-w-[100px]"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-1" />
                      Play
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={goNext}
                  disabled={currentStep >= totalSteps - 1}
                  className="border-gray-700"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StoriesPage() {
  const [isPlayer] = useRoute("/stories/:id");

  if (isPlayer) {
    return <NarrativePlayer />;
  }

  return <NarrativeList />;
}
