import type {
  LanguageRangeFeature,
  ArchaeologicalSiteFeature,
  CivilizationFeature,
  HistoricalRouteFeature,
  MaterialCultureDistribution,
} from './geospatial-types';

/**
 * Sample language range data for testing the enhanced map view
 * These are simplified, approximate polygons for demonstration purposes
 */
export const sampleLanguageRanges: LanguageRangeFeature[] = [
  // Latin (Roman Empire at peak - 117 CE)
  {
    type: 'Feature',
    id: 'latin-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-10, 35], // Spain
        [-10, 45],
        [5, 50], // France
        [15, 48], // Germany
        [25, 45], // Balkans
        [35, 40], // Turkey
        [40, 35], // Middle East
        [35, 30], // Egypt
        [10, 30], // North Africa
        [-10, 35], // Back to Spain
      ]],
    },
    properties: {
      languageId: 'latin-id',
      languageName: 'Latin',
      nativeName: 'Latina',
      familyId: 'indo-european',
      familyName: 'Indo-European',
      rangeType: 'historical',
      timePeriod: {
        start: -500,
        end: 500,
        label: 'Roman Era (500 BCE - 500 CE)',
      },
      confidence: 75,
      sources: ['Historical records', 'Roman Empire maps'],
      totalSpeakers: 50000000,
      region: 'Mediterranean',
      status: 'extinct',
    },
  },

  // Ancient Greek (Classical period)
  {
    type: 'Feature',
    id: 'ancient-greek-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [19, 35], // Western Greece
        [19, 42],
        [29, 42], // Black Sea
        [29, 35], // Anatolia
        [25, 34], // Crete
        [19, 35], // Back to start
      ]],
    },
    properties: {
      languageId: 'ancient-greek-id',
      languageName: 'Ancient Greek',
      nativeName: 'Ἑλληνική',
      familyId: 'indo-european',
      familyName: 'Indo-European',
      rangeType: 'historical',
      timePeriod: {
        start: -800,
        end: 600,
        label: 'Classical Greek Era (800 BCE - 600 CE)',
      },
      confidence: 85,
      sources: ['Ancient Greek texts', 'Archaeological evidence'],
      totalSpeakers: 10000000,
      region: 'Eastern Mediterranean',
      status: 'extinct',
    },
  },

  // Proto-Indo-European (reconstructed)
  {
    type: 'Feature',
    id: 'pie-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [35, 45], // Pontic-Caspian Steppe
        [35, 50],
        [50, 50],
        [50, 45],
        [35, 45],
      ]],
    },
    properties: {
      languageId: 'pie-id',
      languageName: 'Proto-Indo-European',
      familyId: 'indo-european',
      familyName: 'Indo-European',
      rangeType: 'reconstructed',
      timePeriod: {
        start: -4000,
        end: -2500,
        label: 'Neolithic Era (4000-2500 BCE)',
      },
      confidence: 45,
      sources: ['Linguistic reconstruction', 'Kurgan hypothesis'],
      region: 'Pontic-Caspian Steppe',
      status: 'reconstructed',
    },
  },

  // Arabic (Medieval spread)
  {
    type: 'Feature',
    id: 'arabic-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [35, 15], // Arabia
        [35, 35],
        [60, 35], // Persia
        [60, 20],
        [45, 15],
        [35, 15],
      ]],
    },
    properties: {
      languageId: 'arabic-id',
      languageName: 'Arabic',
      nativeName: 'العربية',
      familyId: 'afro-asiatic',
      familyName: 'Afro-Asiatic',
      rangeType: 'historical',
      timePeriod: {
        start: 600,
        end: 1500,
        label: 'Islamic Golden Age (600-1500 CE)',
      },
      confidence: 80,
      sources: ['Islamic historical texts', 'Caliphate maps'],
      totalSpeakers: 30000000,
      region: 'Middle East & North Africa',
      status: 'living',
      iso639_1: 'ar',
    },
  },

  // Modern English (current)
  {
    type: 'Feature',
    id: 'english-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-10, 50], // British Isles
        [-10, 60],
        [2, 60],
        [2, 50],
        [-10, 50],
      ]],
    },
    properties: {
      languageId: 'english-id',
      languageName: 'English',
      familyId: 'indo-european',
      familyName: 'Indo-European',
      rangeType: 'current',
      timePeriod: {
        start: 1500,
        end: null,
        label: 'Modern English (1500 CE - Present)',
      },
      confidence: 95,
      sources: ['Modern linguistic data', 'Census data'],
      totalSpeakers: 1500000000,
      region: 'British Isles',
      status: 'living',
      iso639_1: 'en',
      iso639_2: 'eng',
    },
  },

  // Mandarin Chinese (current)
  {
    type: 'Feature',
    id: 'mandarin-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [100, 20], // Southern China
        [100, 45], // Northern China
        [125, 45],
        [125, 20],
        [100, 20],
      ]],
    },
    properties: {
      languageId: 'mandarin-id',
      languageName: 'Mandarin Chinese',
      nativeName: '普通话',
      familyId: 'sino-tibetan',
      familyName: 'Sino-Tibetan',
      rangeType: 'current',
      timePeriod: {
        start: 1000,
        end: null,
        label: 'Middle Chinese to Modern (1000 CE - Present)',
      },
      confidence: 90,
      sources: ['Modern linguistic data', 'Census data'],
      totalSpeakers: 1100000000,
      region: 'East Asia',
      status: 'living',
      iso639_1: 'zh',
    },
  },

  // Spanish (current & colonial)
  {
    type: 'Feature',
    id: 'spanish-range-iberia',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-10, 36], // Iberian Peninsula
        [-10, 44],
        [5, 44],
        [5, 36],
        [-10, 36],
      ]],
    },
    properties: {
      languageId: 'spanish-id',
      languageName: 'Spanish',
      nativeName: 'Español',
      familyId: 'indo-european',
      familyName: 'Indo-European',
      rangeType: 'current',
      timePeriod: {
        start: 1200,
        end: null,
        label: 'Medieval Spanish to Modern (1200 CE - Present)',
      },
      confidence: 95,
      sources: ['Modern linguistic data', 'Historical records'],
      totalSpeakers: 500000000,
      region: 'Iberian Peninsula',
      status: 'living',
      iso639_1: 'es',
      iso639_2: 'spa',
    },
  },

  // Old Norse (Viking Age)
  {
    type: 'Feature',
    id: 'old-norse-range-1',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [5, 55], // Scandinavia
        [5, 70],
        [30, 70],
        [30, 55],
        [5, 55],
      ]],
    },
    properties: {
      languageId: 'old-norse-id',
      languageName: 'Old Norse',
      nativeName: 'Norrœnt mál',
      familyId: 'indo-european',
      familyName: 'Indo-European',
      rangeType: 'historical',
      timePeriod: {
        start: 700,
        end: 1400,
        label: 'Viking Age (700-1400 CE)',
      },
      confidence: 75,
      sources: ['Viking sagas', 'Runic inscriptions'],
      totalSpeakers: 1000000,
      region: 'Scandinavia',
      status: 'extinct',
    },
  },
];

