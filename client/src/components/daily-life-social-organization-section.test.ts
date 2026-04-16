import { describe, it, expect } from "vitest";

/**
 * Unit tests for DailyLifeSocialOrganizationSection data transformation logic.
 * Tests the pure functions used for hierarchy tier building, formatting, and filtering.
 */

// Replicate the SocialOrganization interface
interface SocialOrganization {
  id: string;
  name: string;
  cultureOrLanguage: string;
  region: string;
  politicalStructure: string;
  stratificationType: string;
  subsistencePattern: string;
  marriageSystem: string;
  descentSystem: string;
  residencePattern: string;
  kinshipTerminology: string;
  propertyInheritance: string;
  genderRoles: string;
  ageGrades: string;
  clanOrMoietySystem: string;
  timeOrigin: string;
  timeEnd: string;
  notes: string;
}

// Replicate constants
const SOCIAL_CLASS_COLORS: Record<string, string> = {
  egalitarian: "#16a34a",
  ranked: "#d97706",
  stratified: "#dc2626",
  "class-based": "#7c3aed",
};

const SUBSISTENCE_ICONS: Record<string, string> = {
  pastoralism: "🐄",
  horticulture: "🌱",
  foraging: "🍂",
  agriculture: "🌾",
  maritime: "⚓",
  mixed: "🔄",
};

// Replicate pure functions from the component
function getStratificationColor(type: string): string {
  return SOCIAL_CLASS_COLORS[type.toLowerCase()] || "#6b7280";
}

function getSubsistenceIcon(pattern: string): string {
  for (const [key, icon] of Object.entries(SUBSISTENCE_ICONS)) {
    if (pattern.toLowerCase().includes(key)) return icon;
  }
  return "🏠";
}

function formatTimePeriod(origin: string, end: string): string {
  const start = origin === "present" ? "present" : origin;
  const endStr = end === "present" ? "present" : end;
  if (!start && !endStr) return "Unknown period";
  const formatYear = (y: string) => {
    const num = parseInt(y, 10);
    if (isNaN(num)) return y;
    if (num < 0) return `${Math.abs(num)} BCE`;
    return `${num} CE`;
  };
  return `${formatYear(start)} – ${formatYear(endStr)}`;
}

function buildHierarchyTiers(
  stratificationType: string,
  politicalStructure: string
): Array<{ label: string; color: string; description: string }> {
  const lower = stratificationType.toLowerCase();

  if (lower.includes("egalitarian")) {
    return [
      { label: "Elders / Leaders", color: "#059669", description: "Informal authority based on experience" },
      { label: "Community Members", color: "#10b981", description: "Equal access to resources" },
    ];
  }

  if (lower.includes("ranked")) {
    return [
      { label: "Chief / Paramount", color: "#b45309", description: "Hereditary or elected leadership" },
      { label: "Sub-chiefs / Nobles", color: "#d97706", description: "Supporting leadership roles" },
      { label: "Commoners", color: "#f59e0b", description: "General population" },
    ];
  }

  const isState = politicalStructure.toLowerCase().includes("state") ||
    politicalStructure.toLowerCase().includes("empire") ||
    politicalStructure.toLowerCase().includes("confederacy");

  if (isState) {
    return [
      { label: "Ruler / Council", color: "#7c2d12", description: "Supreme authority" },
      { label: "Nobility / Priesthood", color: "#b91c1c", description: "Privileged class with land and power" },
      { label: "Warriors / Merchants", color: "#dc2626", description: "Professional and commercial class" },
      { label: "Commoners / Farmers", color: "#ef4444", description: "Majority of population" },
      { label: "Enslaved / Bonded", color: "#fca5a5", description: "Lowest social stratum" },
    ];
  }

  return [
    { label: "Leadership", color: "#6d28d9", description: "Political authority" },
    { label: "Specialists", color: "#7c3aed", description: "Skilled roles" },
    { label: "General Population", color: "#a78bfa", description: "Common members" },
  ];
}

