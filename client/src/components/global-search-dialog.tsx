import { useState, useEffect, useCallback, useRef } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Globe,
  BookOpen,
  Swords,
  Map,
  Church,
  Music,
  Guitar,
  UtensilsCrossed,
  Palette,
  Users,
  Package,
  Landmark,
  Clock,
  Type,
  Search,
  Pickaxe,
  MapPin,
  Sparkles,
  Share2,
} from "lucide-react";

interface GraphProvenance {
  source: string;
  qid?: string;
  matchField?: string;
  graphLink?: string | null;
}

interface SearchResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  linkPath: string;
  relevance: number;
  source?: "local" | "graph";
  csid?: string;
  confidence?: number;
  provenance?: GraphProvenance;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalCount: number;
}

interface SpatialResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  distanceKm: number | null;
  timePeriod: string | null;
}

interface SpatialSearchResponse {
  results: SpatialResult[];
  query: { raw: string; locationName: string | null; year: number | null };
  totalCount: number;
}

const RECENT_SEARCHES_KEY = "linguascrape-recent-searches";
const MAX_RECENT = 5;

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  language: <Globe className="h-4 w-4 text-blue-500" />,
  word: <BookOpen className="h-4 w-4 text-green-500" />,
  "language-family": <Users className="h-4 w-4 text-indigo-500" />,
  "writing-system": <Type className="h-4 w-4 text-purple-500" />,
  battle: <Swords className="h-4 w-4 text-red-500" />,
  "migration-route": <Map className="h-4 w-4 text-orange-500" />,
  religion: <Church className="h-4 w-4 text-amber-500" />,
  "music-tradition": <Music className="h-4 w-4 text-pink-500" />,
  "musical-instrument": <Guitar className="h-4 w-4 text-pink-400" />,
  cuisine: <UtensilsCrossed className="h-4 w-4 text-yellow-600" />,
  "cuisine-item": <UtensilsCrossed className="h-4 w-4 text-yellow-500" />,
  "art-tradition": <Palette className="h-4 w-4 text-fuchsia-500" />,
  "kinship-system": <Users className="h-4 w-4 text-teal-500" />,
  "trade-good": <Package className="h-4 w-4 text-emerald-500" />,
  "foodway-event": <UtensilsCrossed className="h-4 w-4 text-orange-400" />,
  civilization: <Landmark className="h-4 w-4 text-stone-500" />,
  "archaeological-site": <Pickaxe className="h-4 w-4 text-stone-400" />,
};

const ENTITY_LABELS: Record<string, string> = {
  language: "Languages",
  word: "Words",
  "language-family": "Language Families",
  "writing-system": "Writing Systems",
  battle: "Battles",
  "migration-route": "Migration Routes",
  religion: "Religions",
  "music-tradition": "Music Traditions",
  "musical-instrument": "Musical Instruments",
  cuisine: "Cuisines",
  "cuisine-item": "Cuisine Items",
  "art-tradition": "Art Traditions",
  "kinship-system": "Kinship Systems",
  "trade-good": "Trade Goods",
  "foodway-event": "Foodway Events",
  civilization: "Civilizations",
  "archaeological-site": "Archaeological Sites",
};

/** Small pill distinguishing local-corpus results from shared-graph hits. */
function SourceBadge({ result }: { result: SearchResult }) {
  if (result.source === "graph") {
    return (
      <span className="shrink-0 rounded-sm bg-purple-100 px-1 py-0 text-[10px] font-medium uppercase tracking-wide text-purple-700">
        Graph
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Local
    </span>
  );
}

/** Detect if a query looks like a natural language question */
function isNaturalLanguageQuery(q: string): boolean {
  const lower = q.toLowerCase().trim();
  // Starts with question words or contains temporal-spatial patterns
  if (/^(what|which|where|who|how|show|find|list)\b/.test(lower)) return true;
  // Contains "in [location]" or "near" patterns
  if (/\b(in|near|around|during)\b.*\b(bce|bc|ce|ad|\d{3,4})\b/i.test(lower)) return true;
  // Contains explicit date patterns
  if (/\b\d{1,5}\s*(bce|bc|ce|ad|b\.c\.e?\.?|a\.d\.?)\b/i.test(lower)) return true;
  return false;
}

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (entityType: string, id: string, linkPath: string) => void;
}

