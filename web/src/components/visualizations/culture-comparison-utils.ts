import type { CultureProfile } from "@contracts/types";

export const MAX_COMPARE = 4;
export const MIN_COMPARE = 2;

export const SOCIAL_ORG_LABELS: Record<string, string> = {
  egalitarian: "Egalitarian",
  chiefdom: "Chiefdom",
  state: "State",
  empire: "Empire",
};

export const SUBSISTENCE_LABELS: Record<string, string> = {
  "hunter-gatherer": "Hunter-Gatherer",
  pastoral: "Pastoral",
  agricultural: "Agricultural",
  maritime: "Maritime",
  mixed: "Mixed",
};

export const URBANISM_LABELS: Record<string, string> = {
  nomadic: "Nomadic",
  village: "Village",
  town: "Town",
  "city-state": "City-State",
  metropolis: "Metropolis",
};

export const TECH_LABELS: Record<string, string> = {
  stone: "Stone Age",
  copper: "Copper Age",
  bronze: "Bronze Age",
  iron: "Iron Age",
  steel: "Steel Age",
  industrial: "Industrial",
};

export const TECH_RANK: Record<string, number> = {
  stone: 0,
  copper: 1,
  bronze: 2,
  iron: 3,
  steel: 4,
  industrial: 5,
};

export const URBANISM_RANK: Record<string, number> = {
  nomadic: 0,
  village: 1,
  town: 2,
  "city-state": 3,
  metropolis: 4,
};

export function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function formatTimePeriod(start: number, end: number): string {
  return `${formatYear(start)} – ${formatYear(end)}`;
}

export function formatPopulation(pop: number | null): string {
  if (pop === null) return "Unknown";
  if (pop >= 1_000_000) {
    return `${(pop / 1_000_000).toFixed(pop % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(0)}K`;
  return pop.toLocaleString();
}

export interface ComparisonDimension {
  key: string;
  label: string;
  category: string;
  getValue: (profile: CultureProfile) => string;
}

export const COMPARISON_DIMENSIONS: ComparisonDimension[] = [
  {
    key: "region",
    label: "Region",
    category: "Geography",
    getValue: (p) => p.region,
  },
  {
    key: "timePeriod",
    label: "Time Period",
    category: "Geography",
    getValue: (p) => formatTimePeriod(p.timePeriodStart, p.timePeriodEnd),
  },
  {
    key: "socialOrganization",
    label: "Social Organization",
    category: "Society",
    getValue: (p) =>
      SOCIAL_ORG_LABELS[p.socialOrganization] ?? p.socialOrganization,
  },
  {
    key: "urbanismLevel",
    label: "Urbanism",
    category: "Society",
    getValue: (p) => URBANISM_LABELS[p.urbanismLevel] ?? p.urbanismLevel,
  },
  {
    key: "subsistenceType",
    label: "Subsistence",
    category: "Society",
    getValue: (p) =>
      SUBSISTENCE_LABELS[p.subsistenceType] ?? p.subsistenceType,
  },
  {
    key: "population",
    label: "Population",
    category: "Society",
    getValue: (p) => formatPopulation(p.populationEstimate),
  },
  {
    key: "technologyLevel",
    label: "Technology Level",
    category: "Technology",
    getValue: (p) => TECH_LABELS[p.technologyLevel] ?? p.technologyLevel,
  },
  {
    key: "languages",
    label: "Languages",
    category: "Language & Writing",
    getValue: (p) =>
      p.associatedLanguageIds.length > 0
        ? p.associatedLanguageIds.join(", ")
        : "—",
  },
  {
    key: "writingSystems",
    label: "Writing Systems",
    category: "Language & Writing",
    getValue: (p) =>
      p.associatedWritingSystemIds.length > 0
        ? p.associatedWritingSystemIds.join(", ")
        : "—",
  },
  {
    key: "literaryTraditions",
    label: "Literary Traditions",
    category: "Language & Writing",
    getValue: (p) =>
      p.associatedLiteraryTraditionIds.length > 0
        ? p.associatedLiteraryTraditionIds.join(", ")
        : "—",
  },
  {
    key: "religions",
    label: "Religions",
    category: "Religion",
    getValue: (p) =>
      p.associatedReligionIds.length > 0
        ? p.associatedReligionIds.join(", ")
        : "—",
  },
  {
    key: "architecture",
    label: "Architectural Styles",
    category: "Architecture",
    getValue: (p) =>
      p.associatedArchitecturalStyleIds.length > 0
        ? p.associatedArchitecturalStyleIds.join(", ")
        : "—",
  },
  {
    key: "artTraditions",
    label: "Art Traditions",
    category: "Material Culture",
    getValue: (p) =>
      p.associatedArtTraditionIds.length > 0
        ? p.associatedArtTraditionIds.join(", ")
        : "—",
  },
  {
    key: "musicTraditions",
    label: "Musical Traditions",
    category: "Material Culture",
    getValue: (p) =>
      p.associatedMusicTraditionIds.length > 0
        ? p.associatedMusicTraditionIds.join(", ")
        : "—",
  },
  {
    key: "cuisine",
    label: "Cuisine",
    category: "Material Culture",
    getValue: (p) => p.associatedCuisineId ?? "—",
  },
  {
    key: "notableSettlements",
    label: "Notable Settlements",
    category: "Geography",
    getValue: (p) =>
      p.notableSettlements.length > 0
        ? p.notableSettlements.join(", ")
        : "—",
  },
];

export function getCategories(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dim of COMPARISON_DIMENSIONS) {
    if (!seen.has(dim.category)) {
      seen.add(dim.category);
      out.push(dim.category);
    }
  }
  return out;
}