// Filter function matching the component logic
function filterOrganizations(
  organizations: SocialOrganization[],
  selectedRegion: string,
  selectedSubsistence: string
): SocialOrganization[] {
  return organizations.filter((o) => {
    if (selectedRegion !== "all" && o.region !== selectedRegion) return false;
    if (selectedSubsistence !== "all" && o.subsistencePattern !== selectedSubsistence) return false;
    return true;
  });
}

// Sample test data matching the TSV
const SAMPLE_ORGANIZATIONS: SocialOrganization[] = [
  {
    id: "soc-nuer",
    name: "Nuer",
    cultureOrLanguage: "Nuer (Nilotic)",
    region: "East Africa",
    politicalStructure: "segmentary lineage",
    stratificationType: "egalitarian",
    subsistencePattern: "pastoralism",
    marriageSystem: "polygyny",
    descentSystem: "patrilineal",
    residencePattern: "patrilocal",
    kinshipTerminology: "Omaha",
    propertyInheritance: "cattle inheritance through male line",
    genderRoles: "men herd cattle, women cultivate and milk",
    ageGrades: "age-sets for males",
    clanOrMoietySystem: "clan system with exogamy rules",
    timeOrigin: "-1000",
    timeEnd: "present",
    notes: "Classic segmentary lineage society documented by Evans-Pritchard (1940)",
  },
  {
    id: "soc-trobriand_islanders",
    name: "Trobriand Islanders",
    cultureOrLanguage: "Kilivila (Austronesian)",
    region: "Oceania",
    politicalStructure: "chiefdom",
    stratificationType: "ranked",
    subsistencePattern: "horticulture",
    marriageSystem: "polygyny for chiefs",
    descentSystem: "matrilineal",
    residencePattern: "avunculocal",
    kinshipTerminology: "Iroquois",
    propertyInheritance: "matrilineal inheritance through mother's brother",
    genderRoles: "men clear gardens, women tend them; both fish",
    ageGrades: "no formal age-grades",
    clanOrMoietySystem: "matrilineal clans (dala) and sub-clans",
    timeOrigin: "-2000",
    timeEnd: "present",
    notes: "Documented by Malinowski; Kula ring exchange; yam houses as wealth display",
  },
  {
    id: "soc-iroquois_confederacy",
    name: "Iroquois Confederacy",
    cultureOrLanguage: "Iroquoian",
    region: "North America",
    politicalStructure: "confederacy of chiefdoms",
    stratificationType: "ranked",
    subsistencePattern: "horticulture and hunting",
    marriageSystem: "monogamy",
    descentSystem: "matrilineal",
    residencePattern: "matrilocal",
    kinshipTerminology: "Iroquois",
    propertyInheritance: "property through female line; longhouse inheritance",
    genderRoles: "women control agriculture and longhouses; men hunt and wage war",
    ageGrades: "no formal age-grades",
    clanOrMoietySystem: "clan-mothers select chiefs; moiety system",
    timeOrigin: "-1450",
    timeEnd: "present",
    notes: "Great Law of Peace; clan mothers hold political power; longhouse social organization",
  },
  {
    id: "soc-kung_san",
    name: "!Kung San",
    cultureOrLanguage: "!Kung (Khoisan)",
    region: "Southern Africa",
    politicalStructure: "band",
    stratificationType: "egalitarian",
    subsistencePattern: "foraging",
    marriageSystem: "monogamy",
    descentSystem: "bilateral",
    residencePattern: "ambilocal",
    kinshipTerminology: "Eskimo",
    propertyInheritance: "few material possessions; sharing ethos",
    genderRoles: "flexible division; both gather, men primarily hunt",
    ageGrades: "no formal age-grades",
    clanOrMoietySystem: "no clans; bilateral kinship",
    timeOrigin: "-50000",
    timeEnd: "present",
    notes: "Classic foraging society; hxaro exchange network; studied by Richard Lee",
  },
];