/**
 * Sample archaeological sites data
 */
export const sampleArchaeologicalSites: ArchaeologicalSiteFeature[] = [
  // Pompeii
  {
    type: 'Feature',
    id: 'pompeii-site',
    geometry: {
      type: 'Point',
      coordinates: [14.4833, 40.7500], // [lng, lat]
    },
    properties: {
      siteId: 'pompeii-id',
      name: 'Pompeii',
      siteType: 'settlement',
      timePeriod: {
        start: -600,
        end: 79,
        label: 'Ancient Roman City (600 BCE - 79 CE)',
      },
      associatedLanguageIds: ['latin-id'],
      associatedCultureIds: [],
      excavationStatus: 'extensive',
      findings: ['Preserved city', 'Frescoes', 'Latin inscriptions', 'Daily life artifacts'],
      importance: 95,
      confidence: 100,
      sources: ['Archaeological excavations', 'Historical records'],
    },
  },

  // Göbekli Tepe
  {
    type: 'Feature',
    id: 'gobekli-tepe-site',
    geometry: {
      type: 'Point',
      coordinates: [38.9222, 37.2233],
    },
    properties: {
      siteId: 'gobekli-tepe-id',
      name: 'Göbekli Tepe',
      siteType: 'temple',
      timePeriod: {
        start: -9600,
        end: -8000,
        label: 'Pre-Pottery Neolithic (9600-8000 BCE)',
      },
      associatedLanguageIds: [],
      associatedCultureIds: [],
      excavationStatus: 'partial',
      findings: ['Megalithic pillars', 'T-shaped monuments', 'Animal carvings'],
      importance: 100,
      confidence: 90,
      sources: ['German Archaeological Institute', 'Recent excavations'],
    },
  },

  // Delphi
  {
    type: 'Feature',
    id: 'delphi-site',
    geometry: {
      type: 'Point',
      coordinates: [22.5006, 38.4824],
    },
    properties: {
      siteId: 'delphi-id',
      name: 'Delphi',
      siteType: 'ceremonial',
      timePeriod: {
        start: -800,
        end: 393,
        label: 'Classical Greek Era (800 BCE - 393 CE)',
      },
      associatedLanguageIds: ['ancient-greek-id'],
      associatedCultureIds: [],
      excavationStatus: 'extensive',
      findings: ['Oracle temple', 'Theater', 'Treasury buildings', 'Greek inscriptions'],
      importance: 90,
      confidence: 95,
      sources: ['Greek texts', 'Archaeological evidence'],
    },
  },
];

