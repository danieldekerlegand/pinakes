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
} from "lucide-react";

interface SearchResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  linkPath: string;
  relevance: number;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
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
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (res.ok) {
          const data: SearchResponse = await res.json();
          setResults(data.results);
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
    }
  }, [open]);

  const handleSelect = (result: SearchResult) => {
    saveRecentSearch(query);
    onNavigate(result.entityType, result.id, result.linkPath);
    onOpenChange(false);
  };

  const handleRecentSelect = (recent: string) => {
    setQuery(recent);
  };

  // Group results by entityType
  const grouped = results.reduce<Record<string, SearchResult[]>>(
    (acc, result) => {
      if (!acc[result.entityType]) acc[result.entityType] = [];
      acc[result.entityType].push(result);
      return acc;
    },
    {}
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search languages, civilizations, battles..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Searching...
          </div>
        )}

        {!loading && !query.trim() && recentSearches.length > 0 && (
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

        {!loading && query.trim() && results.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}

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
                    {ENTITY_ICONS[result.entityType] || (
                      <Search className="h-4 w-4" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-medium">{result.displayName}</span>
                      {result.description && (
                        <span className="text-xs text-muted-foreground">
                          {result.description}
                        </span>
                      )}
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
