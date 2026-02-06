import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import type {
  VisualizationState,
  VisualizationAction,
  ViewMode,
  VisualizationFilters,
  TemporalState,
} from '../lib/visualization/types';

// Initial temporal state
const initialTemporalState: TemporalState = {
  currentYear: new Date().getFullYear(),
  isPlaying: false,
  playbackSpeed: 100, // years per second
  stepSize: 100,
  minYear: -10000,
  maxYear: new Date().getFullYear(),
  temporalFilterEnabled: false,
};

// Initial state
const initialState: VisualizationState = {
  currentView: 'tree',
  selectedLanguageIds: new Set(),
  selectedFamilyIds: new Set(),
  highlightedNodeId: null,
  filters: {
    searchQuery: '',
    status: [],
    region: '',
    dataSource: [],
    timeRange: [null, null],
    speakerRange: [null, null],
  },
  viewSettings: {
    tree: {
      expandAll: false,
      colorByLevel: true,
      orientation: 'horizontal',
    },
    network: {
      linkDistance: 100,
      chargeStrength: -300,
      showLabels: true,
    },
    timeline: {
      scale: 'linear',
      groupBy: 'family',
      showExtinct: true,
    },
    map: {
      clusterRadius: 50,
      showHeatmap: false,
      markerSize: 'byPopulation',
    },
    explorer: {},
    contribute: {},
  },
  temporal: initialTemporalState,
};

// Reducer
function visualizationReducer(
  state: VisualizationState,
  action: VisualizationAction
): VisualizationState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, currentView: action.payload };

    case 'SELECT_LANGUAGE': {
      const newSelectedLanguageIds = new Set(state.selectedLanguageIds);
      newSelectedLanguageIds.add(action.payload);
      return { ...state, selectedLanguageIds: newSelectedLanguageIds };
    }

    case 'DESELECT_LANGUAGE': {
      const newSelectedLanguageIds = new Set(state.selectedLanguageIds);
      newSelectedLanguageIds.delete(action.payload);
      return { ...state, selectedLanguageIds: newSelectedLanguageIds };
    }

    case 'TOGGLE_LANGUAGE': {
      const newSelectedLanguageIds = new Set(state.selectedLanguageIds);
      if (newSelectedLanguageIds.has(action.payload)) {
        newSelectedLanguageIds.delete(action.payload);
      } else {
        newSelectedLanguageIds.add(action.payload);
      }
      return { ...state, selectedLanguageIds: newSelectedLanguageIds };
    }

    case 'SELECT_FAMILY': {
      const newSelectedFamilyIds = new Set(state.selectedFamilyIds);
      newSelectedFamilyIds.add(action.payload);
      return { ...state, selectedFamilyIds: newSelectedFamilyIds };
    }

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedLanguageIds: new Set(),
        selectedFamilyIds: new Set(),
        highlightedNodeId: null,
      };

    case 'SET_HIGHLIGHT':
      return { ...state, highlightedNodeId: action.payload };

    case 'UPDATE_FILTERS':
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };

    case 'UPDATE_VIEW_SETTINGS':
      return {
        ...state,
        viewSettings: {
          ...state.viewSettings,
          [action.payload.view]: {
            ...state.viewSettings[action.payload.view],
            ...action.payload.settings,
          },
        },
      };

    case 'RESET_FILTERS':
      return {
        ...state,
        filters: initialState.filters,
      };

    case 'SET_CURRENT_YEAR':
      return {
        ...state,
        temporal: { ...state.temporal, currentYear: action.payload },
      };

    case 'SET_PLAYING':
      return {
        ...state,
        temporal: { ...state.temporal, isPlaying: action.payload },
      };

    case 'SET_PLAYBACK_SPEED':
      return {
        ...state,
        temporal: { ...state.temporal, playbackSpeed: action.payload },
      };

    case 'SET_STEP_SIZE':
      return {
        ...state,
        temporal: { ...state.temporal, stepSize: action.payload },
      };

    case 'TOGGLE_TEMPORAL_FILTER':
      return {
        ...state,
        temporal: {
          ...state.temporal,
          temporalFilterEnabled: action.payload ?? !state.temporal.temporalFilterEnabled,
        },
      };

    case 'UPDATE_TEMPORAL':
      return {
        ...state,
        temporal: { ...state.temporal, ...action.payload },
      };

    default:
      return state;
  }
}

