import { useState, useCallback, useMemo } from 'react';
import type { BaseMapId, BaseMapTile } from '../../../lib/visualization/geospatial-types';
import { BASE_MAP_TILES, DEFAULT_BASE_MAP_ID } from '../../../lib/visualization/geospatial-types';

function getInitialBaseMapId(): BaseMapId {
  const params = new URLSearchParams(window.location.search);
  const baseMap = params.get('basemap') as BaseMapId | null;
  if (baseMap && BASE_MAP_TILES.some((t) => t.id === baseMap)) {
    return baseMap;
  }
  return DEFAULT_BASE_MAP_ID;
}

function syncBaseMapToURL(baseMapId: BaseMapId) {
  const params = new URLSearchParams(window.location.search);
  if (baseMapId === DEFAULT_BASE_MAP_ID) {
    params.delete('basemap');
  } else {
    params.set('basemap', baseMapId);
  }
  const qs = params.toString();
  const newURL = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', newURL);
}

export interface UseBaseMapReturn {
  baseMapId: BaseMapId;
  baseMap: BaseMapTile;
  setBaseMap: (id: BaseMapId) => void;
  availableMaps: BaseMapTile[];
}

export function useBaseMap(): UseBaseMapReturn {
  const [baseMapId, setBaseMapId] = useState<BaseMapId>(getInitialBaseMapId);

  const setBaseMap = useCallback((id: BaseMapId) => {
    setBaseMapId(id);
    syncBaseMapToURL(id);
  }, []);

  const baseMap = useMemo(
    () => BASE_MAP_TILES.find((t) => t.id === baseMapId) ?? BASE_MAP_TILES[0],
    [baseMapId]
  );

  return {
    baseMapId,
    baseMap,
    setBaseMap,
    availableMaps: BASE_MAP_TILES,
  };
}
