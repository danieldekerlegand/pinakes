export interface Cuisine {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  associatedLanguageIds: string[];
  timeOrigin: number | null;
  timeEnd: number | null;
  description: string;
}

export interface CuisineItem {
  id: string;
  cuisineId: string;
  name: string;
  foodType: string;
  timeOrigin: number | null;
  timeEnd: number | null;
}

export interface CookingTechnique {
  id: string;
  name: string;
  cuisineId: string;
  category: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  description: string;
}

export interface IngredientOrigin {
  id: string;
  name: string;
  cuisineId: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  nativeName: string;
  description: string;
}

export interface FoodwayEvent {
  id: string;
  name: string;
  foodItem: string;
  originRegion: string;
  originCoordinates: [number, number];
  destinationRegion: string;
  destinationCoordinates: [number, number];
  date: number;
  mechanism: string;
  associatedRouteId: string;
  description: string;
  culturalImpact: string;
}

export const REGION_COLORS: Record<string, string> = {
  "East Asia": "#ef4444",
  "South Asia": "#f59e0b",
  "Southeast Asia": "#eab308",
  "Western Europe": "#3b82f6",
  "Central Europe": "#6366f1",
  "Southern Europe": "#8b5cf6",
  "East Africa": "#10b981",
  "West Africa": "#059669",
  "North Africa": "#14b8a6",
  "Middle East": "#d97706",
  "Caucasus": "#ec4899",
  "Central Asia": "#f43f5e",
  "Eastern Europe": "#7c3aed",
  "South America": "#84cc16",
  "Central America": "#65a30d",
  "North America": "#06b6d4",
  "Caribbean": "#0891b2",
  "Oceania": "#0ea5e9",
};

export const TECHNIQUE_CATEGORY_COLORS: Record<string, string> = {
  heat: "#ef4444",
  fermentation: "#8b5cf6",
  preservation: "#3b82f6",
  sauce: "#f59e0b",
  dairy: "#eab308",
  dough: "#d97706",
};

export const FOOD_TYPE_COLORS: Record<string, string> = {
  "Main Dish": "#ef4444",
  "Stir-Fry": "#f97316",
  Dumpling: "#eab308",
  Appetizer: "#84cc16",
  "Noodle Dish": "#22c55e",
  Soup: "#14b8a6",
  "Rice Dish": "#06b6d4",
  "Rice Porridge": "#0ea5e9",
  "Grilled Meat": "#d97706",
  Stew: "#a855f7",
  "Hot Pot": "#ec4899",
  Bread: "#f59e0b",
  Salad: "#10b981",
  Dessert: "#f472b6",
  Beverage: "#818cf8",
  Seafood: "#0891b2",
  Pastry: "#c084fc",
  Curry: "#dc2626",
};

export function formatYear(year: number | null): string {
  if (year === null) return "Unknown";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function getRegionColor(region: string): string {
  return REGION_COLORS[region] || "#6b7280";
}

export function getTechniqueCategoryColor(category: string): string {
  return TECHNIQUE_CATEGORY_COLORS[category.toLowerCase()] || "#6b7280";
}

export function getFoodTypeColor(foodType: string): string {
  return FOOD_TYPE_COLORS[foodType] || "#6b7280";
}

export function filterItemsByCuisineId(
  items: CuisineItem[],
  cuisineId: string
): CuisineItem[] {
  return items.filter((item) => item.cuisineId === cuisineId);
}

export function filterTechniquesByCuisineId(
  techniques: CookingTechnique[],
  cuisineId: string
): CookingTechnique[] {
  return techniques.filter((t) => t.cuisineId === cuisineId);
}

export function filterIngredientsByCuisineId(
  ingredients: IngredientOrigin[],
  cuisineId: string
): IngredientOrigin[] {
  return ingredients.filter((i) => i.cuisineId === cuisineId);
}

export function getUniqueFoodTypes(items: CuisineItem[]): string[] {
  const set = new Set(items.map((i) => i.foodType));
  return Array.from(set).sort();
}

export function getUniqueTechniqueCategories(
  techniques: CookingTechnique[]
): string[] {
  const set = new Set(techniques.map((t) => t.category));
  return Array.from(set).sort();
}

export function groupItemsByFoodType(
  items: CuisineItem[]
): Map<string, CuisineItem[]> {
  const map = new Map<string, CuisineItem[]>();
  for (const item of items) {
    if (!map.has(item.foodType)) map.set(item.foodType, []);
    map.get(item.foodType)!.push(item);
  }
  return map;
}

export function groupTechniquesByCategory(
  techniques: CookingTechnique[]
): Map<string, CookingTechnique[]> {
  const map = new Map<string, CookingTechnique[]>();
  for (const technique of techniques) {
    if (!map.has(technique.category)) map.set(technique.category, []);
    map.get(technique.category)!.push(technique);
  }
  return map;
}

export function getMechanismLabel(mechanism: string): string {
  const labels: Record<string, string> = {
    colonization: "Colonization",
    trade: "Trade",
    migration: "Migration",
    conquest: "Conquest",
    diplomacy: "Diplomacy",
  };
  return labels[mechanism] || mechanism;
}

export const MECHANISM_COLORS: Record<string, string> = {
  colonization: "#dc2626",
  trade: "#2563eb",
  migration: "#16a34a",
  conquest: "#7c3aed",
  diplomacy: "#d97706",
};

export function getMechanismColor(mechanism: string): string {
  return MECHANISM_COLORS[mechanism] || "#6b7280";
}
