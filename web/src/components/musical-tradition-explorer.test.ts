import { describe, it, expect } from "vitest";
import type { NetworkGraphNode, NetworkGraphEdge } from "./visualizations/shared/NetworkGraph";
import type { GeoPoint } from "./visualizations/shared/GeoDistributionMap";

/**
 * Unit tests for MusicalTraditionExplorer data transformation logic.
 * Tests the pure functions used to convert music tradition data into
 * NetworkGraph and GeoDistributionMap formats.
 */

// Replicate the core data types
interface MusicTradition {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  instruments: string[];
  scales: string[];
  rhythmicPatterns: string[];
  relatedTraditions: string[];
  description: string;
  sources: string[];
}

// Replicate format helpers
function formatYear(year: number | null): string {
  if (year === null) return "present";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatPeriod(start: number | null, end: number | null): string {
  if (start === null && end === null) return "Unknown period";
  return `${formatYear(start)} – ${formatYear(end)}`;
}

// Replicate region color lookup
const REGION_COLORS: Record<string, string> = {
  "East Asia": "#c026d3",
  "South Asia": "#e11d48",
  "Southeast Asia": "#f59e0b",
  "Middle East": "#0891b2",
  "West Africa": "#16a34a",
};

function getRegionColor(region: string): string {
  for (const [key, color] of Object.entries(REGION_COLORS)) {
    if (region.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return "#6b7280";
}

// Replicate network data transformation
function buildNetworkData(traditions: MusicTradition[]): {
  nodes: NetworkGraphNode[];
  edges: NetworkGraphEdge[];
} {
  const filteredIds = new Set(traditions.map(t => t.id));
  const nodes: NetworkGraphNode[] = traditions.map(t => ({
    id: t.id,
    label: t.name,
    category: t.region,
    size: 4 + Math.min(t.instruments.length + t.relatedTraditions.length, 12),
    metadata: {
      period: formatPeriod(t.timeOrigin, t.timeEnd),
      instruments: t.instruments.length,
      scales: t.scales.join(", "),
    },
  }));

  const edges: NetworkGraphEdge[] = [];
  const edgeSet = new Set<string>();
  for (const t of traditions) {
    for (const rel of t.relatedTraditions) {
      if (!filteredIds.has(rel)) continue;
      const key = [t.id, rel].sort().join("-");
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ source: t.id, target: rel, weight: 1 });
    }
  }
  return { nodes, edges };
}

// Replicate geo data transformation
function buildGeoPoints(traditions: MusicTradition[]): GeoPoint[] {
  return traditions.map(t => ({
    id: t.id,
    lat: t.coordinates.lat,
    lng: t.coordinates.lng,
    label: t.name,
    category: t.region,
    metadata: {
      period: formatPeriod(t.timeOrigin, t.timeEnd),
      instruments: t.instruments.length,
    },
  }));
}

// Replicate filter logic
function filterTraditions(
  traditions: MusicTradition[],
  region: string,
  query: string
): MusicTradition[] {
  let result = traditions;
  if (region !== "all") {
    result = result.filter(t => t.region === region);
  }
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.nativeName.toLowerCase().includes(q) ||
      t.region.toLowerCase().includes(q) ||
      t.instruments.some(i => i.toLowerCase().includes(q)) ||
      t.scales.some(s => s.toLowerCase().includes(q))
    );
  }
  return result;
}

// Sample test data
const SAMPLE_TRADITIONS: MusicTradition[] = [
  {
    id: "gamelan",
    name: "Gamelan",
    nativeName: "Gamelan",
    region: "Southeast Asia",
    coordinates: { lat: -7.6, lng: 110.2 },
    timeOrigin: -200,
    timeEnd: null,
    associatedLanguageIds: ["javanese", "sundanese", "balinese"],
    instruments: ["gamelan-gong", "bonang", "saron", "kendang"],
    scales: ["pelog", "slendro"],
    rhythmicPatterns: ["colotomic"],
    relatedTraditions: ["indian-classical"],
    description: "Javanese and Balinese ensemble music",
    sources: ["Ethnomusicological research"],
  },
  {
    id: "indian-classical",
    name: "Indian Classical",
    nativeName: "Shastriya Sangeet",
    region: "South Asia",
    coordinates: { lat: 28.6, lng: 77.2 },
    timeOrigin: -1500,
    timeEnd: null,
    associatedLanguageIds: ["hindi", "sanskrit"],
    instruments: ["sitar", "tabla", "tanpura"],
    scales: ["raga"],
    rhythmicPatterns: ["tala"],
    relatedTraditions: ["gamelan"],
    description: "Ancient musical tradition of the Indian subcontinent",
    sources: [],
  },
  {
    id: "griot",
    name: "Griot Tradition",
    nativeName: "Jeli",
    region: "West Africa",
    coordinates: { lat: 12.6, lng: -8.0 },
    timeOrigin: 1235,
    timeEnd: null,
    associatedLanguageIds: ["mandinka", "bambara"],
    instruments: ["kora", "balafon", "ngoni"],
    scales: ["pentatonic"],
    rhythmicPatterns: ["polyrhythmic"],
    relatedTraditions: [],
    description: "West African storytelling and musical tradition",
    sources: [],
  },
];

