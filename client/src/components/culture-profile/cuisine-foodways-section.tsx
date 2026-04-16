import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  UtensilsCrossed,
  ChefHat,
  Leaf,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type Cuisine,
  type CuisineItem,
  type CookingTechnique,
  type IngredientOrigin,
  type FoodwayEvent,
  formatYear,
  getRegionColor,
  getFoodTypeColor,
  getTechniqueCategoryColor,
  getMechanismColor,
  getMechanismLabel,
  filterItemsByCuisineId,
  filterTechniquesByCuisineId,
  filterIngredientsByCuisineId,
  getUniqueFoodTypes,
  getUniqueTechniqueCategories,
  groupItemsByFoodType,
  groupTechniquesByCategory,
} from "./cuisine-foodways-utils";

interface Props {
  cuisineId?: string;
  languageIds?: string[];
}

export default function CuisineFoodwaysSection({
  cuisineId,
  languageIds,
}: Props) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [selectedFoodType, setSelectedFoodType] = useState<string>("all");
  const [selectedTechCategory, setSelectedTechCategory] =
    useState<string>("all");

  const { data: cuisinesData, isLoading: loadingCuisines } = useQuery<{
    cuisines: Cuisine[];
    count: number;
  }>({
    queryKey: ["/api/cuisines"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: itemsData, isLoading: loadingItems } = useQuery<{
    items: CuisineItem[];
    count: number;
  }>({
    queryKey: ["/api/cuisine-items"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: techniquesData, isLoading: loadingTechniques } = useQuery<{
    cookingTechniques: CookingTechnique[];
    count: number;
  }>({
    queryKey: ["/api/cooking-techniques"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: ingredientsData, isLoading: loadingIngredients } = useQuery<{
    ingredientOrigins: IngredientOrigin[];
    count: number;
  }>({
    queryKey: ["/api/ingredient-origins"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: foodwayData, isLoading: loadingFoodways } = useQuery<{
    events: FoodwayEvent[];
    count: number;
  }>({
    queryKey: ["/api/foodway-events"],
    staleTime: 5 * 60 * 1000,
  });

  const allCuisines = cuisinesData?.cuisines ?? [];
  const allItems = itemsData?.items ?? [];
  const allTechniques = techniquesData?.cookingTechniques ?? [];
  const allIngredients = ingredientsData?.ingredientOrigins ?? [];
  const foodwayEvents = foodwayData?.events ?? [];

  // Find the associated cuisine(s) for this culture
  const associatedCuisines = useMemo(() => {
    if (cuisineId) {
      return allCuisines.filter((c) => c.id === cuisineId);
    }
    if (languageIds && languageIds.length > 0) {
      return allCuisines.filter((c) =>
        c.associatedLanguageIds.some((lid) => languageIds.includes(lid))
      );
    }
    return allCuisines;
  }, [allCuisines, cuisineId, languageIds]);

  const cuisineIds = useMemo(
    () => new Set(associatedCuisines.map((c) => c.id)),
    [associatedCuisines]
  );

  // Filter data to associated cuisines
  const items = useMemo(() => {
    if (cuisineIds.size === 0) return allItems;
    return allItems.filter((i) => cuisineIds.has(i.cuisineId));
  }, [allItems, cuisineIds]);

  const techniques = useMemo(() => {
    if (cuisineIds.size === 0) return allTechniques;
    return allTechniques.filter((t) => cuisineIds.has(t.cuisineId));
  }, [allTechniques, cuisineIds]);

  const ingredients = useMemo(() => {
    if (cuisineIds.size === 0) return allIngredients;
    return allIngredients.filter((i) => cuisineIds.has(i.cuisineId));
  }, [allIngredients, cuisineIds]);

  // Filtered views
  const filteredItems = useMemo(() => {
    if (selectedFoodType === "all") return items;
    return items.filter((i) => i.foodType === selectedFoodType);
  }, [items, selectedFoodType]);

  const filteredTechniques = useMemo(() => {
    if (selectedTechCategory === "all") return techniques;
    return techniques.filter((t) => t.category === selectedTechCategory);
  }, [techniques, selectedTechCategory]);

  const foodTypes = useMemo(() => getUniqueFoodTypes(items), [items]);
  const techCategories = useMemo(
    () => getUniqueTechniqueCategories(techniques),
    [techniques]
  );
  const itemsByType = useMemo(
    () => groupItemsByFoodType(filteredItems),
    [filteredItems]
  );
  const techniquesByCategory = useMemo(
    () => groupTechniquesByCategory(filteredTechniques),
    [filteredTechniques]
  );

  const isLoading =
    loadingCuisines ||
    loadingItems ||
    loadingTechniques ||
    loadingIngredients ||
    loadingFoodways;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
        <span className="ml-2 text-sm text-gray-500">
          Loading cuisine data...
        </span>
      </div>
    );
  }

  if (associatedCuisines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <UtensilsCrossed className="h-10 w-10 mb-3 text-gray-300" />
        <p className="text-sm">No cuisine data available for this culture.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cuisine Overview */}
      <div className="space-y-3">
        {associatedCuisines.map((cuisine) => (
          <Card key={cuisine.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">{cuisine.name}</h3>
                {cuisine.nativeName !== cuisine.name && (
                  <p className="text-sm text-gray-500">{cuisine.nativeName}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  style={{
                    borderColor: getRegionColor(cuisine.region),
                    color: getRegionColor(cuisine.region),
                  }}
                >
                  {cuisine.region}
                </Badge>
                <Badge variant="secondary">
                  {formatYear(cuisine.timeOrigin)}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-2">{cuisine.description}</p>
            <div className="flex gap-4 mt-3 text-xs text-gray-500">
              <span>
                {filterItemsByCuisineId(allItems, cuisine.id).length} dishes
              </span>
              <span>
                {filterTechniquesByCuisineId(allTechniques, cuisine.id).length}{" "}
                techniques
              </span>
              <span>
                {filterIngredientsByCuisineId(allIngredients, cuisine.id)
                  .length}{" "}
                key ingredients
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="dishes" className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="dishes" className="gap-1">
            <UtensilsCrossed className="h-3.5 w-3.5" />
            Dishes ({items.length})
          </TabsTrigger>
          <TabsTrigger value="techniques" className="gap-1">
            <ChefHat className="h-3.5 w-3.5" />
            Techniques ({techniques.length})
          </TabsTrigger>
          <TabsTrigger value="ingredients" className="gap-1">
            <Leaf className="h-3.5 w-3.5" />
            Ingredients ({ingredients.length})
          </TabsTrigger>
          <TabsTrigger value="foodways" className="gap-1">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Foodways ({foodwayEvents.length})
          </TabsTrigger>
        </TabsList>

        {/* Dishes Tab */}
        <TabsContent value="dishes" className="space-y-4">
          {/* Food type filter */}
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                selectedFoodType === "all"
                  ? "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setSelectedFoodType("all")}
            >
              All ({items.length})
            </button>
            {foodTypes.map((type) => (
              <button
                key={type}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  selectedFoodType === type
                    ? "text-white border-transparent"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
                style={
                  selectedFoodType === type
                    ? { backgroundColor: getFoodTypeColor(type) }
                    : {}
                }
                onClick={() =>
                  setSelectedFoodType(
                    selectedFoodType === type ? "all" : type
                  )
                }
              >
                {type}
              </button>
            ))}
          </div>

          {/* Grouped dishes */}
          {Array.from(itemsByType.entries()).map(([type, typeItems]) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: getFoodTypeColor(type) }}
                />
                <h4 className="text-sm font-medium text-gray-700">{type}</h4>
                <span className="text-xs text-gray-400">
                  ({typeItems.length})
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {typeItems.map((item) => (
                  <div
                    key={item.id}
                    className="px-3 py-2 rounded-lg border bg-white text-sm hover:shadow-sm transition-shadow"
                  >
                    <span className="font-medium">{item.name}</span>
                    {item.timeOrigin !== null && (
                      <span className="text-xs text-gray-400 ml-1">
                        ({formatYear(item.timeOrigin)})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filteredItems.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No dishes found for this filter.
            </p>
          )}
        </TabsContent>

        {/* Techniques Tab */}
        <TabsContent value="techniques" className="space-y-4">
          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                selectedTechCategory === "all"
                  ? "bg-gray-800 text-white border-gray-800"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setSelectedTechCategory("all")}
            >
              All ({techniques.length})
            </button>
            {techCategories.map((cat) => (
              <button
                key={cat}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  selectedTechCategory === cat
                    ? "text-white border-transparent"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
                style={
                  selectedTechCategory === cat
                    ? { backgroundColor: getTechniqueCategoryColor(cat) }
                    : {}
                }
                onClick={() =>
                  setSelectedTechCategory(
                    selectedTechCategory === cat ? "all" : cat
                  )
                }
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Technique cards */}
          {Array.from(techniquesByCategory.entries()).map(
            ([category, catTechniques]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                      backgroundColor: getTechniqueCategoryColor(category),
                    }}
                  />
                  <h4 className="text-sm font-medium text-gray-700 capitalize">
                    {category}
                  </h4>
                  <span className="text-xs text-gray-400">
                    ({catTechniques.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {catTechniques.map((tech) => {
                    const isExpanded = expandedItem === tech.id;
                    return (
                      <Card key={tech.id} className="overflow-hidden">
                        <button
                          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                          onClick={() =>
                            setExpandedItem(isExpanded ? null : tech.id)
                          }
                        >
                          <div>
                            <span className="text-sm font-medium">
                              {tech.name}
                            </span>
                            <span className="text-xs text-gray-400 ml-2">
                              {formatYear(tech.timeOrigin)}
                            </span>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-3 text-sm text-gray-600 border-t bg-gray-50">
                            <p className="pt-2">{tech.description}</p>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {filteredTechniques.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No techniques found for this filter.
            </p>
          )}
        </TabsContent>

        {/* Ingredients Tab */}
        <TabsContent value="ingredients" className="space-y-3">
          {ingredients.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No ingredient data available.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {ingredients.map((ingredient) => {
                const isExpanded = expandedItem === ingredient.id;
                return (
                  <Card key={ingredient.id} className="overflow-hidden">
                    <button
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                      onClick={() =>
                        setExpandedItem(isExpanded ? null : ingredient.id)
                      }
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <span className="text-sm font-medium">
                            {ingredient.name}
                          </span>
                          {ingredient.nativeName &&
                            ingredient.nativeName !== ingredient.name && (
                              <span className="text-xs text-gray-400 ml-1.5">
                                ({ingredient.nativeName})
                              </span>
                            )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {ingredient.originRegion}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {formatYear(ingredient.timeOrigin)}
                        </Badge>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 text-sm text-gray-600 border-t bg-gray-50">
                        <p className="pt-2">{ingredient.description}</p>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Foodways Tab */}
        <TabsContent value="foodways" className="space-y-3">
          {foodwayEvents.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No foodway event data available.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                Historical food exchanges, trade routes, and cultural diffusion
                events.
              </p>
              <div className="space-y-2">
                {foodwayEvents.map((event) => {
                  const isExpanded = expandedItem === event.id;
                  return (
                    <Card key={event.id} className="overflow-hidden">
                      <button
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                        onClick={() =>
                          setExpandedItem(isExpanded ? null : event.id)
                        }
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: getMechanismColor(
                                event.mechanism
                              ),
                            }}
                          />
                          <div>
                            <span className="text-sm font-medium">
                              {event.name}
                            </span>
                            <span className="text-xs text-gray-400 ml-2">
                              {formatYear(event.date)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{
                              borderColor: getMechanismColor(event.mechanism),
                              color: getMechanismColor(event.mechanism),
                            }}
                          >
                            {getMechanismLabel(event.mechanism)}
                          </Badge>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3 border-t bg-gray-50 space-y-2">
                          <div className="flex items-center gap-2 pt-2 text-xs text-gray-500">
                            <span className="font-medium">
                              {event.originRegion}
                            </span>
                            <ArrowRightLeft className="h-3 w-3" />
                            <span className="font-medium">
                              {event.destinationRegion}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">
                            {event.description}
                          </p>
                          {event.culturalImpact && (
                            <div className="text-sm">
                              <span className="font-medium text-gray-500">
                                Cultural Impact:{" "}
                              </span>
                              <span className="text-gray-600">
                                {event.culturalImpact}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
