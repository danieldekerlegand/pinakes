import { describe, it, expect } from "vitest";
import { TsvStorage } from "../server/tsv-storage";
import type {
  TradeGood,
  TradeRoute,
} from "../client/src/components/culture-profile/economy-trade-utils";
import {
  filterTradeGoodsByLanguages,
  filterTradeRoutesByLanguages,
  getUniqueCategories,
  getUniqueRouteTypes,
  formatTradeYear,
  CATEGORY_COLORS,
} from "../client/src/components/culture-profile/economy-trade-utils";

// --- Pure utility function tests ---

describe("Economy & Trade Section - Utility Functions", () => {
  describe("formatTradeYear", () => {
    it("formats negative years as BCE", () => {
      expect(formatTradeYear("-3000")).toBe("3000 BCE");
    });

    it("formats positive years as CE", () => {
      expect(formatTradeYear("1500")).toBe("1500 CE");
    });

    it("returns original string for non-numeric input", () => {
      expect(formatTradeYear("present")).toBe("present");
    });

    it("formats zero as CE", () => {
      expect(formatTradeYear("0")).toBe("0 CE");
    });
  });

  describe("filterTradeGoodsByLanguages", () => {
    const mockGoods: TradeGood[] = [
      {
        id: "tg-001",
        name: "Silk",
        category: "textile",
        originRegion: "China",
        originCoordinates: { lat: 34, lng: 108 },
        tradeRoutes: ["silk-road"],
        timePeriod: "-3000 to 1500",
        economicSignificance: "Major trade good",
        associatedLanguages: ["cmn", "fas", "arb"],
      },
      {
        id: "tg-002",
        name: "Pepper",
        category: "spice",
        originRegion: "India",
        originCoordinates: { lat: 10, lng: 76 },
        tradeRoutes: ["spice-trade"],
        timePeriod: "-2000 to present",
        economicSignificance: "Black gold",
        associatedLanguages: ["tam", "mal", "arb"],
      },
      {
        id: "tg-003",
        name: "Amber",
        category: "gemstone",
        originRegion: "Baltic",
        originCoordinates: { lat: 54, lng: 20 },
        tradeRoutes: ["amber-road"],
        timePeriod: "-3000 to 500",
        economicSignificance: "Ancient luxury",
        associatedLanguages: ["lat", "got"],
      },
    ];

    it("returns all goods when no language IDs provided", () => {
      const result = filterTradeGoodsByLanguages(mockGoods, []);
      expect(result).toHaveLength(3);
    });

    it("filters goods by matching language IDs", () => {
      const result = filterTradeGoodsByLanguages(mockGoods, ["arb"]);
      expect(result).toHaveLength(2);
      expect(result.map((g) => g.id)).toContain("tg-001");
      expect(result.map((g) => g.id)).toContain("tg-002");
    });

    it("returns empty array when no languages match", () => {
      const result = filterTradeGoodsByLanguages(mockGoods, ["xyz"]);
      expect(result).toHaveLength(0);
    });

    it("matches on any language in the list", () => {
      const result = filterTradeGoodsByLanguages(mockGoods, ["tam"]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Pepper");
    });
  });

  describe("filterTradeRoutesByLanguages", () => {
    const mockRoutes: TradeRoute[] = [
      {
        id: "tr-001",
        name: "Silk Road",
        routeType: "land",
        waypoints: {},
        startDate: "-200",
        endDate: "1450",
        tradedGoods: ["tg-001"],
        keyCities: ["Chang'an", "Samarkand"],
        controllingPowers: ["Han Dynasty"],
        associatedLanguages: ["cmn", "fas", "arb"],
        description: "Ancient overland route",
        economicImpact: "Huge",
      },
      {
        id: "tr-002",
        name: "Spice Route",
        routeType: "maritime",
        waypoints: {},
        startDate: "-300",
        endDate: "1700",
        tradedGoods: ["tg-002"],
        keyCities: ["Calicut", "Malacca"],
        controllingPowers: ["Chola Dynasty"],
        associatedLanguages: ["tam", "mal", "msa"],
        description: "Maritime spice trade",
        economicImpact: "Massive",
      },
    ];

    it("returns all routes when no language IDs provided", () => {
      const result = filterTradeRoutesByLanguages(mockRoutes, []);
      expect(result).toHaveLength(2);
    });

    it("filters routes by matching language IDs", () => {
      const result = filterTradeRoutesByLanguages(mockRoutes, ["cmn"]);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Silk Road");
    });

    it("returns empty for non-matching languages", () => {
      const result = filterTradeRoutesByLanguages(mockRoutes, ["xyz"]);
      expect(result).toHaveLength(0);
    });
  });

  describe("getUniqueCategories", () => {
    it("extracts unique categories sorted alphabetically", () => {
      const goods: TradeGood[] = [
        { id: "1", name: "A", category: "spice", originRegion: "", originCoordinates: { lat: 0, lng: 0 }, tradeRoutes: [], timePeriod: "", economicSignificance: "", associatedLanguages: [] },
        { id: "2", name: "B", category: "textile", originRegion: "", originCoordinates: { lat: 0, lng: 0 }, tradeRoutes: [], timePeriod: "", economicSignificance: "", associatedLanguages: [] },
        { id: "3", name: "C", category: "spice", originRegion: "", originCoordinates: { lat: 0, lng: 0 }, tradeRoutes: [], timePeriod: "", economicSignificance: "", associatedLanguages: [] },
      ];
      const result = getUniqueCategories(goods);
      expect(result).toEqual(["spice", "textile"]);
    });

    it("returns empty array for empty input", () => {
      expect(getUniqueCategories([])).toEqual([]);
    });
  });

  describe("getUniqueRouteTypes", () => {
    it("extracts unique route types sorted", () => {
      const routes: TradeRoute[] = [
        { id: "1", name: "A", routeType: "maritime", waypoints: {}, startDate: "", endDate: "", tradedGoods: [], keyCities: [], controllingPowers: [], associatedLanguages: [], description: "", economicImpact: "" },
        { id: "2", name: "B", routeType: "land", waypoints: {}, startDate: "", endDate: "", tradedGoods: [], keyCities: [], controllingPowers: [], associatedLanguages: [], description: "", economicImpact: "" },
        { id: "3", name: "C", routeType: "maritime", waypoints: {}, startDate: "", endDate: "", tradedGoods: [], keyCities: [], controllingPowers: [], associatedLanguages: [], description: "", economicImpact: "" },
      ];
      const result = getUniqueRouteTypes(routes);
      expect(result).toEqual(["land", "maritime"]);
    });
  });

  describe("CATEGORY_COLORS", () => {
    it("has colors defined for common trade good categories", () => {
      expect(CATEGORY_COLORS["spice"]).toBeTruthy();
      expect(CATEGORY_COLORS["textile"]).toBeTruthy();
      expect(CATEGORY_COLORS["metal"]).toBeTruthy();
      expect(CATEGORY_COLORS["gemstone"]).toBeTruthy();
    });
  });
});

// --- Data layer integration tests ---

describe("Economy & Trade Section - Data Layer", () => {
  const storage = new TsvStorage();

  describe("getTradeGoods", () => {
    it("loads trade goods from TSV", async () => {
      const goods = await storage.getTradeGoods();
      expect(goods.length).toBeGreaterThanOrEqual(10);
    });

    it("returns goods with required fields", async () => {
      const goods = await storage.getTradeGoods();
      for (const g of goods) {
        expect(g.id).toBeTruthy();
        expect(g.name).toBeTruthy();
        expect(g.category).toBeTruthy();
        expect(g.originRegion).toBeTruthy();
        expect(Array.isArray(g.tradeRoutes)).toBe(true);
        expect(Array.isArray(g.associatedLanguages)).toBe(true);
      }
    });

    it("filters by category", async () => {
      const spices = await storage.getTradeGoods({ category: "spice" });
      expect(spices.length).toBeGreaterThan(0);
      for (const g of spices) {
        expect(g.category).toBe("spice");
      }
    });
  });

  describe("getTradeRoutes", () => {
    it("loads trade routes from TSV", async () => {
      const routes = await storage.getTradeRoutes();
      expect(routes.length).toBeGreaterThanOrEqual(5);
    });

    it("returns routes with required fields", async () => {
      const routes = await storage.getTradeRoutes();
      for (const r of routes) {
        expect(r.id).toBeTruthy();
        expect(r.name).toBeTruthy();
        expect(r.routeType).toBeTruthy();
        expect(Array.isArray(r.tradedGoods)).toBe(true);
        expect(Array.isArray(r.keyCities)).toBe(true);
        expect(Array.isArray(r.associatedLanguages)).toBe(true);
      }
    });

    it("filters by route type", async () => {
      const maritime = await storage.getTradeRoutes("maritime");
      expect(maritime.length).toBeGreaterThan(0);
      for (const r of maritime) {
        expect(r.routeType).toBe("maritime");
      }
    });
  });

  describe("cross-referencing trade goods and routes", () => {
    it("trade routes reference valid trade good IDs", async () => {
      const goods = await storage.getTradeGoods();
      const routes = await storage.getTradeRoutes();
      const goodIds = new Set(goods.map((g) => g.id));

      // Report every dangling reference at once, named — a bare `expect(has).toBe(true)`
      // says only "expected false to be true" and hides how wide the breakage is.
      const dangling: string[] = [];
      for (const r of routes) {
        for (const goodId of r.tradedGoods) {
          if (!goodIds.has(goodId)) dangling.push(`${r.id} -> ${JSON.stringify(goodId)}`);
        }
      }
      expect(dangling).toEqual([]);
    });

    // tr-026..tr-039 shipped with good *names* ("grain", "textiles") in the id column, so
    // every reference dangled. Shape is the cheaper guard: a name can never look like an id,
    // so this bites even if a future batch happens to name a good that does exist.
    it("traded_goods holds tg-NNN ids, never good names", async () => {
      const routes = await storage.getTradeRoutes();
      const malformed = routes.flatMap((r) =>
        r.tradedGoods.filter((g) => !/^tg-\d{3}$/.test(g)).map((g) => `${r.id} -> ${JSON.stringify(g)}`),
      );
      expect(malformed).toEqual([]);
      expect(routes.some((r) => r.tradedGoods.length > 0)).toBe(true);
    });
  });

  describe("language-based filtering with trade data", () => {
    it("filters trade goods by known language IDs from trade data", async () => {
      const allGoods = await storage.getTradeGoods();
      // Use language IDs known to exist in trade-goods.tsv (ISO 639 codes)
      const filtered = filterTradeGoodsByLanguages(allGoods, ["lat", "arb"]);
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("filters trade routes by known language IDs from trade data", async () => {
      const allRoutes = await storage.getTradeRoutes();
      // Use language IDs known to exist in trade-routes.tsv
      const filtered = filterTradeRoutesByLanguages(allRoutes, ["arb", "cmn"]);
      expect(filtered.length).toBeGreaterThan(0);
    });

    it("returns empty when filtering with non-matching language IDs", async () => {
      const allGoods = await storage.getTradeGoods();
      const filtered = filterTradeGoodsByLanguages(allGoods, ["nonexistent-lang"]);
      expect(filtered.length).toBe(0);
    });
  });
});
