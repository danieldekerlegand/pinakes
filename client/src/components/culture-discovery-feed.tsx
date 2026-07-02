import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Shuffle,
  Clock,
  MapPin,
  Sparkles,
  Landmark,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CultureProfile } from "@shared/types";
import {
  CURATED_COLLECTIONS,
  filterProfilesBySearch,
  getCollectionProfiles,
  loadRecentlyViewed,
  pickCultureOfTheDay,
  pickRandomCulture,
  resolveProfilesByIds,
} from "@/lib/culture-discovery-utils";

interface CultureDiscoveryFeedProps {
  onSelectCulture: (cultureId: string) => void;
  recentlyViewedIds?: string[];
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatTimePeriod(start: number, end: number): string {
  return `${formatYear(start)} – ${formatYear(end)}`;
}

function CultureCard({
  profile,
  onClick,
  compact = false,
}: {
  profile: CultureProfile;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left group"
      data-testid={`culture-card-${profile.id}`}
    >
      <Card className="h-full p-4 transition-colors hover:border-indigo-400 hover:shadow-md dark:hover:border-indigo-500">
        <div className="flex items-start gap-2">
          <Landmark className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
              {profile.name}
            </h4>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {profile.region}
            </p>
          </div>
        </div>
        {!compact && (
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
            {profile.summaryDescription}
          </p>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          <Badge variant="outline" className="text-[10px] py-0">
            <Clock className="h-2.5 w-2.5 mr-1" />
            {formatTimePeriod(profile.timePeriodStart, profile.timePeriodEnd)}
          </Badge>
          <Badge variant="outline" className="text-[10px] py-0 capitalize">
            {profile.technologyLevel}
          </Badge>
        </div>
      </Card>
    </button>
  );
}

function CultureOfDayHero({
  profile,
  onClick,
}: {
  profile: CultureProfile;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left"
      data-testid="culture-of-the-day"
    >
      <Card className="p-6 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white hover:shadow-xl transition-shadow border-0">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-90">
          <Sparkles className="h-3.5 w-3.5" />
          Culture of the Day
        </div>
        <h2 className="text-2xl font-semibold mt-2" data-testid="culture-of-day-name">
          {profile.name}
        </h2>
        <div className="flex flex-wrap gap-2 mt-2 text-xs opacity-95">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {profile.region}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimePeriod(profile.timePeriodStart, profile.timePeriodEnd)}
          </span>
        </div>
        <p className="text-sm mt-3 leading-relaxed line-clamp-4 opacity-95">
          {profile.summaryDescription}
        </p>
        <p className="mt-4 text-xs font-medium underline underline-offset-4">
          Explore the full profile →
        </p>
      </Card>
    </button>
  );
}

export default function CultureDiscoveryFeed({
  onSelectCulture,
  recentlyViewedIds,
}: CultureDiscoveryFeedProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [storedRecents, setStoredRecents] = useState<string[]>([]);

  useEffect(() => {
    if (!recentlyViewedIds) {
      setStoredRecents(loadRecentlyViewed());
    }
  }, [recentlyViewedIds]);

  const recents = recentlyViewedIds ?? storedRecents;

  const { data, isLoading, isError } = useQuery<{ profiles: CultureProfile[]; count: number }>({
    queryKey: ["/api/culture-profiles"],
    queryFn: async () => {
      const response = await fetch("/api/culture-profiles");
      if (!response.ok) throw new Error("Failed to fetch culture profiles");
      return response.json();
    },
  });

  const profiles = data?.profiles ?? [];

  const cultureOfDay = useMemo(() => pickCultureOfTheDay(profiles), [profiles]);

  const searchResults = useMemo(
    () => filterProfilesBySearch(profiles, searchQuery),
    [profiles, searchQuery],
  );

  const collectionGroups = useMemo(
    () =>
      CURATED_COLLECTIONS.map((collection) => ({
        collection,
        matches: getCollectionProfiles(profiles, collection, 8),
      })).filter((g) => g.matches.length > 0),
    [profiles],
  );

  const recentProfiles = useMemo(
    () => resolveProfilesByIds(profiles, recents),
    [profiles, recents],
  );

  const handleSurpriseMe = () => {
    const exclude = cultureOfDay ? [cultureOfDay.id, ...recents] : recents;
    const pick = pickRandomCulture(profiles, exclude);
    if (pick) onSelectCulture(pick.id);
  };

  if (isLoading) {
    return (
      <div className="p-6" data-testid="culture-discovery-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError || profiles.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500" data-testid="culture-discovery-empty">
        <Landmark className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No culture profiles available.</p>
      </div>
    );
  }

  const showingSearch = searchQuery.trim().length > 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="culture-discovery-feed">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Discover Cultures
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Explore {profiles.length} culture profiles from across human history.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSurpriseMe}
            data-testid="button-random-culture"
            aria-label="Surprise me with a random culture"
          >
            <Shuffle className="h-4 w-4 mr-2" />
            Surprise me
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search cultures by name, region, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
            data-testid="input-culture-search"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showingSearch ? (
          <section data-testid="search-results-section">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for “{searchQuery}”
            </h3>
            {searchResults.length === 0 ? (
              <p className="text-sm text-gray-500">No cultures match your search.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {searchResults.map((profile) => (
                  <CultureCard
                    key={profile.id}
                    profile={profile}
                    onClick={() => onSelectCulture(profile.id)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {cultureOfDay && (
              <CultureOfDayHero
                profile={cultureOfDay}
                onClick={() => onSelectCulture(cultureOfDay.id)}
              />
            )}

            {recentProfiles.length > 0 && (
              <section data-testid="recently-viewed-section">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Recently Viewed
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {recentProfiles.map((profile) => (
                    <CultureCard
                      key={profile.id}
                      profile={profile}
                      compact
                      onClick={() => onSelectCulture(profile.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {collectionGroups.map(({ collection, matches }) => (
              <section key={collection.id} data-testid={`collection-${collection.id}`}>
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {collection.name}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {collection.description}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {matches.map((profile) => (
                    <CultureCard
                      key={profile.id}
                      profile={profile}
                      onClick={() => onSelectCulture(profile.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