// Context type
interface VisualizationContextType {
  state: VisualizationState;
  dispatch: React.Dispatch<VisualizationAction>;
  // Convenience methods
  setView: (view: ViewMode) => void;
  selectLanguage: (id: string) => void;
  deselectLanguage: (id: string) => void;
  toggleLanguage: (id: string) => void;
  selectFamily: (id: string) => void;
  clearSelection: () => void;
  setHighlight: (id: string | null) => void;
  updateFilters: (filters: Partial<VisualizationFilters>) => void;
  updateViewSettings: (view: ViewMode, settings: any) => void;
  resetFilters: () => void;
  isLanguageSelected: (id: string) => boolean;
  isFamilySelected: (id: string) => boolean;
  isHighlighted: (id: string) => boolean;
  // Temporal methods
  setCurrentYear: (year: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setStepSize: (step: number) => void;
  toggleTemporalFilter: (enabled?: boolean) => void;
  updateTemporal: (temporal: Partial<TemporalState>) => void;
}

// Create context
const VisualizationContext = createContext<VisualizationContextType | undefined>(undefined);

// Provider component
export function VisualizationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(visualizationReducer, initialState);

  // Convenience methods
  const setView = useCallback((view: ViewMode) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, []);

  const selectLanguage = useCallback((id: string) => {
    dispatch({ type: 'SELECT_LANGUAGE', payload: id });
  }, []);

  const deselectLanguage = useCallback((id: string) => {
    dispatch({ type: 'DESELECT_LANGUAGE', payload: id });
  }, []);

  const toggleLanguage = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_LANGUAGE', payload: id });
  }, []);

  const selectFamily = useCallback((id: string) => {
    dispatch({ type: 'SELECT_FAMILY', payload: id });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  const setHighlight = useCallback((id: string | null) => {
    dispatch({ type: 'SET_HIGHLIGHT', payload: id });
  }, []);

  const updateFilters = useCallback((filters: Partial<VisualizationFilters>) => {
    dispatch({ type: 'UPDATE_FILTERS', payload: filters });
  }, []);

  const updateViewSettings = useCallback((view: ViewMode, settings: any) => {
    dispatch({ type: 'UPDATE_VIEW_SETTINGS', payload: { view, settings } });
  }, []);

  const resetFilters = useCallback(() => {
    dispatch({ type: 'RESET_FILTERS' });
  }, []);

  // Temporal methods
  const setCurrentYear = useCallback((year: number) => {
    dispatch({ type: 'SET_CURRENT_YEAR', payload: year });
  }, []);

  const setIsPlaying = useCallback((playing: boolean) => {
    dispatch({ type: 'SET_PLAYING', payload: playing });
  }, []);

  const setPlaybackSpeed = useCallback((speed: number) => {
    dispatch({ type: 'SET_PLAYBACK_SPEED', payload: speed });
  }, []);

  const setStepSize = useCallback((step: number) => {
    dispatch({ type: 'SET_STEP_SIZE', payload: step });
  }, []);

  const toggleTemporalFilter = useCallback((enabled?: boolean) => {
    dispatch({ type: 'TOGGLE_TEMPORAL_FILTER', payload: enabled });
  }, []);

  const updateTemporal = useCallback((temporal: Partial<TemporalState>) => {
    dispatch({ type: 'UPDATE_TEMPORAL', payload: temporal });
  }, []);

  const isLanguageSelected = useCallback(
    (id: string) => state.selectedLanguageIds.has(id),
    [state.selectedLanguageIds]
  );

  const isFamilySelected = useCallback(
    (id: string) => state.selectedFamilyIds.has(id),
    [state.selectedFamilyIds]
  );

  const isHighlighted = useCallback(
    (id: string) => state.highlightedNodeId === id,
    [state.highlightedNodeId]
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      setView,
      selectLanguage,
      deselectLanguage,
      toggleLanguage,
      selectFamily,
      clearSelection,
      setHighlight,
      updateFilters,
      updateViewSettings,
      resetFilters,
      isLanguageSelected,
      isFamilySelected,
      isHighlighted,
      setCurrentYear,
      setIsPlaying,
      setPlaybackSpeed,
      setStepSize,
      toggleTemporalFilter,
      updateTemporal,
    }),
    [
      state,
      setView,
      selectLanguage,
      deselectLanguage,
      toggleLanguage,
      selectFamily,
      clearSelection,
      setHighlight,
      updateFilters,
      updateViewSettings,
      resetFilters,
      isLanguageSelected,
      isFamilySelected,
      isHighlighted,
      setCurrentYear,
      setIsPlaying,
      setPlaybackSpeed,
      setStepSize,
      toggleTemporalFilter,
      updateTemporal,
    ]
  );

  return (
    <VisualizationContext.Provider value={value}>
      {children}
    </VisualizationContext.Provider>
  );
}

// Custom hook to use the context
export function useVisualization() {
  const context = useContext(VisualizationContext);
  if (context === undefined) {
    throw new Error('useVisualization must be used within a VisualizationProvider');
  }
  return context;
}
