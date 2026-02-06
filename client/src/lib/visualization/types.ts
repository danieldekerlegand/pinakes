import type { LanguageFamilyWithChildren, LanguageWithVariants, Language } from "../../../../shared/types";

// Common filter types
export interface VisualizationFilters {
  searchQuery: string;
  status: string[];
  region: string;
  dataSource: string[];
  timeRange: [number | null, number | null];
  speakerRange: [number | null, number | null];
}

// View mode type
export type ViewMode = 'tree' | 'network' | 'timeline' | 'map' | 'explorer' | 'contribute';

// Tree visualization types
export interface TreeNode {
  id: string;
  name: string;
  type: 'family' | 'language';
  level: number;
  familyId?: string;
  data: LanguageFamilyWithChildren | LanguageWithVariants;
  children?: TreeNode[];
  parent?: TreeNode;
  // D3 hierarchy properties (added by d3.hierarchy)
  x?: number;
  y?: number;
  depth?: number;
  height?: number;
}

// Network visualization types
export interface NetworkNode {
  id: string;
  name: string;
  type: 'family' | 'language';
  group: string; // family ID for coloring
  level: number;
  size: number; // based on speaker count
  totalSpeakers?: number;
  region?: string;
  status?: string;
  // D3 force simulation properties
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface NetworkLink {
  source: string | NetworkNode;
  target: string | NetworkNode;
  type: 'family-child' | 'language-family' | 'language-parent';
  strength: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

// Timeline visualization types
export interface TimelineEvent {
  id: string;
  name: string;
  nativeName?: string;
  type: 'family' | 'language';
  familyId: string;
  familyName: string;
  groupName: string; // For y-axis grouping
  startYear: number;
  endYear: number | null;
  region?: string;
  status: string;
  totalSpeakers?: number;
  historicalContext?: string;
  isEstimate: boolean; // If time data was estimated
}

// Map visualization types
export interface MapPoint {
  id: string;
  name: string;
  nativeName?: string;
  type: 'language';
  familyId: string;
  familyName: string;
  lat: number;
  lng: number;
  region?: string;
  countries?: string[];
  status: string;
  totalSpeakers?: number;
  nativeSpeakers?: number;
  writingSystem?: string;
  iso639_1?: string;
  iso639_2?: string;
  // Temporal data
  timeOrigin?: string | null;
  timeEnd?: string | null;
}

// Temporal navigation state
export interface TemporalState {
  currentYear: number;
  isPlaying: boolean;
  playbackSpeed: number; // years per second
  stepSize: number;
  minYear: number;
  maxYear: number;
  temporalFilterEnabled: boolean;
}

// Tooltip data type (shared across visualizations)
export interface TooltipData {
  id: string;
  name: string;
  nativeName?: string;
  type: 'family' | 'language';
  familyName?: string;
  region?: string;
  status?: string;
  totalSpeakers?: number;
  nativeSpeakers?: number;
  languageCount?: number;
  timeOrigin?: string;
  timeEnd?: string;
  coordinates?: { lat: number; lng: number };
  [key: string]: any;
}

// View-specific settings
export interface ViewSettings {
  tree: {
    expandAll: boolean;
    colorByLevel: boolean;
    orientation: 'horizontal' | 'vertical';
  };
  network: {
    linkDistance: number;
    chargeStrength: number;
    showLabels: boolean;
  };
  timeline: {
    scale: 'linear' | 'log';
    groupBy: 'family' | 'region';
    showExtinct: boolean;
  };
  map: {
    clusterRadius: number;
    showHeatmap: boolean;
    markerSize: 'fixed' | 'byPopulation';
  };
  explorer: Record<string, never>;
  contribute: Record<string, never>;
}

// Visualization state
export interface VisualizationState {
  currentView: ViewMode;
  selectedLanguageIds: Set<string>;
  selectedFamilyIds: Set<string>;
  highlightedNodeId: string | null;
  filters: VisualizationFilters;
  viewSettings: ViewSettings;
  temporal: TemporalState;
}

// Actions for state management
export type VisualizationAction =
  | { type: 'SET_VIEW'; payload: ViewMode }
  | { type: 'SELECT_LANGUAGE'; payload: string }
  | { type: 'DESELECT_LANGUAGE'; payload: string }
  | { type: 'TOGGLE_LANGUAGE'; payload: string }
  | { type: 'SELECT_FAMILY'; payload: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_HIGHLIGHT'; payload: string | null }
  | { type: 'UPDATE_FILTERS'; payload: Partial<VisualizationFilters> }
  | { type: 'UPDATE_VIEW_SETTINGS'; payload: { view: ViewMode; settings: Partial<ViewSettings[ViewMode]> } }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_CURRENT_YEAR'; payload: number }
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_PLAYBACK_SPEED'; payload: number }
  | { type: 'SET_STEP_SIZE'; payload: number }
  | { type: 'TOGGLE_TEMPORAL_FILTER'; payload?: boolean }
  | { type: 'UPDATE_TEMPORAL'; payload: Partial<TemporalState> };
