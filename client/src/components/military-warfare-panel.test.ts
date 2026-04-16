import { describe, it, expect } from "vitest";

/**
 * Unit tests for MilitaryWarfarePanel helper functions and data structures.
 * Tests the formatting, color mapping, and outcome classification logic.
 */

// Replicate helper functions from the component for pure unit testing

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

const WAR_COLORS: Record<string, string> = {
  "Egyptian-Hittite Wars": "#d97706",
  "Greco-Persian Wars": "#2563eb",
  "Peloponnesian War": "#7c3aed",
  "Wars of Alexander the Great": "#16a34a",
  "Punic Wars": "#dc2626",
  "Gallic Wars": "#0891b2",
  "Roman Civil Wars": "#4f46e5",
  "Roman-Parthian Wars": "#db2777",
  "Jewish-Roman Wars": "#65a30d",
  "Gothic Wars": "#c026d3",
  "Arab Conquests": "#ea580c",
  "Crusades": "#0d9488",
  "Mongol Conquests": "#b91c1c",
  "Hundred Years' War": "#1d4ed8",
  "Ottoman Conquests": "#047857",
};

function getWarColor(warName: string): string {
  return WAR_COLORS[warName] || "#6b7280";
}

function getOutcomeStyle(outcome: string): { bg: string; text: string } {
  const lower = outcome.toLowerCase();
  if (lower.includes("decisive") && lower.includes("victory")) {
    return { bg: "bg-green-100", text: "text-green-800" };
  }
  if (lower.includes("victory")) {
    return { bg: "bg-blue-100", text: "text-blue-800" };
  }
  if (lower.includes("stalemate") || lower.includes("inconclusive")) {
    return { bg: "bg-yellow-100", text: "text-yellow-800" };
  }
  if (lower.includes("defeat") || lower.includes("destruction")) {
    return { bg: "bg-red-100", text: "text-red-800" };
  }
  return { bg: "bg-gray-100", text: "text-gray-800" };
}

