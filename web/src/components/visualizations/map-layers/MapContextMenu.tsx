import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useMapEvents } from 'react-leaflet';
import { Search, MapPin, Loader2, X, Globe, Landmark, Swords, Church, Music, UtensilsCrossed, Palette, Package, Pickaxe } from 'lucide-react';

interface SpatialSearchResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  distanceKm: number | null;
  coordinates: { lat: number; lng: number } | null;
  timePeriod: string | null;
}

interface SpatialSearchResponse {
  results: SpatialSearchResult[];
  query: { raw: string };
  totalCount: number;
}

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  language: <Globe className="h-3.5 w-3.5 text-blue-500" />,
  civilization: <Landmark className="h-3.5 w-3.5 text-stone-500" />,
  battle: <Swords className="h-3.5 w-3.5 text-red-500" />,
  religion: <Church className="h-3.5 w-3.5 text-amber-500" />,
  "music-tradition": <Music className="h-3.5 w-3.5 text-pink-500" />,
  cuisine: <UtensilsCrossed className="h-3.5 w-3.5 text-yellow-600" />,
  "art-tradition": <Palette className="h-3.5 w-3.5 text-fuchsia-500" />,
  "trade-good": <Package className="h-3.5 w-3.5 text-emerald-500" />,
  "archaeological-site": <Pickaxe className="h-3.5 w-3.5 text-stone-400" />,
};

interface MapContextMenuProps {
  currentYear: number;
  onFeatureSelect?: (id: string) => void;
}

export function MapContextMenu({ currentYear, onFeatureSelect }: MapContextMenuProps) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [clickLatLng, setClickLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [results, setResults] = useState<SpatialSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useMapEvents({
    contextmenu(e) {
      e.originalEvent.preventDefault();
      const containerPoint = e.containerPoint;
      setMenuPosition({ x: containerPoint.x, y: containerPoint.y });
      setClickLatLng({ lat: e.latlng.lat, lng: e.latlng.lng });
      setShowResults(false);
      setResults([]);
    },
    click() {
      setMenuPosition(null);
      if (!showResults) {
        setClickLatLng(null);
      }
    },
  });

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        resultsRef.current && !resultsRef.current.contains(e.target as Node)
      ) {
        setMenuPosition(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleWhatWasHere = useCallback(async () => {
    if (!clickLatLng) return;
    setMenuPosition(null);
    setLoading(true);
    setShowResults(true);

    try {
      const params = new URLSearchParams({
        lat: clickLatLng.lat.toFixed(4),
        lng: clickLatLng.lng.toFixed(4),
        radius: '300',
      });
      if (currentYear) {
        params.set('year', String(currentYear));
      }
      const res = await fetch(`/api/search/spatial?${params}`);
      if (res.ok) {
        const data: SpatialSearchResponse = await res.json();
        setResults(data.results);
      }
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, [clickLatLng, currentYear]);

  const handleCloseResults = useCallback(() => {
    setShowResults(false);
    setResults([]);
    setClickLatLng(null);
  }, []);

  const handleResultClick = useCallback((result: SpatialSearchResult) => {
    if (onFeatureSelect) {
      onFeatureSelect(result.id);
    }
  }, [onFeatureSelect]);

  return (
    <>
      {/* Right-click context menu */}
      {menuPosition && (
        <div
          ref={menuRef}
          className="absolute z-[2000] bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[200px]"
          style={{ left: menuPosition.x, top: menuPosition.y }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 text-left"
            onClick={handleWhatWasHere}
          >
            <Search className="h-4 w-4 text-blue-600" />
            <span>What was here?</span>
          </button>
          {clickLatLng && (
            <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {clickLatLng.lat.toFixed(2)}, {clickLatLng.lng.toFixed(2)}
            </div>
          )}
        </div>
      )}

      {/* Results panel */}
      {showResults && (
        <div
          ref={resultsRef}
          className="absolute bottom-24 right-4 z-[1500] bg-white rounded-lg shadow-lg border border-gray-200 w-80 max-h-96 overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium">
                What was here?
              </span>
            </div>
            <button onClick={handleCloseResults} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {clickLatLng && (
            <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
              {clickLatLng.lat.toFixed(4)}, {clickLatLng.lng.toFixed(4)}
              {currentYear ? ` · ${currentYear < 0 ? `${Math.abs(currentYear)} BCE` : `${currentYear} CE`}` : ''}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                <span className="ml-2 text-sm text-gray-500">Searching...</span>
              </div>
            )}

            {!loading && results.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-500">
                No results found nearby.
              </div>
            )}

            {!loading && results.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {results.map((result) => (
                  <li key={`${result.entityType}-${result.id}`}>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-start gap-2"
                      onClick={() => handleResultClick(result)}
                    >
                      <span className="mt-0.5">
                        {ENTITY_ICONS[result.entityType] || <Search className="h-3.5 w-3.5 text-gray-400" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {result.displayName}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {result.description}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {result.distanceKm !== null && (
                            <span className="text-xs text-gray-400">
                              {result.distanceKm < 1 ? '<1' : Math.round(result.distanceKm)} km
                            </span>
                          )}
                          {result.timePeriod && (
                            <span className="text-xs text-gray-400">
                              {result.timePeriod}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 capitalize whitespace-nowrap">
                        {result.entityType.replace('-', ' ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!loading && results.length > 0 && (
            <div className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100 text-center">
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </div>
          )}
        </div>
      )}
    </>
  );
}
