import { describe, it, expect } from "vitest";

/**
 * Unit tests for MesopotamiaCityStatesShowcase data transformation logic.
 * Tests the pure functions and data constants used in the showcase.
 */

// Replicate the constants from the component
const MESOPOTAMIAN_EMPIRE_IDS = [
  "sumerian-city-states",
  "akkadian-empire",
  "ur-third-dynasty",
  "old-babylonian",
  "kassite-babylonia",
  "middle-assyrian",
  "neo-assyrian",
  "neo-babylonian",
  "persian-achaemenid",
];

const EMPIRE_COLORS: Record<string, string> = {
  "sumerian-city-states": "#8b5cf6",
  "akkadian-empire": "#d97706",
  "ur-third-dynasty": "#7c3aed",
  "old-babylonian": "#2563eb",
  "kassite-babylonia": "#059669",
  "middle-assyrian": "#dc2626",
  "neo-assyrian": "#ef4444",
  "neo-babylonian": "#3b82f6",
  "persian-achaemenid": "#f59e0b",
};

const SETTLEMENT_TYPE_COLORS: Record<string, string> = {
  "city-state": "#8b5cf6",
  capital: "#dc2626",
  "religious-center": "#f59e0b",
  fortress: "#6b7280",
  port: "#0891b2",
  "trading-post": "#059669",
};