interface Battle {
  id: string;
  name: string;
  date: string;
  coordinates: [number, number];
  belligerents: Array<{ name: string; civilization_id: string | null }>;
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

describe("MilitaryWarfarePanel helpers", () => {
  describe("formatYear", () => {
    it("formats BCE years correctly", () => {
      expect(formatYear(-490)).toBe("490 BCE");
      expect(formatYear(-1274)).toBe("1274 BCE");
    });

    it("formats CE years correctly", () => {
      expect(formatYear(476)).toBe("476 CE");
      expect(formatYear(1453)).toBe("1453 CE");
    });

    it("formats year 0 as CE", () => {
      expect(formatYear(0)).toBe("0 CE");
    });
  });

  describe("getWarColor", () => {
    it("returns correct color for known wars", () => {
      expect(getWarColor("Greco-Persian Wars")).toBe("#2563eb");
      expect(getWarColor("Punic Wars")).toBe("#dc2626");
      expect(getWarColor("Crusades")).toBe("#0d9488");
    });

    it("returns gray for unknown wars", () => {
      expect(getWarColor("Unknown War")).toBe("#6b7280");
      expect(getWarColor("")).toBe("#6b7280");
    });

    it("has colors for all 15 defined wars", () => {
      expect(Object.keys(WAR_COLORS)).toHaveLength(15);
    });
  });

  describe("getOutcomeStyle", () => {
    it("returns green for decisive victories", () => {
      const style = getOutcomeStyle("Decisive Greek victory");
      expect(style.bg).toBe("bg-green-100");
      expect(style.text).toBe("text-green-800");
    });

    it("returns blue for regular victories", () => {
      const style = getOutcomeStyle("Roman victory");
      expect(style.bg).toBe("bg-blue-100");
      expect(style.text).toBe("text-blue-800");
    });

    it("returns yellow for stalemates", () => {
      const style = getOutcomeStyle("Stalemate");
      expect(style.bg).toBe("bg-yellow-100");
      expect(style.text).toBe("text-yellow-800");
    });

    it("returns yellow for inconclusive results", () => {
      const style = getOutcomeStyle("Inconclusive");
      expect(style.bg).toBe("bg-yellow-100");
      expect(style.text).toBe("text-yellow-800");
    });

    it("returns red for defeats", () => {
      const style = getOutcomeStyle("Greek strategic defeat, Persian advance delayed");
      expect(style.bg).toBe("bg-red-100");
      expect(style.text).toBe("text-red-800");
    });

    it("returns gray for unrecognized outcomes", () => {
      const style = getOutcomeStyle("Treaty signed");
      expect(style.bg).toBe("bg-gray-100");
      expect(style.text).toBe("text-gray-800");
    });
  });

  describe("Battle interface", () => {
    it("validates a complete battle object", () => {
      const battle: Battle = {
        id: "battle-marathon",
        name: "Battle of Marathon",
        date: "-490",
        coordinates: [38.1133, 23.9683],
        belligerents: [
          { name: "Athenian city-state", civilization_id: "ancient-greece" },
          { name: "Achaemenid Empire", civilization_id: "persian-empire" },
        ],
        outcome: "Decisive Greek victory",
        casualtiesEstimate: "~7000",
        significance: "First major Greek victory over Persians",
        associatedLanguageChanges: "Greek preserved as language of democratic governance",
        warName: "Greco-Persian Wars",
      };

      expect(battle.id).toBe("battle-marathon");
      expect(battle.belligerents).toHaveLength(2);
      expect(battle.coordinates).toHaveLength(2);
      expect(parseInt(battle.date)).toBe(-490);
    });
  });

  describe("filtering logic", () => {
    const sampleBattles: Battle[] = [
      {
        id: "b1",
        name: "Battle of Marathon",
        date: "-490",
        coordinates: [38.11, 23.97],
        belligerents: [
          { name: "Athens", civilization_id: "ancient-greece" },
          { name: "Persia", civilization_id: "persian-empire" },
        ],
        outcome: "Decisive Greek victory",
        casualtiesEstimate: "~7000",
        significance: "First major Greek victory",
        associatedLanguageChanges: "",
        warName: "Greco-Persian Wars",
      },
      {
        id: "b2",
        name: "Battle of Cannae",
        date: "-216",
        coordinates: [41.31, 16.13],
        belligerents: [
          { name: "Carthage", civilization_id: "carthage" },
          { name: "Rome", civilization_id: "roman-republic" },
        ],
        outcome: "Decisive Carthaginian victory",
        casualtiesEstimate: "~70000",
        significance: "Worst Roman defeat",
        associatedLanguageChanges: "",
        warName: "Punic Wars",
      },
      {
        id: "b3",
        name: "Battle of Zama",
        date: "-202",
        coordinates: [36.39, 8.12],
        belligerents: [
          { name: "Rome", civilization_id: "roman-republic" },
          { name: "Carthage", civilization_id: "carthage" },
        ],
        outcome: "Decisive Roman victory",
        casualtiesEstimate: "~20000",
        significance: "Ended Second Punic War",
        associatedLanguageChanges: "",
        warName: "Punic Wars",
      },
    ];

    it("filters battles by war name", () => {
      const filtered = sampleBattles.filter((b) => b.warName === "Punic Wars");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((b) => b.warName === "Punic Wars")).toBe(true);
    });

    it("returns all battles when filter is 'all'", () => {
      const selectedWar = "all";
      const filtered = selectedWar === "all"
        ? sampleBattles
        : sampleBattles.filter((b) => b.warName === selectedWar);
      expect(filtered).toHaveLength(3);
    });

    it("sorts battles chronologically", () => {
      const sorted = [...sampleBattles].sort(
        (a, b) => parseInt(a.date) - parseInt(b.date)
      );
      expect(sorted[0].id).toBe("b1"); // -490
      expect(sorted[1].id).toBe("b2"); // -216
      expect(sorted[2].id).toBe("b3"); // -202
    });

    it("extracts unique war names", () => {
      const warSet = new Set<string>();
      sampleBattles.forEach((b) => warSet.add(b.warName));
      const wars = Array.from(warSet).sort();
      expect(wars).toHaveLength(2);
      expect(wars).toContain("Greco-Persian Wars");
      expect(wars).toContain("Punic Wars");
    });
  });
});