export default function GlobalSearchDialog({
  open,
  onOpenChange,
  onNavigate,
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [spatialResults, setSpatialResults] = useState<SpatialResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState<"keyword" | "natural">("keyword");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const saveRecentSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const updated = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(
        0,
        MAX_RECENT
      );
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Fetch autocomplete suggestions
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    if (suggestionsRef.current) clearTimeout(suggestionsRef.current);
    suggestionsRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/suggestions?q=${encodeURIComponent(trimmed)}`
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } catch {
        // ignore
      }
    }, 150);

    return () => {
      if (suggestionsRef.current) clearTimeout(suggestionsRef.current);
    };
  }, [query]);

  // Debounced search - auto-detect natural language vs keyword
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSpatialResults([]);
      setSearchMode("keyword");
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const isNL = isNaturalLanguageQuery(trimmed);
    setSearchMode(isNL ? "natural" : "keyword");

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        if (isNL) {
          // Natural language search
          const res = await fetch(
            `/api/search/natural?q=${encodeURIComponent(trimmed)}`
          );
          if (res.ok) {
            const data: SpatialSearchResponse = await res.json();
            setSpatialResults(data.results);
            setResults([]);
          }
        } else {
          // Standard keyword search
          const res = await fetch(
            `/api/search?q=${encodeURIComponent(trimmed)}`
          );
          if (res.ok) {
            const data: SearchResponse = await res.json();
            setResults(data.results);
            setSpatialResults([]);
          }
        }
      } catch {
        // ignore network errors
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSpatialResults([]);
      setSuggestions([]);
      setSearchMode("keyword");
    }
  }, [open]);

  const handleSelect = (result: SearchResult) => {
    saveRecentSearch(query);
    onNavigate(result.entityType, result.id, result.linkPath);
    onOpenChange(false);
  };

  const handleSpatialSelect = (result: SpatialResult) => {
    saveRecentSearch(query);
    onNavigate(result.entityType, result.id, `/${result.entityType}s/${result.id}`);
    onOpenChange(false);
  };

  const handleRecentSelect = (recent: string) => {
    setQuery(recent);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setQuery(suggestion);
  };

  // Group keyword results by entityType
  const grouped = results.reduce<Record<string, SearchResult[]>>(
    (acc, result) => {
      if (!acc[result.entityType]) acc[result.entityType] = [];
      acc[result.entityType].push(result);
      return acc;
    },
    {}
  );

  // Group spatial results by entityType
  const spatialGrouped = spatialResults.reduce<Record<string, SpatialResult[]>>(
    (acc, result) => {
      if (!acc[result.entityType]) acc[result.entityType] = [];
      acc[result.entityType].push(result);
      return acc;
    },
    {}
  );

  const hasResults = results.length > 0 || spatialResults.length > 0;
  const trimmedQuery = query.trim();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder='Search or ask: "What languages were spoken in Mesopotamia?"'
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {searchMode === "natural" ? "Searching spatially..." : "Searching..."}
          </div>
        )}

        {/* Search mode indicator */}
        {!loading && trimmedQuery && searchMode === "natural" && (
          <div className="px-3 py-1.5 flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border-b">
            <MapPin className="h-3 w-3" />
            Natural language search active
          </div>
        )}

        {/* Autocomplete suggestions */}
        {!loading && trimmedQuery && suggestions.length > 0 && !hasResults && (
          <CommandGroup heading="Suggestions">
            {suggestions.map((suggestion) => (
              <CommandItem
                key={suggestion}
                value={`suggestion-${suggestion}`}
                onSelect={() => handleSuggestionSelect(suggestion)}
              >
                <Sparkles className="h-4 w-4 text-blue-400" />
                <span>{suggestion}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Recent searches */}
        {!loading && !trimmedQuery && recentSearches.length > 0 && (
          <CommandGroup heading="Recent Searches">
            {recentSearches.map((recent) => (
              <CommandItem
                key={recent}
                value={`recent-${recent}`}
                onSelect={() => handleRecentSelect(recent)}
              >
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{recent}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Example queries when empty */}
        {!loading && !trimmedQuery && recentSearches.length === 0 && (
          <CommandGroup heading="Try asking">
            {[
              "What languages were spoken in Mesopotamia?",
              "Civilizations in Egypt in 3000 BCE",
              "Battles near Rome",
              "Religions in the Middle East",
            ].map((example) => (
              <CommandItem
                key={example}
                value={`example-${example}`}
                onSelect={() => setQuery(example)}
              >
                <Sparkles className="h-4 w-4 text-blue-400" />
                <span className="text-muted-foreground">{example}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* No results */}
        {!loading && trimmedQuery && !hasResults && suggestions.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}

        {/* Keyword search results */}
        {!loading &&
          Object.entries(grouped).map(([entityType, items], idx) => (
            <div key={entityType}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup
                heading={ENTITY_LABELS[entityType] || entityType}
              >
                {items.map((result) => (
                  <CommandItem
                    key={`${result.entityType}-${result.id}`}
                    value={`${result.entityType}-${result.id}-${result.displayName}`}
                    onSelect={() => handleSelect(result)}
                  >
                    {result.source === "graph" ? (
                      <Share2 className="h-4 w-4 text-purple-500" />
                    ) : (
                      ENTITY_ICONS[result.entityType] || (
                        <Search className="h-4 w-4" />
                      )
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-medium flex items-center gap-1.5">
                        <span className="truncate">{result.displayName}</span>
                        <SourceBadge result={result} />
                      </span>
                      {result.description && (
                        <span className="text-xs text-muted-foreground">
                          {result.description}
                        </span>
                      )}
                      {result.source === "graph" && (
                        <span className="text-xs text-muted-foreground flex items-center gap-2">
                          {result.provenance?.source && (
                            <span>{result.provenance.source}</span>
                          )}
                          {result.provenance?.qid && (
                            <span className="font-mono">{result.provenance.qid}</span>
                          )}
                          {typeof result.confidence === "number" &&
                            result.confidence < 1 && (
                              <span>
                                {Math.round(result.confidence * 100)}% match
                              </span>
                            )}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}

        {/* Natural language / spatial search results */}
        {!loading &&
          Object.entries(spatialGrouped).map(([entityType, items], idx) => (
            <div key={entityType}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup
                heading={ENTITY_LABELS[entityType] || entityType}
              >
                {items.map((result) => (
                  <CommandItem
                    key={`spatial-${result.entityType}-${result.id}`}
                    value={`spatial-${result.entityType}-${result.id}-${result.displayName}`}
                    onSelect={() => handleSpatialSelect(result)}
                  >
                    {ENTITY_ICONS[result.entityType] || (
                      <Search className="h-4 w-4" />
                    )}
                    <div className="flex flex-col flex-1">
                      <span className="font-medium">{result.displayName}</span>
                      {result.description && (
                        <span className="text-xs text-muted-foreground">
                          {result.description}
                        </span>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {result.distanceKm !== null && (
                          <span className="text-xs text-muted-foreground">
                            {result.distanceKm < 1 ? '<1' : Math.round(result.distanceKm)} km away
                          </span>
                        )}
                        {result.timePeriod && (
                          <span className="text-xs text-muted-foreground">
                            {result.timePeriod}
                          </span>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
      </CommandList>
    </CommandDialog>
  );
}