/**
 * Sample civilizations data
 */
export const sampleCivilizations: CivilizationFeature[] = [
  // Roman Empire (at peak)
  {
    type: 'Feature',
    id: 'roman-empire-117',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-10, 35], // Spain
        [-10, 45],
        [5, 50], // France
        [15, 48], // Germany
        [25, 45], // Balkans
        [35, 40], // Turkey
        [40, 35], // Middle East
        [35, 30], // Egypt
        [10, 30], // North Africa
        [-10, 35], // Back to Spain
      ]],
    },
    properties: {
      civilizationId: 'roman-empire-id',
      name: 'Roman Empire',
      nativeName: 'Imperium Romanum',
      timePeriod: {
        start: -27,
        end: 476,
        label: 'Roman Empire (27 BCE - 476 CE)',
      },
      associatedLanguageIds: ['latin-id'],
      writingSystems: ['Latin alphabet'],
      politicalStructure: 'Empire',
      capital: 'Rome',
      population: 60000000,
      sources: ['Historical records', 'Archaeological evidence'],
    },
  },

  // Ancient Greece (Classical period)
  {
    type: 'Feature',
    id: 'ancient-greece-classical',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [19, 35], // Western Greece
        [19, 42],
        [29, 42], // Black Sea colonies
        [29, 35], // Anatolia
        [25, 34], // Crete
        [19, 35],
      ]],
    },
    properties: {
      civilizationId: 'ancient-greece-id',
      name: 'Ancient Greece',
      nativeName: 'Ἑλλάς',
      timePeriod: {
        start: -800,
        end: -146,
        label: 'Classical Greece (800-146 BCE)',
      },
      associatedLanguageIds: ['ancient-greek-id'],
      writingSystems: ['Greek alphabet'],
      politicalStructure: 'City-states',
      capital: 'Athens (prominent)',
      population: 8000000,
      sources: ['Ancient texts', 'Archaeological sites'],
    },
  },
];

/**
 * Sample historical routes data
 */
