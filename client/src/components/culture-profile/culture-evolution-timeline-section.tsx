import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import CultureEvolutionTimeline from "@/components/visualizations/CultureEvolutionTimeline";
import type { CultureEvent } from "./culture-evolution-timeline-utils";
import { formatYearRange } from "./culture-evolution-timeline-utils";

interface Props {
  cultureProfileId: string;
  cultureName: string;
  profileStart: number;
  profileEnd: number;
}

interface EventsResponse {
  cultureProfileId: string;
  events: CultureEvent[];
  count: number;
}

export default function CultureEvolutionTimelineSection({
  cultureProfileId,
  cultureName,
  profileStart,
  profileEnd,
}: Props) {
  const { data, isLoading, isError } = useQuery<EventsResponse>({
    queryKey: ["/api/culture-profiles", cultureProfileId, "evolution-events"],
    queryFn: async () => {
      const response = await fetch(
        `/api/culture-profiles/${cultureProfileId}/evolution-events`
      );
      if (!response.ok) throw new Error("Failed to fetch evolution events");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div
        className="space-y-2 animate-pulse"
        data-testid="culture-evolution-loading"
      >
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="text-center py-6 text-gray-400 dark:text-gray-500"
        data-testid="culture-evolution-error"
      >
        <TrendingUp className="h-8 w-8 mx-auto mb-2" />
        <p className="text-sm">Failed to load evolution events</p>
      </div>
    );
  }

  const events = data?.events ?? [];

  return (
    <div className="space-y-3" data-testid="culture-evolution-section">
      <div className="flex items-start gap-2">
        <TrendingUp className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {cultureName} evolution
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {formatYearRange(profileStart, profileEnd)} &middot; {events.length} event
            {events.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {events.length === 0 ? (
        <div
          className="text-center py-6 text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg"
          data-testid="culture-evolution-empty"
        >
          <p className="text-sm">No evolution events recorded yet</p>
          <p className="text-xs mt-1">
            Timeline shows the culture&apos;s active period only.
          </p>
          <div className="mt-4 px-3">
            <CultureEvolutionTimeline
              events={[]}
              profileStart={profileStart}
              profileEnd={profileEnd}
            />
          </div>
        </div>
      ) : (
        <CultureEvolutionTimeline
          events={events}
          profileStart={profileStart}
          profileEnd={profileEnd}
        />
      )}
    </div>
  );
}
