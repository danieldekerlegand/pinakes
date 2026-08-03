import { describe, it, expect } from "vitest";
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

const sampleGoods: TradeGood[] = [
  {
    id: "silk",
    name: "Silk",
    category: "textile",
    originRegion: "East Asia",
    originCoordinates: { lat: 34.0, lng: 108.0 },
    tradeRoutes: ["silk-road"],
    timePeriod: "200 BCE - 1450 CE",
    economicSignificance: "Luxury textile driving overland trade",
    associatedLanguages: ["chinese", "sogdian"],
  },
  {
    id: "pepper",
    name: "Black Pepper",
    category: "spice",
    originRegion: "South Asia",
    originCoordinates: { lat: 10.0, lng: 76.0 },
    tradeRoutes: ["spice-route"],
    timePeriod: "500 BCE - 1600 CE",
    economicSignificance: "Prized culinary spice",
    associatedLanguages: ["malayalam", "arabic"],
  },
  {
    id: "lapis",
    name: "Lapis Lazuli",
    category: "gemstone",
    originRegion: "Central Asia",
    originCoordinates: { lat: 36.7, lng: 70.8 },
    tradeRoutes: ["silk-road"],
    timePeriod: "3000 BCE - 1000 CE",
    economicSignificance: "Sacred blue stone",
    associatedLanguages: ["sogdian"],
  },
];

const sampleRoutes: TradeRoute[] = [
  {
    id: "silk-road",
    name: "Silk Road",
    routeType: "land",
    waypoints: {},
    startDate: "-200",
    endDate: "1450",
    tradedGoods: ["silk", "lapis"],
    keyCities: ["Chang'an", "Samarkand", "Constantinople"],
    controllingPowers: ["Han", "Tang", "Mongol"],
    associatedLanguages: ["chinese", "sogdian"],
    description: "Overland network connecting East Asia to Europe",
    economicImpact: "Transformed Eurasian commerce",
  },
  {
    id: "spice-route",
    name: "Spice Route",
    routeType: "maritime",
    waypoints: {},
    startDate: "-500",
    endDate: "1600",
    tradedGoods: ["pepper"],
    keyCities: ["Calicut", "Malacca", "Alexandria"],
    controllingPowers: ["Chola", "Srivijaya"],
    associatedLanguages: ["malayalam", "arabic"],
    description: "Maritime network for spice trade",
    economicImpact: "Fueled Indian Ocean economy",
  },
];

describe("formatTradeYear", () => {
  it("formats negative year strings as BCE", () => {
    expect(formatTradeYear("-200")).toBe("200 BCE");
    expect(formatTradeYear("-3000")).toBe("3000 BCE");
  });

  it("formats positive year strings as CE", () => {
    expect(formatTradeYear("1450")).toBe("1450 CE");
    expect(formatTradeYear("800")).toBe("800 CE");
  });

  it("formats zero as CE", () => {
    expect(formatTradeYear("0")).toBe("0 CE");
  });

  it("returns original string when not a number", () => {
    expect(formatTradeYear("present")).toBe("present");
    expect(formatTradeYear("unknown")).toBe("unknown");
  });
});

describe("filterTradeGoodsByLanguages", () => {
  it("returns all goods when languageIds is empty", () => {
    expect(filterTradeGoodsByLanguages(sampleGoods, [])).toHaveLength(3);
  });

  it("filters goods matching one language", () => {
    const result = filterTradeGoodsByLanguages(sampleGoods, ["chinese"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("silk");
  });

  it("filters goods matching any of multiple languages", () => {
    const result = filterTradeGoodsByLanguages(sampleGoods, ["sogdian"]);
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.id).sort()).toEqual(["lapis", "silk"]);
  });

  it("returns empty when no languages match", () => {
    expect(filterTradeGoodsByLanguages(sampleGoods, ["latin"])).toHaveLength(0);
  });

  it("handles empty goods array", () => {
    expect(filterTradeGoodsByLanguages([], ["chinese"])).toHaveLength(0);
  });
});

describe("filterTradeRoutesByLanguages", () => {
  it("returns all routes when languageIds is empty", () => {
    expect(filterTradeRoutesByLanguages(sampleRoutes, [])).toHaveLength(2);
  });

  it("filters routes matching one language", () => {
    const result = filterTradeRoutesByLanguages(sampleRoutes, ["arabic"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("spice-route");
  });

  it("filters routes matching any of multiple languages", () => {
    const result = filterTradeRoutesByLanguages(sampleRoutes, ["chinese", "malayalam"]);
    expect(result).toHaveLength(2);
  });

  it("returns empty when no languages match", () => {
    expect(filterTradeRoutesByLanguages(sampleRoutes, ["latin"])).toHaveLength(0);
  });
});

describe("getUniqueCategories", () => {
  it("extracts unique sorted categories", () => {
    expect(getUniqueCategories(sampleGoods)).toEqual(["gemstone", "spice", "textile"]);
  });

  it("deduplicates categories", () => {
    const goods: TradeGood[] = [
      { ...sampleGoods[0], id: "a" },
      { ...sampleGoods[0], id: "b" },
    ];
    expect(getUniqueCategories(goods)).toEqual(["textile"]);
  });

  it("handles empty input", () => {
    expect(getUniqueCategories([])).toEqual([]);
  });
});

describe("getUniqueRouteTypes", () => {
  it("extracts unique sorted route types", () => {
    expect(getUniqueRouteTypes(sampleRoutes)).toEqual(["land", "maritime"]);
  });

  it("handles empty input", () => {
    expect(getUniqueRouteTypes([])).toEqual([]);
  });
});

describe("CATEGORY_COLORS", () => {
  it("includes expected category keys", () => {
    expect(CATEGORY_COLORS.spice).toBeDefined();
    expect(CATEGORY_COLORS.textile).toBeDefined();
    expect(CATEGORY_COLORS.gemstone).toBeDefined();
    expect(CATEGORY_COLORS.metal).toBeDefined();
  });

  it("all values are non-empty strings", () => {
    for (const [, value] of Object.entries(CATEGORY_COLORS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe("ROUTE_TYPE_COLORS", () => {
  it("includes expected route type keys", () => {
    expect(ROUTE_TYPE_COLORS.land).toBeDefined();
    expect(ROUTE_TYPE_COLORS.maritime).toBeDefined();
    expect(ROUTE_TYPE_COLORS.river).toBeDefined();
  });

  it("all values are non-empty strings", () => {
    for (const [, value] of Object.entries(ROUTE_TYPE_COLORS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