export const sampleHistoricalRoutes: HistoricalRouteFeature[] = [
  // Silk Road
  {
    type: 'Feature',
    id: 'silk-road',
    geometry: {
      type: 'LineString',
      coordinates: [
        [115, 39], // Chang'an (Xi'an)
        [105, 38], // Lanzhou
        [95, 40], // Dunhuang
        [85, 43], // Kashgar
        [70, 40], // Samarkand
        [60, 37], // Merv
        [50, 35], // Tehran
        [44, 33], // Baghdad
        [36, 34], // Damascus
        [31, 30], // Cairo
      ],
    },
    properties: {
      routeId: 'silk-road-id',
      name: 'Silk Road',
      routeType: 'trade',
      timePeriod: {
        start: -200,
        end: 1400,
        label: 'Han Dynasty to Ming Dynasty (200 BCE - 1400 CE)',
      },
      associatedLanguageIds: ['mandarin-id', 'arabic-id'],
      linguisticImpact: 'Facilitated exchange of vocabulary related to trade, religion, and technology',
      tradedGoods: ['Silk', 'Spices', 'Tea', 'Paper', 'Gunpowder', 'Precious metals'],
      direction: 'bidirectional',
      sources: ['Historical trade records', 'Archaeological evidence'],
    },
  },

  // Viking trade routes
  {
    type: 'Feature',
    id: 'viking-routes',
    geometry: {
      type: 'LineString',
      coordinates: [
        [10, 60], // Norway
        [0, 60], // North Sea
        [-4, 56], // Scotland
        [-6, 54], // Ireland
        [-2, 51], // England
        [5, 50], // Netherlands
        [10, 54], // Denmark
      ],
    },
    properties: {
      routeId: 'viking-routes-id',
      name: 'Viking Trade Routes',
      routeType: 'migration',
      timePeriod: {
        start: 700,
        end: 1100,
        label: 'Viking Age (700-1100 CE)',
      },
      associatedLanguageIds: ['old-norse-id'],
      linguisticImpact: 'Norse loanwords in English and other Germanic languages',
      tradedGoods: ['Furs', 'Amber', 'Iron', 'Slaves'],
      direction: 'bidirectional',
      sources: ['Viking sagas', 'Archaeological findings'],
    },
  },
];

/**
 * Sample material culture distributions for heatmap
 */
export const sampleMaterialCultureDistributions: MaterialCultureDistribution[] = [
  // Roman pottery distribution
  { lat: 41.9, lng: 12.5, intensity: 1.0, cultureId: 'roman-pottery', timePeriod: { start: -100, end: 400, label: 'Roman Imperial Period' } },
  { lat: 40.4, lng: -3.7, intensity: 0.8, cultureId: 'roman-pottery', timePeriod: { start: -100, end: 400, label: 'Roman Imperial Period' } },
  { lat: 48.9, lng: 2.4, intensity: 0.7, cultureId: 'roman-pottery', timePeriod: { start: -100, end: 400, label: 'Roman Imperial Period' } },
  { lat: 37.9, lng: 23.7, intensity: 0.6, cultureId: 'roman-pottery', timePeriod: { start: -100, end: 400, label: 'Roman Imperial Period' } },
  { lat: 51.5, lng: -0.1, intensity: 0.5, cultureId: 'roman-pottery', timePeriod: { start: -100, end: 400, label: 'Roman Imperial Period' } },

  // Greek pottery distribution
  { lat: 37.9, lng: 23.7, intensity: 1.0, cultureId: 'greek-pottery', timePeriod: { start: -600, end: -300, label: 'Classical Period' } },
  { lat: 39.6, lng: 19.9, intensity: 0.9, cultureId: 'greek-pottery', timePeriod: { start: -600, end: -300, label: 'Classical Period' } },
  { lat: 35.3, lng: 25.1, intensity: 0.8, cultureId: 'greek-pottery', timePeriod: { start: -600, end: -300, label: 'Classical Period' } },
  { lat: 38.4, lng: 27.1, intensity: 0.7, cultureId: 'greek-pottery', timePeriod: { start: -600, end: -300, label: 'Classical Period' } },

  // Viking artifacts distribution
  { lat: 59.9, lng: 10.8, intensity: 1.0, cultureId: 'viking-artifacts', timePeriod: { start: 700, end: 1100, label: 'Viking Age' } },
  { lat: 60.2, lng: 24.9, intensity: 0.8, cultureId: 'viking-artifacts', timePeriod: { start: 700, end: 1100, label: 'Viking Age' } },
  { lat: 55.7, lng: 12.6, intensity: 0.9, cultureId: 'viking-artifacts', timePeriod: { start: 700, end: 1100, label: 'Viking Age' } },
  { lat: 64.1, lng: -21.9, intensity: 0.7, cultureId: 'viking-artifacts', timePeriod: { start: 700, end: 1100, label: 'Viking Age' } },
];
