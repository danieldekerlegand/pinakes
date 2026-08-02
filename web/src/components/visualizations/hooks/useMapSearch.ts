import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

export type PlaceGeometryType = 'point' | 'bbox';
export type PlaceCategory = 'settlement' | 'archaeological-site' | 'battle' | 'region' | 'modern';

export interface PlaceResult {
  id: string;
  name: string;
  category: PlaceCategory;
  geometryType: PlaceGeometryType;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  description: string;
  timePeriod?: string;
  relevance: number;
}

export interface UseMapSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  suggestions: PlaceResult[];
  isLoading: boolean;
  selectedPlace: PlaceResult | null;
  selectPlace: (place: PlaceResult) => void;
  clearSelection: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

async function fetchAutocomplete(q: string): Promise<PlaceResult[]> {
  if (!q || q.trim().length < 2) return [];
  const res = await fetch(`/api/map/places/autocomplete?q=${encodeURIComponent(q)}&limit=8`);
  if (!res.ok) return [];
  return res.json();
}

export function useMapSearch(): UseMapSearchReturn {
  const [query, setQueryRaw] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setIsOpen(q.trim().length >= 2);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(q), 200);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const { data: suggestions = [], isLoading } = useQuery<PlaceResult[]>({
    queryKey: ['/api/map/places/autocomplete', debouncedQuery],
    queryFn: () => fetchAutocomplete(debouncedQuery),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 30_000,
  });

  const selectPlace = useCallback((place: PlaceResult) => {
    setSelectedPlace(place);
    setQueryRaw(place.name);
    setIsOpen(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPlace(null);
    setQueryRaw('');
    setDebouncedQuery('');
    setIsOpen(false);
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    isLoading,
    selectedPlace,
    selectPlace,
    clearSelection,
    isOpen,
    setIsOpen,
  };
}
