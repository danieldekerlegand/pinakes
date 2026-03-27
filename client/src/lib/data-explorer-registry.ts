// ---------------------------------------------------------------------------
// Dataset & visualization type definitions
// ---------------------------------------------------------------------------

export type DataShape =
  | "temporal"
  | "hierarchical"
  | "relational"
  | "geographic"
  | "matrix"
  | "tabular";

export type VisualizationType =
  | "table"
  | "timeline"
  | "tree"
  | "network"
  | "map"
  | "heatmap"
  | "sankey"
  | "chord";

export interface DatasetDefinition {
  id: string;
  name: string;
  category: string;
  endpoint: string;
  file: string;
  dataShapes: DataShape[];
  defaultVisualization: VisualizationType;
  compatibleVisualizations: VisualizationType[];
}

export interface VisualizationOption {
  type: VisualizationType;
  label: string;
  iconName: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Visualization options registry
// ---------------------------------------------------------------------------

export const VISUALIZATION_OPTIONS: VisualizationOption[] = [
  { type: "table", label: "Table", iconName: "Table2", description: "Tabular data view with sorting and filtering" },
  { type: "timeline", label: "Timeline", iconName: "Clock", description: "Temporal events on a time axis" },
  { type: "tree", label: "Tree", iconName: "GitBranch", description: "Hierarchical tree structure" },
  { type: "network", label: "Network", iconName: "Network", description: "Nodes and edges in a force-directed graph" },
  { type: "map", label: "Map", iconName: "Map", description: "Geographic distribution on a world map" },
  { type: "heatmap", label: "Heatmap", iconName: "Layers", description: "Matrix intensity visualization" },
  { type: "sankey", label: "Sankey", iconName: "ArrowLeftRight", description: "Flow diagram showing quantities between nodes" },
  { type: "chord", label: "Chord", iconName: "BarChart3", description: "Circular diagram showing relationships" },
];

// ---------------------------------------------------------------------------
// Dataset registry — maps every TSV dataset to its API, shapes, and viz types
// ---------------------------------------------------------------------------

export const DATASET_REGISTRY: DatasetDefinition[] = [
  // Linguistics
  { id: "language-families", name: "Language Families", category: "Linguistics", endpoint: "/api/language-families/tree", file: "families.tsv", dataShapes: ["hierarchical"], defaultVisualization: "tree", compatibleVisualizations: ["tree", "table", "network"] },
  { id: "languages", name: "Languages", category: "Linguistics", endpoint: "/api/languages", file: "languages.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map", "network"] },
  { id: "etymology-relations", name: "Etymology Relations", category: "Linguistics", endpoint: "/api/etymology-relations", file: "etymology-relations.tsv", dataShapes: ["relational"], defaultVisualization: "network", compatibleVisualizations: ["network", "table", "sankey"] },
  { id: "phonological-inventories", name: "Phonological Inventories", category: "Linguistics", endpoint: "/api/phonological-inventories", file: "phonological-inventories.tsv", dataShapes: ["matrix", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "heatmap"] },
  { id: "grammar-features", name: "Grammar Features", category: "Linguistics", endpoint: "/api/grammar-features", file: "grammar-features.tsv", dataShapes: ["matrix", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "heatmap"] },
  { id: "writing-systems", name: "Writing Systems", category: "Linguistics", endpoint: "/api/writing-systems", file: "writing-systems.tsv", dataShapes: ["hierarchical", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "tree"] },
  { id: "verb-paradigms", name: "Verb Paradigms", category: "Linguistics", endpoint: "/api/verb-paradigms", file: "verb-paradigms.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },
  { id: "language-contacts", name: "Language Contacts", category: "Linguistics", endpoint: "/api/language-contacts", file: "language-contacts.tsv", dataShapes: ["relational"], defaultVisualization: "network", compatibleVisualizations: ["network", "table", "chord", "sankey"] },
  { id: "sound-changes", name: "Sound Changes", category: "Linguistics", endpoint: "/api/sound-changes", file: "sound-changes.tsv", dataShapes: ["relational", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "network"] },

  // Culture
  { id: "art-traditions", name: "Art Traditions", category: "Culture", endpoint: "/api/art-traditions", file: "art-traditions.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map", "timeline"] },
  { id: "literary-traditions", name: "Literary Traditions", category: "Culture", endpoint: "/api/literary-traditions", file: "literary-traditions.tsv", dataShapes: ["tabular", "temporal"], defaultVisualization: "table", compatibleVisualizations: ["table", "timeline"] },
  { id: "literary-works", name: "Literary Works", category: "Culture", endpoint: "/api/literary-works", file: "literary-works.tsv", dataShapes: ["tabular", "temporal"], defaultVisualization: "table", compatibleVisualizations: ["table", "timeline"] },
  { id: "music-traditions", name: "Music Traditions", category: "Culture", endpoint: "/api/music-traditions", file: "music-traditions.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map", "network"] },
  { id: "musical-instruments", name: "Musical Instruments", category: "Culture", endpoint: "/api/musical-instruments", file: "musical-instruments.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map"] },
  { id: "dance-traditions", name: "Dance Traditions", category: "Culture", endpoint: "/api/dance-traditions", file: "dance-traditions.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map"] },
  { id: "material-culture", name: "Material Culture", category: "Culture", endpoint: "/api/material-culture", file: "material-culture.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map"] },
  { id: "cultural-lineages", name: "Cultural Lineages", category: "Culture", endpoint: "/api/cultural-lineages", file: "cultural-lineages.tsv", dataShapes: ["hierarchical", "relational"], defaultVisualization: "tree", compatibleVisualizations: ["tree", "network", "table", "sankey"] },
  { id: "kinship-systems", name: "Kinship Systems", category: "Culture", endpoint: "/api/kinship-systems", file: "kinship-systems.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },

  // Religion & Mythology
  { id: "religions", name: "Religions", category: "Religion", endpoint: "/api/religions", file: "religions.tsv", dataShapes: ["tabular", "geographic", "temporal"], defaultVisualization: "table", compatibleVisualizations: ["table", "map", "timeline"] },
  { id: "deities", name: "Deities", category: "Religion", endpoint: "/api/deities", file: "deities.tsv", dataShapes: ["relational", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "network", "chord"] },
  { id: "myth-motifs", name: "Myth Motifs", category: "Religion", endpoint: "/api/myth-motifs", file: "myth-motifs.tsv", dataShapes: ["relational", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "network"] },
  { id: "narratives", name: "Narratives", category: "Religion", endpoint: "/api/narratives", file: "narratives.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },

  // History
  { id: "civilizations", name: "Civilizations", category: "History", endpoint: "/api/map/civilizations", file: "civilizations.tsv", dataShapes: ["temporal", "geographic"], defaultVisualization: "timeline", compatibleVisualizations: ["timeline", "map", "table"] },
  { id: "empires-timeline", name: "Empires Timeline", category: "History", endpoint: "/api/map/empires-timeline", file: "empires-timeline.tsv", dataShapes: ["temporal", "geographic"], defaultVisualization: "timeline", compatibleVisualizations: ["timeline", "map", "table"] },
  { id: "archaeological-cultures", name: "Archaeological Cultures", category: "History", endpoint: "/api/archaeological-cultures", file: "archaeological-cultures.tsv", dataShapes: ["temporal", "geographic", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "timeline", "map"] },
  { id: "battles", name: "Battles", category: "History", endpoint: "/api/battles", file: "battles.tsv", dataShapes: ["temporal", "geographic"], defaultVisualization: "map", compatibleVisualizations: ["map", "timeline", "table"] },
  { id: "migration-routes", name: "Migration Routes", category: "History", endpoint: "/api/migration-routes", file: "migration-routes.tsv", dataShapes: ["geographic", "temporal"], defaultVisualization: "map", compatibleVisualizations: ["map", "table", "sankey"] },
  { id: "urheimat-hypotheses", name: "Urheimat Hypotheses", category: "History", endpoint: "/api/urheimat-hypotheses", file: "urheimat-hypotheses.tsv", dataShapes: ["geographic", "tabular"], defaultVisualization: "table", compatibleVisualizations: ["table", "map"] },
  { id: "settlements", name: "Settlements", category: "History", endpoint: "/api/settlements", file: "settlements.tsv", dataShapes: ["geographic", "tabular"], defaultVisualization: "map", compatibleVisualizations: ["map", "table"] },

  // Trade & Economics
  { id: "trade-goods", name: "Trade Goods", category: "Trade", endpoint: "/api/trade-goods", file: "trade-goods.tsv", dataShapes: ["tabular", "relational"], defaultVisualization: "table", compatibleVisualizations: ["table", "network", "sankey"] },
  { id: "trade-routes", name: "Trade Routes", category: "Trade", endpoint: "/api/trade-routes", file: "trade-routes.tsv", dataShapes: ["geographic", "relational"], defaultVisualization: "map", compatibleVisualizations: ["map", "table", "network"] },

  // Food
  { id: "cuisines", name: "Cuisines", category: "Food", endpoint: "/api/cuisines", file: "cuisines.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map"] },
  { id: "cuisine-items", name: "Cuisine Items", category: "Food", endpoint: "/api/cuisine-items", file: "cuisine-items.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },
  { id: "ingredient-origins", name: "Ingredient Origins", category: "Food", endpoint: "/api/ingredient-origins", file: "ingredient-origins.tsv", dataShapes: ["tabular", "geographic"], defaultVisualization: "table", compatibleVisualizations: ["table", "map", "sankey"] },
  { id: "cooking-techniques", name: "Cooking Techniques", category: "Food", endpoint: "/api/cooking-techniques", file: "cooking-techniques.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },

  // Genetics
  { id: "haplogroups", name: "Haplogroups", category: "Genetics", endpoint: "/api/haplogroups", file: "haplogroups.tsv", dataShapes: ["hierarchical", "geographic"], defaultVisualization: "tree", compatibleVisualizations: ["tree", "map", "table"] },

  // Architecture
  { id: "architectural-styles", name: "Architectural Styles", category: "Architecture", endpoint: "/api/architectural-styles", file: "architectural-styles.tsv", dataShapes: ["tabular", "temporal"], defaultVisualization: "table", compatibleVisualizations: ["table", "timeline"] },
  { id: "building-types", name: "Building Types", category: "Architecture", endpoint: "/api/building-types", file: "building-types.tsv", dataShapes: ["tabular"], defaultVisualization: "table", compatibleVisualizations: ["table"] },
];

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

export function getDatasetCategories(datasets: DatasetDefinition[]): string[] {
  const cats = new Set(datasets.map((d) => d.category));
  return Array.from(cats).sort();
}

export function getCompatibleVisualizations(dataset: DatasetDefinition): VisualizationOption[] {
  return VISUALIZATION_OPTIONS.filter((v) =>
    dataset.compatibleVisualizations.includes(v.type)
  );
}

export function getSuggestedVisualization(dataset: DatasetDefinition): VisualizationOption {
  return VISUALIZATION_OPTIONS.find((v) => v.type === dataset.defaultVisualization)!;
}

export function filterDatasets(
  datasets: DatasetDefinition[],
  query: string,
  category: string | null
): DatasetDefinition[] {
  let filtered = datasets;
  if (category) {
    filtered = filtered.filter((d) => d.category === category);
  }
  if (query.trim()) {
    const q = query.toLowerCase();
    filtered = filtered.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q)
    );
  }
  return filtered;
}
