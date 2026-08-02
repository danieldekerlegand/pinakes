import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { LayerConfig, LayerState } from '../../../lib/visualization/geospatial-types';
import { DEFAULT_LAYER_CONFIGS, LAYER_PRESETS } from '../../../lib/visualization/geospatial-types';
import type { LayerPreset } from '../../../lib/visualization/geospatial-types';

// Parse layer state from URL search params
function parseLayerStateFromURL(): { layers?: string[]; opacities?: Record<string, number> } | null {
  const params = new URLSearchParams(window.location.search);
  const layersParam = params.get('layers');
  const opacitiesParam = params.get('opacities');

  if (!layersParam) return null;

  const layers = layersParam.split(',').filter(Boolean);
  let opacities: Record<string, number> | undefined;

  if (opacitiesParam) {
    opacities = {};
    opacitiesParam.split(',').forEach((pair) => {
      const [id, val] = pair.split(':');
      if (id && val) {
        opacities![id] = parseFloat(val);
      }
    });
  }

  return { layers, opacities };
}

// Sync layer state to URL search params
function syncLayerStateToURL(activeLayers: Set<string>, layerConfigs: Map<string, LayerConfig>) {
  const params = new URLSearchParams(window.location.search);

  const visibleIds = Array.from(activeLayers).sort();
  if (visibleIds.length === 0) {
    params.set('layers', 'none');
  } else {
    params.set('layers', visibleIds.join(','));
  }

  // Only store non-default opacities
  const opacityPairs: string[] = [];
  layerConfigs.forEach((config) => {
    const defaultConfig = DEFAULT_LAYER_CONFIGS.find((d) => d.id === config.id);
    if (defaultConfig && config.opacity !== defaultConfig.opacity) {
      opacityPairs.push(`${config.id}:${config.opacity.toFixed(2)}`);
    }
  });

  if (opacityPairs.length > 0) {
    params.set('opacities', opacityPairs.join(','));
  } else {
    params.delete('opacities');
  }

  const newURL = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, '', newURL);
}

interface UseMapLayersReturn {
  state: LayerState;
  isLayerVisible: (layerId: string) => boolean;
  toggleLayer: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  getLayerConfig: (layerId: string) => LayerConfig | undefined;
  updateLayerConfig: (layerId: string, config: Partial<LayerConfig>) => void;
  showAll: () => void;
  hideAll: () => void;
  showCategory: (category: string) => void;
  hideCategory: (category: string) => void;
  resetLayers: () => void;
  applyPreset: (presetId: string) => void;
  activePresetId: string | null;
  visibleLayerIds: string[];
  visibleLayerCount: number;
}

/**
 * Custom hook for managing map layer state with URL persistence
 */