export function getDimensionsByCategory(category: string): ComparisonDimension[] {
  return COMPARISON_DIMENSIONS.filter((d) => d.category === category);
}

export type CellMatchState = "all-match" | "all-differ" | "partial";

export function rowMatchState(values: string[]): CellMatchState {
  if (values.length <= 1) return "all-match";
  const first = values[0];
  if (values.every((v) => v === first)) return "all-match";
  const unique = new Set(values);
  if (unique.size === values.length) return "all-differ";
  return "partial";
}

export function sharedArrayOverlap(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

export function computeSharedTraits(
  profiles: CultureProfile[]
): Record<string, string[]> {
  if (profiles.length < 2) return {};
  const intersect = (arr: string[][]): string[] => {
    if (arr.length === 0) return [];
    let acc = new Set(arr[0]);
    for (let i = 1; i < arr.length; i++) {
      const next = new Set(arr[i]);
      acc = new Set(Array.from(acc).filter((x) => next.has(x)));
    }
    return Array.from(acc);
  };
  return {
    languages: intersect(profiles.map((p) => p.associatedLanguageIds)),
    religions: intersect(profiles.map((p) => p.associatedReligionIds)),
    writingSystems: intersect(profiles.map((p) => p.associatedWritingSystemIds)),
    artTraditions: intersect(profiles.map((p) => p.associatedArtTraditionIds)),
    architecturalStyles: intersect(
      profiles.map((p) => p.associatedArchitecturalStyleIds)
    ),
    musicTraditions: intersect(
      profiles.map((p) => p.associatedMusicTraditionIds)
    ),
    literaryTraditions: intersect(
      profiles.map((p) => p.associatedLiteraryTraditionIds)
    ),
  };
}

export function searchProfiles(
  profiles: CultureProfile[],
  query: string
): CultureProfile[] {
  const q = query.trim().toLowerCase();
  if (!q) return profiles;
  return profiles.filter((p) => {
    if (p.name.toLowerCase().includes(q)) return true;
    if (p.region.toLowerCase().includes(q)) return true;
    return p.alternateNames.some((n) => n.toLowerCase().includes(q));
  });
}