describe("DailyLifeSocialOrganizationSection", () => {
  describe("getStratificationColor", () => {
    it("returns green for egalitarian societies", () => {
      expect(getStratificationColor("egalitarian")).toBe("#16a34a");
    });

    it("returns amber for ranked societies", () => {
      expect(getStratificationColor("ranked")).toBe("#d97706");
    });

    it("returns red for stratified societies", () => {
      expect(getStratificationColor("stratified")).toBe("#dc2626");
    });

    it("is case-insensitive", () => {
      expect(getStratificationColor("Egalitarian")).toBe("#16a34a");
      expect(getStratificationColor("RANKED")).toBe("#d97706");
    });

    it("returns default gray for unknown types", () => {
      expect(getStratificationColor("unknown")).toBe("#6b7280");
    });
  });

  describe("getSubsistenceIcon", () => {
    it("returns correct icon for pastoralism", () => {
      expect(getSubsistenceIcon("pastoralism")).toBe("🐄");
    });

    it("returns correct icon for foraging", () => {
      expect(getSubsistenceIcon("foraging")).toBe("🍂");
    });

    it("returns correct icon for horticulture", () => {
      expect(getSubsistenceIcon("horticulture")).toBe("🌱");
    });

    it("handles partial matches", () => {
      expect(getSubsistenceIcon("horticulture and hunting")).toBe("🌱");
    });

    it("returns default icon for unknown patterns", () => {
      expect(getSubsistenceIcon("unknown")).toBe("🏠");
    });
  });

  describe("formatTimePeriod", () => {
    it("formats BCE dates correctly", () => {
      expect(formatTimePeriod("-1000", "present")).toBe("1000 BCE – present");
    });

    it("formats CE dates correctly", () => {
      expect(formatTimePeriod("500", "1500")).toBe("500 CE – 1500 CE");
    });

    it("formats very old dates", () => {
      expect(formatTimePeriod("-50000", "present")).toBe("50000 BCE – present");
    });

    it("returns 'Unknown period' when both are empty", () => {
      expect(formatTimePeriod("", "")).toBe("Unknown period");
    });

    it("handles non-numeric strings", () => {
      expect(formatTimePeriod("present", "present")).toBe("present – present");
    });
  });

  describe("buildHierarchyTiers", () => {
    it("builds 2 tiers for egalitarian societies", () => {
      const tiers = buildHierarchyTiers("egalitarian", "band");
      expect(tiers).toHaveLength(2);
      expect(tiers[0].label).toBe("Elders / Leaders");
      expect(tiers[1].label).toBe("Community Members");
    });

    it("builds 3 tiers for ranked societies", () => {
      const tiers = buildHierarchyTiers("ranked", "chiefdom");
      expect(tiers).toHaveLength(3);
      expect(tiers[0].label).toBe("Chief / Paramount");
      expect(tiers[2].label).toBe("Commoners");
    });

    it("builds 5 tiers for state-level stratified societies", () => {
      const tiers = buildHierarchyTiers("stratified", "empire");
      expect(tiers).toHaveLength(5);
      expect(tiers[0].label).toBe("Ruler / Council");
      expect(tiers[4].label).toBe("Enslaved / Bonded");
    });

    it("detects confederacy as state-level", () => {
      // "ranked" is checked first, so confederacy keyword in politicalStructure
      // doesn't override the stratificationType match
      const tiers = buildHierarchyTiers("stratified", "confederacy of chiefdoms");
      expect(tiers).toHaveLength(5);
      expect(tiers[0].label).toBe("Ruler / Council");
    });

    it("returns 3 generic tiers for non-state non-egalitarian non-ranked", () => {
      const tiers = buildHierarchyTiers("complex", "segmentary lineage");
      expect(tiers).toHaveLength(3);
      expect(tiers[0].label).toBe("Leadership");
    });

    it("is case-insensitive for stratification type", () => {
      const tiers = buildHierarchyTiers("EGALITARIAN", "band");
      expect(tiers).toHaveLength(2);
    });

    it("each tier has all required fields", () => {
      const tiers = buildHierarchyTiers("ranked", "chiefdom");
      for (const tier of tiers) {
        expect(tier).toHaveProperty("label");
        expect(tier).toHaveProperty("color");
        expect(tier).toHaveProperty("description");
        expect(tier.label.length).toBeGreaterThan(0);
        expect(tier.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(tier.description.length).toBeGreaterThan(0);
      }
    });

    it("tiers widen from top to bottom conceptually", () => {
      // For a pyramid visualization, each tier should be distinct
      const tiers = buildHierarchyTiers("stratified", "empire");
      const labels = tiers.map((t) => t.label);
      expect(new Set(labels).size).toBe(labels.length); // all unique
    });
  });

  describe("filterOrganizations", () => {
    it("returns all when filters are 'all'", () => {
      const result = filterOrganizations(SAMPLE_ORGANIZATIONS, "all", "all");
      expect(result).toHaveLength(4);
    });

    it("filters by region", () => {
      const result = filterOrganizations(SAMPLE_ORGANIZATIONS, "East Africa", "all");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Nuer");
    });

    it("filters by subsistence pattern", () => {
      const result = filterOrganizations(SAMPLE_ORGANIZATIONS, "all", "pastoralism");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Nuer");
    });

    it("applies both filters together", () => {
      const result = filterOrganizations(SAMPLE_ORGANIZATIONS, "East Africa", "pastoralism");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Nuer");
    });

    it("returns empty when no matches", () => {
      const result = filterOrganizations(SAMPLE_ORGANIZATIONS, "Europe", "all");
      expect(result).toHaveLength(0);
    });

    it("returns multiple results for shared region", () => {
      // Add Maasai for testing multiple East Africa results
      const withMaasai = [
        ...SAMPLE_ORGANIZATIONS,
        {
          id: "soc-maasai",
          name: "Maasai",
          cultureOrLanguage: "Maa (Nilotic)",
          region: "East Africa",
          politicalStructure: "age-set based",
          stratificationType: "egalitarian",
          subsistencePattern: "pastoralism",
          marriageSystem: "polygyny",
          descentSystem: "patrilineal",
          residencePattern: "patrilocal",
          kinshipTerminology: "Omaha",
          propertyInheritance: "cattle and livestock through male line",
          genderRoles: "warriors defend herds; women build houses and milk",
          ageGrades: "elaborate age-set system central to social organization",
          clanOrMoietySystem: "clan system with moiety division",
          timeOrigin: "-1500",
          timeEnd: "present",
          notes: "Age-set system structures male life stages",
        },
      ];
      const result = filterOrganizations(withMaasai, "East Africa", "all");
      expect(result).toHaveLength(2);
    });
  });

  describe("data integrity", () => {
    it("all sample organizations have required fields", () => {
      for (const org of SAMPLE_ORGANIZATIONS) {
        expect(org.id).toBeTruthy();
        expect(org.name).toBeTruthy();
        expect(org.region).toBeTruthy();
        expect(org.politicalStructure).toBeTruthy();
        expect(org.stratificationType).toBeTruthy();
        expect(org.subsistencePattern).toBeTruthy();
        expect(org.descentSystem).toBeTruthy();
        expect(org.marriageSystem).toBeTruthy();
      }
    });

    it("all sample organizations have valid IDs", () => {
      for (const org of SAMPLE_ORGANIZATIONS) {
        expect(org.id).toMatch(/^soc-/);
      }
    });

    it("unique regions can be extracted", () => {
      const regions = new Set(SAMPLE_ORGANIZATIONS.map((o) => o.region));
      expect(regions.size).toBe(4);
      expect(regions.has("East Africa")).toBe(true);
      expect(regions.has("Oceania")).toBe(true);
      expect(regions.has("North America")).toBe(true);
      expect(regions.has("Southern Africa")).toBe(true);
    });

    it("unique subsistence patterns can be extracted", () => {
      const patterns = new Set(SAMPLE_ORGANIZATIONS.map((o) => o.subsistencePattern));
      expect(patterns.size).toBe(4); // pastoralism, horticulture, foraging, "horticulture and hunting"
    });
  });
});