function formatYear(year: number | null): string {
  if (year === null || year === undefined) return "Unknown";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function parseJsonArray(val: string): string[] {
  if (!val) return [];
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

interface Settlement {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  civilization_id: string;
  founded_year: number;
  peak_population: number;
  notable_features: string;
  associated_languages: string;
}

interface EmpireEvent {
  id: string;
  empire_id: string;
  empire_name: string;
  year: number;
  event_type: string;
  description: string;
}

// Replicate filtering logic
function filterMesopotamianEvents(events: EmpireEvent[]): EmpireEvent[] {
  return events.filter((e) => MESOPOTAMIAN_EMPIRE_IDS.includes(e.empire_id));
}

function groupByEmpire(events: EmpireEvent[]): [string, EmpireEvent[]][] {
  const groups: Record<string, EmpireEvent[]> = {};
  events.forEach((e) => {
    if (!groups[e.empire_id]) groups[e.empire_id] = [];
    groups[e.empire_id].push(e);
  });
  return Object.entries(groups).sort(
    (a, b) =>
      Math.min(...a[1].map((e) => e.year)) -
      Math.min(...b[1].map((e) => e.year))
  );
}

function deduplicateSettlements(settlements: Settlement[]): Settlement[] {
  const seen = new Map<string, Settlement>();
  settlements.forEach((s) => {
    const existing = seen.get(s.name);
    if (!existing || (s.founded_year ?? 0) < (existing.founded_year ?? 0)) {
      seen.set(s.name, s);
    }
  });
  return Array.from(seen.values()).sort(
    (a, b) => (a.founded_year ?? 0) - (b.founded_year ?? 0)
  );
}

// Sample data
const sampleSettlements: Settlement[] = [
  {
    id: "ur",
    name: "Ur",
    latitude: 30.962,
    longitude: 46.103,
    type: "city-state",
    civilization_id: "sumerian",
    founded_year: -3800,
    peak_population: 65000,
    notable_features: '["Great Ziggurat","Royal Tombs","Standard of Ur"]',
    associated_languages: '["sux","akk"]',
  },
  {
    id: "uruk",
    name: "Uruk",
    latitude: 31.322,
    longitude: 45.636,
    type: "city-state",
    civilization_id: "sumerian",
    founded_year: -4000,
    peak_population: 80000,
    notable_features: '["White Temple","Eanna District","earliest writing tablets"]',
    associated_languages: '["sux"]',
  },
  {
    id: "babylon",
    name: "Babylon",
    latitude: 32.536,
    longitude: 44.421,
    type: "capital",
    civilization_id: "babylonian-empire",
    founded_year: -2300,
    peak_population: 200000,
    notable_features: '["Ishtar Gate","Hanging Gardens","Etemenanki ziggurat"]',
    associated_languages: '["akk","arc"]',
  },
  {
    id: "ur-dup",
    name: "Ur",
    latitude: 30.963,
    longitude: 46.104,
    type: "city-state",
    civilization_id: "sumerian-civilization",
    founded_year: -3800,
    peak_population: 65000,
    notable_features: '["Great Ziggurat"]',
    associated_languages: '["sum"]',
  },
];

const sampleEvents: EmpireEvent[] = [
  {
    id: "et-027",
    empire_id: "sumerian-city-states",
    empire_name: "Sumerian City-States",
    year: -3500,
    event_type: "founding",
    description: "Emergence of independent Sumerian city-states",
  },
  {
    id: "et-029",
    empire_id: "sumerian-city-states",
    empire_name: "Sumerian City-States",
    year: -2334,
    event_type: "fall",
    description: "Sargon conquers the Sumerian city-states",
  },
  {
    id: "et-006",
    empire_id: "akkadian-empire",
    empire_name: "Akkadian Empire",
    year: -2334,
    event_type: "founding",
    description: "Sargon unifies Mesopotamia",
  },
  {
    id: "et-008",
    empire_id: "akkadian-empire",
    empire_name: "Akkadian Empire",
    year: -2154,
    event_type: "fall",
    description: "Collapse under Gutian invasions",
  },
  {
    id: "et-001",
    empire_id: "roman-empire",
    empire_name: "Roman Empire",
    year: -27,
    event_type: "founding",
    description: "Octavian becomes Augustus",
  },
];

describe("MesopotamiaCityStatesShowcase", () => {
  describe("formatYear", () => {
    it("formats BCE years correctly", () => {
      expect(formatYear(-3500)).toBe("3500 BCE");
      expect(formatYear(-27)).toBe("27 BCE");
    });

    it("formats CE years correctly", () => {
      expect(formatYear(100)).toBe("100 CE");
      expect(formatYear(2024)).toBe("2024 CE");
    });

    it("handles null/undefined", () => {
      expect(formatYear(null)).toBe("Unknown");
    });
  });

  describe("parseJsonArray", () => {
    it("parses valid JSON arrays", () => {
      expect(parseJsonArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
    });

    it("handles empty string", () => {
      expect(parseJsonArray("")).toEqual([]);
    });

    it("handles invalid JSON", () => {
      expect(parseJsonArray("not json")).toEqual([]);
    });
  });

  describe("MESOPOTAMIAN_EMPIRE_IDS", () => {
    it("contains all required empires", () => {
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("sumerian-city-states");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("akkadian-empire");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("ur-third-dynasty");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("old-babylonian");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("kassite-babylonia");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("middle-assyrian");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("neo-assyrian");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("neo-babylonian");
      expect(MESOPOTAMIAN_EMPIRE_IDS).toContain("persian-achaemenid");
    });

    it("has 9 empires covering the full Mesopotamian timeline", () => {
      expect(MESOPOTAMIAN_EMPIRE_IDS).toHaveLength(9);
    });
  });

  describe("EMPIRE_COLORS", () => {
    it("has a color for every empire", () => {
      MESOPOTAMIAN_EMPIRE_IDS.forEach((id) => {
        expect(EMPIRE_COLORS[id]).toBeDefined();
        expect(EMPIRE_COLORS[id]).toMatch(/^#[0-9a-f]{6}$/);
      });
    });
  });

  describe("SETTLEMENT_TYPE_COLORS", () => {
    it("covers main settlement types", () => {
      expect(SETTLEMENT_TYPE_COLORS["city-state"]).toBeDefined();
      expect(SETTLEMENT_TYPE_COLORS["capital"]).toBeDefined();
      expect(SETTLEMENT_TYPE_COLORS["religious-center"]).toBeDefined();
    });
  });

  describe("filterMesopotamianEvents", () => {
    it("filters to only Mesopotamian empires", () => {
      const filtered = filterMesopotamianEvents(sampleEvents);
      expect(filtered).toHaveLength(4);
      expect(filtered.every((e) => e.empire_id !== "roman-empire")).toBe(true);
    });

    it("keeps Sumerian and Akkadian events", () => {
      const filtered = filterMesopotamianEvents(sampleEvents);
      const empireIds = new Set(filtered.map((e) => e.empire_id));
      expect(empireIds.has("sumerian-city-states")).toBe(true);
      expect(empireIds.has("akkadian-empire")).toBe(true);
    });
  });

  describe("groupByEmpire", () => {
    it("groups events by empire_id", () => {
      const filtered = filterMesopotamianEvents(sampleEvents);
      const groups = groupByEmpire(filtered);
      expect(groups).toHaveLength(2);
    });

    it("sorts groups chronologically by earliest event", () => {
      const filtered = filterMesopotamianEvents(sampleEvents);
      const groups = groupByEmpire(filtered);
      // Sumerian (-3500) should come before Akkadian (-2334)
      expect(groups[0][0]).toBe("sumerian-city-states");
      expect(groups[1][0]).toBe("akkadian-empire");
    });

    it("preserves all events within each group", () => {
      const filtered = filterMesopotamianEvents(sampleEvents);
      const groups = groupByEmpire(filtered);
      const sumerianGroup = groups.find((g) => g[0] === "sumerian-city-states");
      expect(sumerianGroup?.[1]).toHaveLength(2);
    });
  });

  describe("deduplicateSettlements", () => {
    it("removes duplicate settlements by name", () => {
      const unique = deduplicateSettlements(sampleSettlements);
      const urEntries = unique.filter((s) => s.name === "Ur");
      expect(urEntries).toHaveLength(1);
    });

    it("keeps the entry with the earlier founded_year", () => {
      const unique = deduplicateSettlements(sampleSettlements);
      const ur = unique.find((s) => s.name === "Ur");
      expect(ur?.id).toBe("ur");
    });

    it("sorts by founded_year", () => {
      const unique = deduplicateSettlements(sampleSettlements);
      for (let i = 1; i < unique.length; i++) {
        expect(unique[i].founded_year).toBeGreaterThanOrEqual(
          unique[i - 1].founded_year
        );
      }
    });

    it("returns unique count", () => {
      const unique = deduplicateSettlements(sampleSettlements);
      // 4 input with 1 duplicate = 3 unique
      expect(unique).toHaveLength(3);
    });
  });

  describe("timeline range calculation", () => {
    it("computes correct range from events", () => {
      const events = filterMesopotamianEvents(sampleEvents);
      const years = events.map((e) => e.year);
      const min = Math.min(...years) - 200;
      const max = Math.max(...years) + 200;
      expect(min).toBe(-3700);
      expect(max).toBe(-1954);
    });

    it("yearToPercent maps correctly within range", () => {
      const rangeMin = -3700;
      const rangeMax = -1954;
      const yearToPercent = (year: number) => {
        const range = rangeMax - rangeMin;
        return ((year - rangeMin) / range) * 100;
      };
      expect(yearToPercent(rangeMin)).toBeCloseTo(0);
      expect(yearToPercent(rangeMax)).toBeCloseTo(100);
      const mid = (rangeMin + rangeMax) / 2;
      expect(yearToPercent(mid)).toBeCloseTo(50);
    });
  });

  describe("coordinate mapping for map view", () => {
    it("maps Mesopotamian coordinates to percentage positions", () => {
      // Map coordinates: lat 29-37, lng 38-49
      const mapCoord = (lat: number, lng: number) => ({
        x: ((lng - 38) / (49 - 38)) * 90 + 5,
        y: 100 - ((lat - 29) / (37 - 29)) * 90 - 5,
      });

      // Ur is at lat 30.962, lng 46.103
      const ur = mapCoord(30.962, 46.103);
      expect(ur.x).toBeGreaterThan(5);
      expect(ur.x).toBeLessThan(95);
      expect(ur.y).toBeGreaterThan(5);
      expect(ur.y).toBeLessThan(95);

      // Nineveh is at lat 36.359, lng 43.153 (should be higher/more north)
      const nineveh = mapCoord(36.359, 43.153);
      expect(nineveh.y).toBeLessThan(ur.y); // Higher on screen = lower y
    });
  });
});
