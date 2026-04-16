import React, { useRef, useEffect, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import { Search, X, MapPin, Landmark, Swords, Globe, Loader2 } from 'lucide-react';
import { useMapSearch } from '../hooks/useMapSearch';
import type { PlaceResult, PlaceCategory } from '../hooks/useMapSearch';

const CATEGORY_CONFIG: Record<PlaceCategory, { icon: typeof MapPin; label: string; color: string }> = {
  settlement: { icon: MapPin, label: 'Settlement', color: 'text-amber-600' },
  'archaeological-site': { icon: Landmark, label: 'Site', color: 'text-orange-600' },
  battle: { icon: Swords, label: 'Battle', color: 'text-red-600' },
  region: { icon: Globe, label: 'Region', color: 'text-blue-600' },
  modern: { icon: MapPin, label: 'Place', color: 'text-green-600' },
};

function PlaceInfoCard({ place, onClose }: { place: PlaceResult; onClose: () => void }) {
  const cfg = CATEGORY_CONFIG[place.category];
  const Icon = cfg.icon;

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1002] bg-white rounded-lg shadow-lg border border-gray-200 p-3 max-w-xs w-72">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 flex-shrink-0 ${cfg.color}`} />
          <div className="min-w-0">
            <h4 className="font-semibold text-sm text-gray-900 truncate">{place.name}</h4>
            <span className="text-xs text-gray-500">{cfg.label}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {place.description && (
        <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{place.description}</p>
      )}
      {place.timePeriod && (
        <p className="text-xs text-gray-500 mt-1">{place.timePeriod}</p>
      )}
      <p className="text-[10px] text-gray-400 mt-1">
        {place.lat.toFixed(3)}, {place.lng.toFixed(3)}
      </p>
    </div>
  );
}

/** Inner component that uses useMap() — must be inside MapContainer */
function MapSearchBarInner() {
  const map = useMap();
  const {
    query,
    setQuery,
    suggestions,
    isLoading,
    selectedPlace,
    selectPlace,
    clearSelection,
    isOpen,
    setIsOpen,
  } = useMapSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fly to selected place
  useEffect(() => {
    if (!selectedPlace || !map) return;

    if (selectedPlace.bbox) {
      const [south, west, north, east] = selectedPlace.bbox;
      map.flyToBounds(
        [[south, west], [north, east]],
        { duration: 1.5, padding: [30, 30] },
      );
    } else {
      const zoom = selectedPlace.category === 'region' ? 5 : 10;
      map.flyTo([selectedPlace.lat, selectedPlace.lng], zoom, { duration: 1.5 });
    }
  }, [selectedPlace, map]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsOpen]);

  // Prevent map zoom/pan when interacting with search
  const stopPropagation = useCallback((e: React.MouseEvent | React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }, [setIsOpen]);

  const handleSelect = useCallback((place: PlaceResult) => {
    selectPlace(place);
  }, [selectPlace]);

  return (
    <div
      ref={containerRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-[1001] w-80"
      onMouseDown={stopPropagation}
      onDoubleClick={stopPropagation}
      onWheel={stopPropagation}
    >
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (query.trim().length >= 2) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search places..."
          className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-300 rounded-lg shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
        />
        {(query || selectedPlace) && (
          <button
            onClick={clearSelection}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {isLoading && (
          <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 animate-spin" />
        )}
      </div>

      {/* Autocomplete dropdown */}
      {isOpen && suggestions.length > 0 && (
        <ul className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((place) => {
            const cfg = CATEGORY_CONFIG[place.category];
            const Icon = cfg.icon;
            return (
              <li key={place.id}>
                <button
                  className="w-full px-3 py-2 flex items-start gap-2.5 hover:bg-blue-50 text-left transition-colors"
                  onClick={() => handleSelect(place)}
                >
                  <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{place.name}</div>
                    <div className="text-xs text-gray-500 truncate">{place.description}</div>
                  </div>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">{cfg.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* No results */}
      {isOpen && !isLoading && query.trim().length >= 2 && suggestions.length === 0 && (
        <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-500">
          No places found for &ldquo;{query}&rdquo;
        </div>
      )}

      {/* Info card for selected place */}
      {selectedPlace && (
        <PlaceInfoCard place={selectedPlace} onClose={clearSelection} />
      )}
    </div>
  );
}

export function MapSearchBar() {
  return <MapSearchBarInner />;
}