describe("MusicalTraditionExplorer - formatYear", () => {
  it("formats BCE years", () => {
    expect(formatYear(-200)).toBe("200 BCE");
    expect(formatYear(-1500)).toBe("1500 BCE");
  });

  it("formats CE years", () => {
    expect(formatYear(1235)).toBe("1235 CE");
    expect(formatYear(2000)).toBe("2000 CE");
  });

  it("formats null as present", () => {
    expect(formatYear(null)).toBe("present");
  });
});

describe("MusicalTraditionExplorer - formatPeriod", () => {
  it("formats known periods", () => {
    expect(formatPeriod(-200, null)).toBe("200 BCE – present");
    expect(formatPeriod(1200, 1800)).toBe("1200 CE – 1800 CE");
  });

  it("handles unknown periods", () => {
    expect(formatPeriod(null, null)).toBe("Unknown period");
  });
});

describe("MusicalTraditionExplorer - getRegionColor", () => {
  it("returns known region colors", () => {
    expect(getRegionColor("East Asia")).toBe("#c026d3");
    expect(getRegionColor("South Asia")).toBe("#e11d48");
  });

  it("returns default for unknown regions", () => {
    expect(getRegionColor("Antarctica")).toBe("#6b7280");
  });

  it("matches partial region names", () => {
    expect(getRegionColor("Western West Africa")).toBe("#16a34a");
  });
});

describe("MusicalTraditionExplorer - filterTraditions", () => {
  it("returns all traditions when no filter", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "all", "");
    expect(result).toHaveLength(3);
  });

  it("filters by region", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "South Asia", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("indian-classical");
  });

  it("filters by name search", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "all", "gamelan");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("gamelan");
  });

  it("filters by instrument search", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "all", "sitar");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("indian-classical");
  });

  it("filters by scale search", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "all", "pentatonic");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("griot");
  });

  it("combines region and text filters", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "Southeast Asia", "bonang");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("gamelan");
  });

  it("returns empty when nothing matches", () => {
    const result = filterTraditions(SAMPLE_TRADITIONS, "all", "nonexistent");
    expect(result).toHaveLength(0);
  });
});

describe("MusicalTraditionExplorer - buildNetworkData", () => {
  it("creates nodes for each tradition", () => {
    const { nodes } = buildNetworkData(SAMPLE_TRADITIONS);
    expect(nodes).toHaveLength(3);
    expect(nodes.map(n => n.id)).toEqual(["gamelan", "indian-classical", "griot"]);
  });

  it("sets node labels from names", () => {
    const { nodes } = buildNetworkData(SAMPLE_TRADITIONS);
    expect(nodes[0].label).toBe("Gamelan");
    expect(nodes[1].label).toBe("Indian Classical");
  });

  it("sets node category from region", () => {
    const { nodes } = buildNetworkData(SAMPLE_TRADITIONS);
    expect(nodes[0].category).toBe("Southeast Asia");
  });

  it("calculates node size from instruments + relations", () => {
    const { nodes } = buildNetworkData(SAMPLE_TRADITIONS);
    // gamelan: 4 instruments + 1 relation = 5, clamped to min(5, 12) = 5, + 4 = 9
    expect(nodes[0].size).toBe(9);
  });

  it("creates deduplicated edges for mutual relations", () => {
    const { edges } = buildNetworkData(SAMPLE_TRADITIONS);
    // gamelan -> indian-classical and indian-classical -> gamelan should produce 1 edge
    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect([edge.source, edge.target].sort()).toEqual(["gamelan", "indian-classical"]);
  });

  it("excludes edges to traditions not in filtered set", () => {
    const subset = SAMPLE_TRADITIONS.filter(t => t.id === "gamelan");
    const { edges } = buildNetworkData(subset);
    // indian-classical not in subset, so no edge
    expect(edges).toHaveLength(0);
  });

  it("includes metadata on nodes", () => {
    const { nodes } = buildNetworkData(SAMPLE_TRADITIONS);
    expect(nodes[0].metadata).toEqual({
      period: "200 BCE – present",
      instruments: 4,
      scales: "pelog, slendro",
    });
  });
});

describe("MusicalTraditionExplorer - buildGeoPoints", () => {
  it("creates geo points for each tradition", () => {
    const points = buildGeoPoints(SAMPLE_TRADITIONS);
    expect(points).toHaveLength(3);
  });

  it("maps coordinates correctly", () => {
    const points = buildGeoPoints(SAMPLE_TRADITIONS);
    expect(points[0].lat).toBe(-7.6);
    expect(points[0].lng).toBe(110.2);
  });

  it("uses tradition name as label", () => {
    const points = buildGeoPoints(SAMPLE_TRADITIONS);
    expect(points[0].label).toBe("Gamelan");
  });

  it("uses region as category", () => {
    const points = buildGeoPoints(SAMPLE_TRADITIONS);
    expect(points[0].category).toBe("Southeast Asia");
  });

  it("includes period and instrument count in metadata", () => {
    const points = buildGeoPoints(SAMPLE_TRADITIONS);
    expect(points[0].metadata?.instruments).toBe(4);
    expect(points[0].metadata?.period).toBe("200 BCE – present");
  });

  it("handles empty traditions array", () => {
    const points = buildGeoPoints([]);
    expect(points).toHaveLength(0);
  });
});
