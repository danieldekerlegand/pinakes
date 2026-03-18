import type { Feature, Polygon, MultiPolygon, Point, LineString, GeoJsonProperties } from 'geojson';

// ============================================================================
// Time Period Types
// ============================================================================

export interface TimePeriod {
  start: number; // Year (negative for BCE)
  end: number | null; // null means "to present"
  label: string; // Human-readable label (e.g., "Classical Period", "500-200 BCE")
}

// ============================================================================
// Language Range Types
// ============================================================================

export type RangeType = 'current' | 'historical' | 'reconstructed';

export interface LanguageRangeProperties extends GeoJsonProperties {
  languageId: string;
  languageName: string;
  nativeName?: string;
  familyId: string;
  familyName: string;
  rangeType: RangeType;
  timePeriod: TimePeriod;
  confidence: number; // 1-100, for reconstructed ranges
  sources: string[]; // Array of source citations
  totalSpeakers?: number;
  region?: string;
  status?: string;
  iso639_1?: string;
  iso639_2?: string;
}

export type LanguageRangeFeature = Feature<Polygon | MultiPolygon, LanguageRangeProperties>;

// ============================================================================
// Archaeological Site Types
// ============================================================================

export type SiteType =
  | 'settlement'
  | 'burial'
  | 'temple'
  | 'fortification'
  | 'workshop'
  | 'ceremonial'
  | 'unknown';

export interface ArchaeologicalSiteProperties extends GeoJsonProperties {
  siteId: string;
  name: string;
  siteType: SiteType;
  timePeriod: TimePeriod;
  associatedLanguageIds: string[]; // Languages spoken at this site
  associatedCultureIds: string[]; // Material cultures found
  excavationStatus: 'unexcavated' | 'partial' | 'extensive' | 'complete';
  findings: string[]; // Brief descriptions of major findings
  importance: number; // 1-100, for marker sizing
  confidence: number; // 1-100, for attribution confidence
  sources: string[];
}

export type ArchaeologicalSiteFeature = Feature<Point, ArchaeologicalSiteProperties>;

// ============================================================================
// Civilization Types
// ============================================================================

export interface CivilizationProperties extends GeoJsonProperties {
  civilizationId: string;
  name: string;
  nativeName?: string;
  timePeriod: TimePeriod;
  associatedLanguageIds: string[]; // Languages spoken in this civilization
  writingSystems: string[]; // Writing systems used
  politicalStructure?: string; // Empire, city-state, etc.
  capital?: string;
  population?: number; // Estimated population at peak
  sources: string[];
}

export type CivilizationFeature = Feature<Polygon | MultiPolygon, CivilizationProperties>;

// ============================================================================
// Historical Route Types
// ============================================================================

export type RouteType =
  | 'trade'
  | 'migration'
  | 'conquest'
  | 'colonization'
  | 'diaspora'
  | 'pilgrimage'
  | 'communication'
  | 'unknown';

export interface HistoricalRouteProperties extends GeoJsonProperties {
  routeId: string;
  name: string;
  routeType: RouteType;
  timePeriod: TimePeriod;
  associatedLanguageIds: string[]; // Languages spread along this route
  linguisticImpact?: string; // Description of linguistic influence
  tradedGoods?: string[]; // For trade routes
  direction?: 'bidirectional' | 'unidirectional'; // Direction of primary flow
  sources: string[];
}

export type HistoricalRouteFeature = Feature<LineString, HistoricalRouteProperties>;

// ============================================================================
// Archaeological Culture Types
// ============================================================================

export type SubsistencePattern =
  | 'hunting-gathering'
  | 'hunting-gathering with early cultivation'
  | 'early agriculture'
  | 'agriculture'
  | 'agriculture and herding'
  | 'agriculture and fishing'
  | 'agriculture, trade'
  | 'pastoral nomadism'
  | 'mixed farming'
  | 'mixed farming and herding'
  | 'intensive agriculture'
  | 'irrigation agriculture'
  | 'intensive irrigation agriculture'
  | 'millet agriculture'
  | 'rice agriculture'
  | 'horticulture and fishing'
  | 'big-game hunting'
  | 'bison hunting'
  | 'hunting, fishing, gathering'
  | 'unknown';

