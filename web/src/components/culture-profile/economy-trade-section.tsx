import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  Ship,
  Route,
  ChevronRight,
  ChevronDown,
  MapPin,
  Clock,
  TrendingUp,
  Landmark,
  Gem,
  Wheat,
  Shirt,
  Flame,
  FlaskConical,
} from "lucide-react";
import {
  type TradeGood,
  type TradeRoute,
  CATEGORY_COLORS,
  ROUTE_TYPE_COLORS,
  filterTradeGoodsByLanguages,
  filterTradeRoutesByLanguages,
  getUniqueCategories,
  getUniqueRouteTypes,
  formatTradeYear,
} from "./economy-trade-utils";

interface Props {
  cultureProfileId?: string;
  languageIds?: string[];
  cultureName?: string;
  region?: string;
}

function getCategoryIcon(category: string) {
  switch (category.toLowerCase()) {
    case "spice": return <Flame className="h-4 w-4" />;
    case "textile": return <Shirt className="h-4 w-4" />;
    case "metal": return <Landmark className="h-4 w-4" />;
    case "gemstone": return <Gem className="h-4 w-4" />;
    case "grain":
    case "food": return <Wheat className="h-4 w-4" />;
    case "medicine": return <FlaskConical className="h-4 w-4" />;
    default: return <Package className="h-4 w-4" />;
  }
}

function getRouteTypeIcon(routeType: string) {
  switch (routeType.toLowerCase()) {
    case "maritime": return <Ship className="h-4 w-4" />;
    default: return <Route className="h-4 w-4" />;
  }
}

