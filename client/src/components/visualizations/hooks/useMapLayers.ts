import { useState, useCallback, useMemo } from 'react';
import type { LayerConfig, LayerState, LayerType } from '../../../lib/visualization/geospatial-types';
import { DEFAULT_LAYER_CONFIGS } from '../../../lib/visualization/geospatial-types';

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
  visibleLayerIds: string[];
  visibleLayerCount: number;
}

/**
 * Custom hook for managing map layer state
 */
export function useMapLayers(): UseMapLayersReturn {
  // Initialize layer configs from defaults
  const [layerConfigs, setLayerConfigs] = useState<Map<string, LayerConfig>>(() => {
    const map = new Map<string, LayerConfig>();
    DEFAULT_LAYER_CONFIGS.forEach((config) => {
      map.set(config.id, { ...config });
    });
    return map;
  });

  // Track which layers are active (visible)
  const [activeLayers, setActiveLayers] = useState<Set<string>>(() => {
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

    // Update layer config
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

    // Update active layers if visibility changed
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
    visibleLayerIds,
    visibleLayerCount,
  };
}