export function useMapLayers(): UseMapLayersReturn {
  const isInitializedRef = useRef(false);

  // Initialize layer configs from URL params or defaults
  const [layerConfigs, setLayerConfigs] = useState<Map<string, LayerConfig>>(() => {
    const map = new Map<string, LayerConfig>();
    const urlState = parseLayerStateFromURL();

    DEFAULT_LAYER_CONFIGS.forEach((config) => {
      const layerConfig = { ...config };

      if (urlState) {
        layerConfig.visible = urlState.layers?.includes(config.id) ?? false;
        if (urlState.opacities?.[config.id] !== undefined) {
          layerConfig.opacity = urlState.opacities[config.id];
        }
      }

      map.set(config.id, layerConfig);
    });
    return map;
  });

  // Track which layers are active (visible)
  const [activeLayers, setActiveLayers] = useState<Set<string>>(() => {
    const urlState = parseLayerStateFromURL();

    if (urlState && urlState.layers) {
      if (urlState.layers.length === 1 && urlState.layers[0] === 'none') {
        return new Set<string>();
      }
      // Only include valid layer IDs
      const validIds = new Set(DEFAULT_LAYER_CONFIGS.map((c) => c.id));
      return new Set(urlState.layers.filter((id) => validIds.has(id)));
    }

    const active = new Set<string>();
    DEFAULT_LAYER_CONFIGS.forEach((config) => {
      if (config.visible) {
        active.add(config.id);
      }
    });
    return active;
  });

  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);

  // Sync to URL on state changes (skip initial render)
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }
    syncLayerStateToURL(activeLayers, layerConfigs);
  }, [activeLayers, layerConfigs]);

  // Check if a layer is visible
  const isLayerVisible = useCallback(
    (layerId: string): boolean => {
      return activeLayers.has(layerId);
    },
    [activeLayers]
  );

  // Toggle layer visibility
  const toggleLayer = useCallback((layerId: string) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });

    setLayerConfigs((prev) => {
      const next = new Map(prev);
      const config = next.get(layerId);
      if (config) {
        next.set(layerId, { ...config, visible: !config.visible });
      }
      return next;
    });
  }, []);

  // Set layer opacity
  const setLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setLayerConfigs((prev) => {
      const next = new Map(prev);
      const config = next.get(layerId);
      if (config) {
        next.set(layerId, { ...config, opacity: Math.max(0, Math.min(1, opacity)) });
      }
      return next;
    });
  }, []);

  // Set layer visibility explicitly
  const setLayerVisibility = useCallback((layerId: string, visible: boolean) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (visible) {
        next.add(layerId);
      } else {
        next.delete(layerId);
      }
      return next;
    });

    setLayerConfigs((prev) => {
      const next = new Map(prev);
      const config = next.get(layerId);
      if (config) {
        next.set(layerId, { ...config, visible });
      }
      return next;
    });
  }, []);

  // Get layer configuration
  const getLayerConfig = useCallback(
    (layerId: string): LayerConfig | undefined => {
      return layerConfigs.get(layerId);
    },
    [layerConfigs]
  );

  // Update layer configuration
  const updateLayerConfig = useCallback((layerId: string, config: Partial<LayerConfig>) => {
    setLayerConfigs((prev) => {
      const next = new Map(prev);
      const existing = next.get(layerId);
      if (existing) {
        next.set(layerId, { ...existing, ...config });
      }
      return next;
    });

    if (config.visible !== undefined) {
      setActiveLayers((prev) => {
        const next = new Set(prev);
        if (config.visible) {
          next.add(layerId);
        } else {
          next.delete(layerId);
        }
        return next;
      });
    }
  }, []);

  // Show all layers
  const showAll = useCallback(() => {
    const allLayerIds = Array.from(layerConfigs.keys());
    setActiveLayers(new Set(allLayerIds));

    setLayerConfigs((prev) => {
      const next = new Map(prev);
      next.forEach((config, id) => {
        next.set(id, { ...config, visible: true });
      });
      return next;
    });
  }, [layerConfigs]);

  // Hide all layers
  const hideAll = useCallback(() => {
    setActiveLayers(new Set());

    setLayerConfigs((prev) => {
      const next = new Map(prev);
      next.forEach((config, id) => {
        next.set(id, { ...config, visible: false });
      });
      return next;
    });
  }, []);

  // Show all layers in a category
  const showCategory = useCallback(
    (category: string) => {
      setLayerConfigs((prev) => {
        const next = new Map(prev);
        const updates = new Set<string>();

        next.forEach((config, id) => {
          if (config.category === category) {
            next.set(id, { ...config, visible: true });
            updates.add(id);
          }
        });

        setActiveLayers((prevActive) => {
          const nextActive = new Set(prevActive);
          updates.forEach((id) => nextActive.add(id));
          return nextActive;
        });

        return next;
      });
    },
    []
  );

  // Hide all layers in a category
  const hideCategory = useCallback(
    (category: string) => {
      setLayerConfigs((prev) => {
        const next = new Map(prev);
        const updates = new Set<string>();

        next.forEach((config, id) => {
          if (config.category === category) {
            next.set(id, { ...config, visible: false });
            updates.add(id);
          }
        });

        setActiveLayers((prevActive) => {
          const nextActive = new Set(prevActive);
          updates.forEach((id) => nextActive.delete(id));
          return nextActive;
        });

        return next;
      });
    },
    []
  );

  // Reset to default layer configuration
  const resetLayers = useCallback(() => {
    const map = new Map<string, LayerConfig>();
    const active = new Set<string>();

    DEFAULT_LAYER_CONFIGS.forEach((config) => {
      map.set(config.id, { ...config });
      if (config.visible) {
        active.add(config.id);
      }
    });

    setLayerConfigs(map);
    setActiveLayers(active);
  }, []);

  // Apply a preset layer combination
  const applyPreset = useCallback((presetId: string) => {
    const preset = LAYER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    // "All Layers" preset has empty layers array
    if (preset.layers.length === 0) {
      const allIds = new Set(DEFAULT_LAYER_CONFIGS.map((c) => c.id));
      setActiveLayers(allIds);
      setLayerConfigs((prev) => {
        const next = new Map(prev);
        next.forEach((config, id) => {
          next.set(id, { ...config, visible: true });
        });
        return next;
      });
      return;
    }

    const presetLayers = new Set(preset.layers);
    setActiveLayers(presetLayers);
    setLayerConfigs((prev) => {
      const next = new Map(prev);
      next.forEach((config, id) => {
        next.set(id, { ...config, visible: presetLayers.has(id) });
      });
      return next;
    });
  }, []);

  // Detect active preset
  const activePresetId = useMemo(() => {
    const visibleSet = activeLayers;
    for (const preset of LAYER_PRESETS) {
      if (preset.layers.length === 0) {
        // "All Layers" — check if all are visible
        if (visibleSet.size === layerConfigs.size) return preset.id;
        continue;
      }
      const presetSet = new Set(preset.layers);
      if (visibleSet.size === presetSet.size && Array.from(visibleSet).every((id) => presetSet.has(id))) {
        return preset.id;
      }
    }
    return null;
  }, [activeLayers, layerConfigs]);

  // Memoized derived values
  const visibleLayerIds = useMemo(() => Array.from(activeLayers), [activeLayers]);
  const visibleLayerCount = activeLayers.size;

  // Build complete state object
  const state: LayerState = useMemo(
    () => ({
      activeLayers,
      layerConfigs,
      timeSlider: {
        currentYear: 2024,
        minYear: -3000,
        maxYear: 2024,
        isPlaying: false,
        playbackSpeed: 50,
        stepSize: 50,
      },
      selectedFeatureId,
      hoveredFeatureId,
    }),
    [activeLayers, layerConfigs, selectedFeatureId, hoveredFeatureId]
  );

  return {
    state,
    isLayerVisible,
    toggleLayer,
    setLayerOpacity,
    setLayerVisibility,
    getLayerConfig,
    updateLayerConfig,
    showAll,
    hideAll,
    showCategory,
    hideCategory,
    resetLayers,
    applyPreset,
    activePresetId,
    visibleLayerIds,
    visibleLayerCount,
  };
}