export interface ArchaeologicalCultureProperties extends GeoJsonProperties {
  cultureId: string;
  name: string;
  region: string;
  timePeriod: TimePeriod;
  subsistencePattern: SubsistencePattern;
  potteryStyle: string;
  burialPractices: string;
  materialCultureTraits: string;
  probableLanguageFamily: string;
  probableHaplogroups: string[];
  predecessorCultureIds: string[];
  successorCultureIds: string[];
  confidence: number; // 1-100
  sources: string[];
  description: string;
}

export type ArchaeologicalCultureFeature = Feature<Polygon | MultiPolygon, ArchaeologicalCultureProperties>;

// ============================================================================
// Material Culture Types
// ============================================================================

export type CultureType =
  | 'pottery'
  | 'burial'
  | 'architecture'
  | 'tools'
  | 'art'
  | 'clothing'
  | 'weapons'
  | 'unknown';

export interface MaterialCultureProperties extends GeoJsonProperties {
  cultureId: string;
  name: string;
  cultureType: CultureType;
  timePeriod: TimePeriod;
  associatedLanguageIds: string[]; // Languages associated with this culture
  description?: string;
  sources: string[];
}

export type MaterialCultureFeature = Feature<Point | Polygon | MultiPolygon, MaterialCultureProperties>;

// ============================================================================
// Distribution Point for Heatmap
// ============================================================================

export interface MaterialCultureDistribution {
  lat: number;
  lng: number;
  intensity: number; // 0-1, for heatmap
  cultureId: string;
  timePeriod: TimePeriod;
}

// ============================================================================
// Layer Configuration Types
// ============================================================================

export type LayerType =
  | 'language-ranges'
  | 'archaeological-sites'
  | 'archaeological-cultures'
  | 'civilizations'
  | 'routes'
  | 'battles'
  | 'material-culture'
  | 'material-culture-heatmap'
  | 'cuisines'
  | 'music'
  | 'religions'
  | 'haplogroups'
  | 'language-contacts'
  | 'genetic-linguistic-correlation'
  | 'foodway-events'
  | 'kinship-systems'
  | 'dance'
  | 'architectural-styles'
  | 'ingredient-origins'
  | 'cooking-techniques';

export type LayerCategory =
  | 'languages'
  | 'archaeology'
  | 'civilizations'
  | 'routes'
  | 'culture'
  | 'cuisines'
  | 'music'
  | 'dance'
  | 'religions'
  | 'genetics';

export interface PolygonStyle {
  fillColor?: string;
  fillOpacity: number;
  strokeColor?: string;
  strokeWeight: number;
  strokeOpacity?: number;
}

export interface MarkerStyle {
  color?: string;
  size: number;
  opacity: number;
  strokeColor?: string;
  strokeWeight?: number;
}

export interface LineStyle {
  color?: string;
  weight: number;
  opacity: number;
  dashArray?: string;
}

export interface HeatmapStyle {
  radius: number;
  blur: number;
  maxZoom: number;
  gradient?: Record<number, string>;
}

export interface RenderStyle {
  polygon?: PolygonStyle;
  marker?: MarkerStyle;
  line?: LineStyle;
  heatmap?: HeatmapStyle;
}

export interface LayerConfig {
  id: string;
  type: LayerType;
  category: LayerCategory;
  name: string;
  visible: boolean;
  opacity: number; // 0-1
  zIndex: number;
  renderStyle: RenderStyle;
}

// ============================================================================
// Time Slider State
// ============================================================================

export interface TimeSliderState {
  currentYear: number; // Integer year (negative for BCE)
  minYear: number;
  maxYear: number;
  isPlaying: boolean;
  playbackSpeed: number; // Years per second (10, 50, 100, 200)
  stepSize: number; // Years per step for manual stepping (10, 50, 100)
}

// ============================================================================
// Overall Layer State
// ============================================================================

export interface LayerState {
  activeLayers: Set<string>; // Set of layer IDs that are visible
  layerConfigs: Map<string, LayerConfig>; // Configuration for each layer
  timeSlider: TimeSliderState;
  selectedFeatureId: string | null;
  hoveredFeatureId: string | null;
}

// ============================================================================
// Feature Collections for API Responses
// ============================================================================

export interface LanguageRangeCollection {
  type: 'FeatureCollection';
  features: LanguageRangeFeature[];
}

export interface ArchaeologicalSiteCollection {
  type: 'FeatureCollection';
  features: ArchaeologicalSiteFeature[];
}

export interface ArchaeologicalCultureCollection {
  type: 'FeatureCollection';
  features: ArchaeologicalCultureFeature[];
}