function TradeGoodCard({
  good,
  expanded,
  onToggle,
  tradeRouteNames,
}: {
  good: TradeGood;
  expanded: boolean;
  onToggle: () => void;
  tradeRouteNames: Record<string, string>;
}) {
  return (
    <div
      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
      data-testid={`trade-good-${good.id}`}
    >
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
      >
        <div className="text-gray-500 dark:text-gray-400">
          {getCategoryIcon(good.category)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {good.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[good.category.toLowerCase()] || "bg-gray-100 text-gray-800"}`}>
              {good.category}
            </Badge>
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
              <MapPin className="h-2.5 w-2.5" />
              {good.originRegion}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{good.timePeriod}</span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {good.economicSignificance}
          </p>
          {good.tradeRoutes.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Trade Routes</p>
              <div className="flex flex-wrap gap-1">
                {good.tradeRoutes.map((routeId) => (
                  <Badge key={routeId} variant="outline" className="text-[10px]">
                    <Route className="h-2.5 w-2.5 mr-0.5" />
                    {tradeRouteNames[routeId] || routeId}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TradeRouteCard({
  route,
  expanded,
  onToggle,
  tradeGoodNames,
}: {
  route: TradeRoute;
  expanded: boolean;
  onToggle: () => void;
  tradeGoodNames: Record<string, string>;
}) {
  return (
    <div
      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
      data-testid={`trade-route-${route.id}`}
    >
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
      >
        <div className="text-gray-500 dark:text-gray-400">
          {getRouteTypeIcon(route.routeType)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {route.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={`text-[10px] px-1.5 py-0 ${ROUTE_TYPE_COLORS[route.routeType.toLowerCase()] || "bg-gray-100 text-gray-800"}`}>
              {route.routeType}
            </Badge>
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatTradeYear(route.startDate)} – {formatTradeYear(route.endDate)}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {route.description}
          </p>
          {route.keyCities.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Key Cities</p>
              <div className="flex flex-wrap gap-1">
                {route.keyCities.map((city) => (
                  <Badge key={city} variant="outline" className="text-[10px]">
                    <MapPin className="h-2.5 w-2.5 mr-0.5" />
                    {city}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {route.controllingPowers.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Controlling Powers</p>
              <div className="flex flex-wrap gap-1">
                {route.controllingPowers.map((power) => (
                  <Badge key={power} variant="outline" className="text-[10px]">
                    <Landmark className="h-2.5 w-2.5 mr-0.5" />
                    {power}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {route.tradedGoods.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Traded Goods</p>
              <div className="flex flex-wrap gap-1">
                {route.tradedGoods.map((goodId) => (
                  <Badge key={goodId} variant="outline" className="text-[10px]">
                    <Package className="h-2.5 w-2.5 mr-0.5" />
                    {tradeGoodNames[goodId] || goodId}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {route.economicImpact && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Economic Impact</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                {route.economicImpact}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EconomyTradeSection({ languageIds = [], cultureName }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<"goods" | "routes">("goods");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [routeTypeFilter, setRouteTypeFilter] = useState<string>("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const { data: goodsData, isLoading: goodsLoading } = useQuery<{ goods: TradeGood[]; count: number }>({
    queryKey: ["/api/trade-goods"],
  });

  const { data: routesData, isLoading: routesLoading } = useQuery<{ routes: TradeRoute[]; count: number }>({
    queryKey: ["/api/trade-routes"],
  });

  const allGoods = goodsData?.goods ?? [];
  const allRoutes = routesData?.routes ?? [];

  const relevantGoods = useMemo(
    () => filterTradeGoodsByLanguages(allGoods, languageIds),
    [allGoods, languageIds]
  );

  const relevantRoutes = useMemo(
    () => filterTradeRoutesByLanguages(allRoutes, languageIds),
    [allRoutes, languageIds]
  );

  const filteredGoods = useMemo(() => {
    if (categoryFilter === "all") return relevantGoods;
    return relevantGoods.filter((g) => g.category === categoryFilter);
  }, [relevantGoods, categoryFilter]);

  const filteredRoutes = useMemo(() => {
    if (routeTypeFilter === "all") return relevantRoutes;
    return relevantRoutes.filter((r) => r.routeType === routeTypeFilter);
  }, [relevantRoutes, routeTypeFilter]);

  const categories = useMemo(() => getUniqueCategories(relevantGoods), [relevantGoods]);
  const routeTypes = useMemo(() => getUniqueRouteTypes(relevantRoutes), [relevantRoutes]);

  const tradeRouteNames = useMemo(() => {
    const map: Record<string, string> = {};
    allRoutes.forEach((r) => { map[r.id] = r.name; });
    return map;
  }, [allRoutes]);

  const tradeGoodNames = useMemo(() => {
    const map: Record<string, string> = {};
    allGoods.forEach((g) => { map[g.id] = g.name; });
    return map;
  }, [allGoods]);

  const isLoading = goodsLoading || routesLoading;

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse" data-testid="economy-trade-loading">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="economy-trade-section">
      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
          <Package className="h-4 w-4 text-amber-500" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Trade Goods</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{relevantGoods.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
          <Route className="h-4 w-4 text-blue-500" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Trade Routes</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{relevantRoutes.length}</p>
          </div>
        </div>
      </div>

      {relevantGoods.length === 0 && relevantRoutes.length === 0 && (
        <div className="text-center py-6 text-gray-400 dark:text-gray-500" data-testid="economy-trade-empty">
          <TrendingUp className="h-8 w-8 mx-auto mb-2" />
          <p className="text-sm">No trade data available{cultureName ? ` for ${cultureName}` : ""}</p>
        </div>
      )}

      {(relevantGoods.length > 0 || relevantRoutes.length > 0) && (
        <>
          {/* Sub-tab selector */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              className={`flex-1 text-xs py-1.5 px-3 rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                activeSubTab === "goods"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
              onClick={() => setActiveSubTab("goods")}
              data-testid="subtab-goods"
            >
              <Package className="h-3.5 w-3.5" />
              Goods ({relevantGoods.length})
            </button>
            <button
              className={`flex-1 text-xs py-1.5 px-3 rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                activeSubTab === "routes"
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
              onClick={() => setActiveSubTab("routes")}
              data-testid="subtab-routes"
            >
              <Route className="h-3.5 w-3.5" />
              Routes ({relevantRoutes.length})
            </button>
          </div>

          {/* Trade Goods Tab */}
          {activeSubTab === "goods" && (
            <div className="space-y-3">
              {categories.length > 1 && (
                <select
                  className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  data-testid="category-filter"
                >
                  <option value="all">All Categories ({relevantGoods.length})</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)} (
                      {relevantGoods.filter((g) => g.category === cat).length})
                    </option>
                  ))}
                </select>
              )}

              <div className="space-y-2">
                {filteredGoods.map((good) => (
                  <TradeGoodCard
                    key={good.id}
                    good={good}
                    expanded={expandedItem === good.id}
                    onToggle={() => setExpandedItem(expandedItem === good.id ? null : good.id)}
                    tradeRouteNames={tradeRouteNames}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Trade Routes Tab */}
          {activeSubTab === "routes" && (
            <div className="space-y-3">
              {routeTypes.length > 1 && (
                <select
                  className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  value={routeTypeFilter}
                  onChange={(e) => setRouteTypeFilter(e.target.value)}
                  data-testid="route-type-filter"
                >
                  <option value="all">All Types ({relevantRoutes.length})</option>
                  {routeTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)} (
                      {relevantRoutes.filter((r) => r.routeType === type).length})
                    </option>
                  ))}
                </select>
              )}

              <div className="space-y-2">
                {filteredRoutes.map((route) => (
                  <TradeRouteCard
                    key={route.id}
                    route={route}
                    expanded={expandedItem === route.id}
                    onToggle={() => setExpandedItem(expandedItem === route.id ? null : route.id)}
                    tradeGoodNames={tradeGoodNames}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
