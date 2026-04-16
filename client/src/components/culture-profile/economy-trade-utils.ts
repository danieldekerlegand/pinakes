export interface TradeGood {
  id: string;
  name: string;
  category: string;
  originRegion: string;
  originCoordinates: { lat: number; lng: number };
  tradeRoutes: string[];
  timePeriod: string;
  economicSignificance: string;
  associatedLanguages: string[];
}

export interface TradeRoute {
  id: string;
  name: string;
  routeType: string;
  waypoints: Record<string, unknown>;
  startDate: string;
  endDate: string;
  tradedGoods: string[];
  keyCities: string[];
  controllingPowers: string[];
  associatedLanguages: string[];
  description: string;
  economicImpact: string;
}

export const CATEGORY_COLORS: Record<string, string> = {
  spice: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  textile: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  metal: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  gemstone: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  luxury: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  grain: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  animal: "bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300",
  food: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  material: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  dye: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  incense: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  ceramic: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medicine: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  wood: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

export const ROUTE_TYPE_COLORS: Record<string, string> = {
  land: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  maritime: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  river: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
};

export function filterTradeGoodsByLanguages(goods: TradeGood[], languageIds: string[]): TradeGood[] {
  if (!languageIds.length) return goods;
  return goods.filter((g) =>
    g.associatedLanguages.some((lang) => languageIds.includes(lang))
  );
}

export function filterTradeRoutesByLanguages(routes: TradeRoute[], languageIds: string[]): TradeRoute[] {
  if (!languageIds.length) return routes;
  return routes.filter((r) =>
    r.associatedLanguages.some((lang) => languageIds.includes(lang))
  );
}

export function getUniqueCategories(goods: TradeGood[]): string[] {
  return Array.from(new Set(goods.map((g) => g.category))).sort();
}

export function getUniqueRouteTypes(routes: TradeRoute[]): string[] {
  return Array.from(new Set(routes.map((r) => r.routeType))).sort();
}

export function formatTradeYear(dateStr: string): string {
  const num = parseInt(dateStr, 10);
  if (isNaN(num)) return dateStr;
  if (num < 0) return `${Math.abs(num)} BCE`;
  return `${num} CE`;
}
