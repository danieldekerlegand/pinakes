import { describe, it, expect } from "vitest";
import type {
  TradeGood,
  TradeRoute,
} from "../web/src/components/culture-profile/economy-trade-utils";
import {
  filterTradeGoodsByLanguages,
  filterTradeRoutesByLanguages,
  getUniqueCategories,
  getUniqueRouteTypes,
  formatTradeYear,
  CATEGORY_COLORS,
} from "../web/src/components/culture-profile/economy-trade-utils";

// The corpus-integration half of this file (a `TsvStorage`-backed "Data Layer"
// suite) retired with the Express backend in tasks/chief/80-cutover.json US-2.
// The corpus is read by the Python service now, and services/api/tests/test_domain_routes.py (trade goods + trade routes)
// asserts the same rows against the live TSVs. What stays here is what this file
// is actually about: the pure client-side helpers.

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