export interface CivilizationCollection {
  type: 'FeatureCollection';
  features: CivilizationFeature[];
}

export interface HistoricalRouteCollection {
  type: 'FeatureCollection';
  features: HistoricalRouteFeature[];
}

export interface MaterialCultureCollection {
  type: 'FeatureCollection';
  features: MaterialCultureFeature[];
}

// ============================================================================
// API Filter Types
// ============================================================================

export interface GeospatialFilters {
  timeStart?: number; // Filter by time period start
  timeEnd?: number; // Filter by time period end
  bbox?: string; // Bounding box as "west,south,east,north"
  familyIds?: string[]; // Filter by language families
  layerTypes?: LayerType[]; // Which layer types to fetch
  simplify?: boolean; // Apply geometry simplification
  simplifyTolerance?: number; // Turf.js simplification tolerance
}

// ============================================================================
// Utility Types
// ============================================================================

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_TIME_SLIDER_STATE: TimeSliderState = {
  currentYear: 2024,
  minYear: -3000,
  maxYear: 2024,
  isPlaying: false,
  playbackSpeed: 50,
  stepSize: 50,
};

export const DEFAULT_LAYER_CONFIGS: LayerConfig[] = [
  {
    id: 'language-ranges',
    type: 'language-ranges',
    category: 'languages',
    name: 'Language Ranges',
    visible: true,
    opacity: 0.6,
    zIndex: 100,
    renderStyle: {
      polygon: {
        fillOpacity: 0.3,
        strokeWeight: 2,
        strokeOpacity: 0.8,
      },
    },
  },
  {
    id: 'archaeological-sites',
    type: 'archaeological-sites',
    category: 'archaeology',
    name: 'Archaeological Sites',
    visible: false,
    opacity: 0.8,
    zIndex: 200,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'archaeological-cultures',
    type: 'archaeological-cultures',
    category: 'archaeology',
    name: 'Archaeological Cultures',
    visible: false,
    opacity: 0.5,
    zIndex: 75,
    renderStyle: {
      polygon: {
        fillOpacity: 0.25,
        strokeWeight: 2,
        strokeOpacity: 0.7,
      },
    },
  },
  {
    id: 'civilizations',
    type: 'civilizations',
    category: 'civilizations',
    name: 'Civilizations',
    visible: false,
    opacity: 0.5,
    zIndex: 50,
    renderStyle: {
      polygon: {
        fillOpacity: 0.2,
        strokeWeight: 2,
        strokeOpacity: 0.6,
      },
    },
  },
  {
    id: 'routes',
    type: 'routes',
    category: 'routes',
    name: 'Historical Routes',
    visible: false,
    opacity: 0.7,
    zIndex: 150,
    renderStyle: {
      line: {
        weight: 3,
        opacity: 0.7,
      },
    },
  },
  {
    id: 'battles',
    type: 'battles',
    category: 'archaeology',
    name: 'Historical Battles',
    visible: false,
    opacity: 0.9,
    zIndex: 300,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.9,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'material-culture',
    type: 'material-culture',
    category: 'culture',
    name: 'Material Culture',
    visible: false,
    opacity: 0.7,
    zIndex: 175,
    renderStyle: {
      polygon: {
        fillOpacity: 0.25,
        strokeWeight: 1.5,
        strokeOpacity: 0.6,
      },
    },
  },
  {
    id: 'material-culture-heatmap',
    type: 'material-culture-heatmap',
    category: 'culture',
    name: 'Culture Heatmap',
    visible: false,
    opacity: 0.6,
    zIndex: 125,
    renderStyle: {
      heatmap: {
        radius: 25,
        blur: 15,
        maxZoom: 10,
        gradient: {
          0.0: 'blue',
          0.5: 'lime',
          1.0: 'red',
        },
      },
    },
  },
  {
    id: 'cuisines',
    type: 'cuisines',
    category: 'cuisines',
    name: 'World Cuisines',
    visible: true,
    opacity: 0.8,
    zIndex: 250,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'music',
    type: 'music',
    category: 'music',
    name: 'Music Traditions',
    visible: false,
    opacity: 0.8,
    zIndex: 260,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'dance',
    type: 'dance',
    category: 'dance',
    name: 'Dance Traditions',
    visible: false,
    opacity: 0.8,
    zIndex: 265,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'religions',
    type: 'religions',
    category: 'religions',
    name: 'World Religions',
    visible: false,
    opacity: 0.8,
    zIndex: 270,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'haplogroups',
    type: 'haplogroups',
    category: 'genetics',
    name: 'Haplogroup Distributions',
    visible: false,
    opacity: 0.7,
    zIndex: 90,
    renderStyle: {
      marker: {
        size: 10,
        opacity: 0.7,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'language-contacts',
    type: 'language-contacts',
    category: 'languages',
    name: 'Language Contacts',
    visible: false,
    opacity: 0.7,
    zIndex: 180,
    renderStyle: {
      line: {
        weight: 2,
        opacity: 0.7,
      },
    },
  },
  {
    id: 'genetic-linguistic-correlation',
    type: 'genetic-linguistic-correlation',
    category: 'genetics',
    name: 'Genetic-Linguistic Correlation',
    visible: false,
    opacity: 0.7,
    zIndex: 85,
    renderStyle: {
      polygon: {
        fillOpacity: 0.35,
        strokeWeight: 2,
        strokeOpacity: 0.8,
      },
    },
  },
  {
    id: 'foodway-events',
    type: 'foodway-events',
    category: 'cuisines',
    name: 'Foodway Events',
    visible: false,
    opacity: 0.8,
    zIndex: 255,
    renderStyle: {
      line: {
        weight: 3,
        opacity: 0.8,
      },
    },
  },
  {
    id: 'kinship-systems',
    type: 'kinship-systems',
    category: 'culture',
    name: 'Kinship Systems',
    visible: false,
    opacity: 0.8,
    zIndex: 275,
    renderStyle: {
      marker: {
        size: 8,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'architectural-styles',
    type: 'architectural-styles',
    category: 'culture',
    name: 'Architectural Styles',
    visible: false,
    opacity: 0.8,
    zIndex: 280,
    renderStyle: {
      marker: {
        size: 10,
        opacity: 0.8,
        strokeWeight: 2,
      },
    },
  },
  {
    id: 'ingredient-origins',
    type: 'ingredient-origins',
    category: 'cuisines',
    name: 'Ingredient Origins',
    visible: false,
    opacity: 0.8,
    zIndex: 252,
    renderStyle: {
      marker: {
        size: 6,
        opacity: 0.8,
        strokeWeight: 1.5,
      },
    },
  },
  {
    id: 'cooking-techniques',
    type: 'cooking-techniques',
    category: 'cuisines',
    name: 'Cooking Techniques',
    visible: false,
    opacity: 0.8,
    zIndex: 253,
    renderStyle: {
      marker: {
        size: 6,
        opacity: 0.8,
        strokeWeight: 1.5,
      },
    },
  },
];

// ============================================================================
// Layer Presets
// ============================================================================

export interface LayerPreset {
  id: string;
  name: string;
  description: string;
  layers: string[]; // Layer IDs to enable
}

export const LAYER_PRESETS: LayerPreset[] = [
  {
    id: 'linguistic-atlas',
    name: 'Linguistic Atlas',
    description: 'Language ranges, writing systems, and related archaeology',
    layers: ['language-ranges', 'archaeological-sites', 'archaeological-cultures'],
  },
  {
    id: 'political-history',
    name: 'Political History',
    description: 'Civilizations, battles, and conquest routes',
    layers: ['civilizations', 'battles', 'routes'],
  },
  {
    id: 'cultural-diffusion',
    name: 'Cultural Diffusion',
    description: 'Music, religions, cuisines, and material culture',
    layers: ['cuisines', 'music', 'dance', 'religions', 'material-culture', 'material-culture-heatmap', 'foodway-events', 'kinship-systems', 'architectural-styles', 'ingredient-origins', 'cooking-techniques'],
  },
  {
    id: 'trade-economy',
    name: 'Trade & Economy',
    description: 'Trade routes, material culture, and cuisine regions',
    layers: ['routes', 'cuisines', 'material-culture', 'foodway-events', 'ingredient-origins', 'cooking-techniques'],
  },
  {
    id: 'genetic-linguistic',
    name: 'Genetic-Linguistic',
    description: 'Haplogroup distributions overlaid with language family ranges',
    layers: ['language-ranges', 'haplogroups', 'genetic-linguistic-correlation'],
  },
  {
    id: 'all-layers',
    name: 'All Layers',
    description: 'Show everything',
    layers: [], // Special: empty means show all
  },
];
