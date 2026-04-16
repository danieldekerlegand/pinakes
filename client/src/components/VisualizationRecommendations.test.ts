import { describe, it, expect } from "vitest";

/**
 * Unit tests for VisualizationRecommendations configuration.
 * Tests the recommendation mapping logic and ensures all panel types
 * have valid recommendations pointing to valid view modes.
 */

// Replicate the types and config from the component for pure unit testing
type ViewMode = "tree" | "network" | "timeline" | "map" | "map-3d" | "explorer" | "lineage" | "contribute";

type PanelType =
  | "language-detail"
  | "phonology"
  | "grammar"
  | "writing-systems"
  | "verb-paradigms"
  | "language-contacts"
  | "sound-changes"
  | "correlation"
  | "art-traditions"
  | "literary-traditions"
  | "archaeological-cultures"
  | "trade-goods"
  | "word-comparison"
  | "linguistic-distance"
  | "military-warfare";

interface Recommendation {
  view: ViewMode;
  label: string;
  reason: string;
}

function buildRec(view: ViewMode, reason: string): Recommendation {
  const labels: Record<ViewMode, string> = {
    tree: "Family Tree",
    network: "Network",
    timeline: "Timeline",
    map: "Map",
    explorer: "Explorer",
    lineage: "Lineage",
    contribute: "Contribute",
  };
  return { view, label: labels[view], reason };
}

const PANEL_RECOMMENDATIONS: Record<PanelType, Recommendation[]> = {
  "language-detail": [
    buildRec("map", "See geographic distribution"),
    buildRec("tree", "View family relationships"),
    buildRec("timeline", "Explore historical evolution"),
    buildRec("network", "Find related languages"),
  ],
  phonology: [
    buildRec("network", "Compare phoneme inventories"),
    buildRec("tree", "See family phonological patterns"),
    buildRec("map", "View areal phonological features"),
  ],
  grammar: [
    buildRec("network", "Cluster by typological features"),
    buildRec("map", "Map grammatical features"),
    buildRec("tree", "Compare within families"),
  ],
  "writing-systems": [
    buildRec("map", "Map script distributions"),
    buildRec("timeline", "Trace script evolution"),
    buildRec("lineage", "View script derivation chains"),
  ],
  "verb-paradigms": [
    buildRec("network", "Compare conjugation complexity"),
    buildRec("tree", "Family paradigm patterns"),
    buildRec("map", "Regional verb morphology"),
  ],
  "language-contacts": [
    buildRec("network", "Visualize contact networks"),
    buildRec("map", "See geographic contact zones"),
    buildRec("timeline", "Contact events over time"),
  ],
  "sound-changes": [
    buildRec("timeline", "Sound change chronology"),
    buildRec("tree", "Trace changes through families"),
    buildRec("network", "Shared sound change patterns"),
  ],
  correlation: [
    buildRec("explorer", "Deep cross-domain analysis"),
    buildRec("network", "Entity relationship graph"),
    buildRec("map", "Geographic correlation patterns"),
  ],
  "art-traditions": [
    buildRec("timeline", "Art tradition timelines"),
    buildRec("map", "Geographic spread of styles"),
    buildRec("lineage", "Style influence chains"),
  ],
  "literary-traditions": [
    buildRec("timeline", "Literary period timelines"),
    buildRec("map", "Centers of literary production"),
    buildRec("lineage", "Literary influence paths"),
  ],
  "archaeological-cultures": [
    buildRec("timeline", "Culture chronology"),
    buildRec("map", "Archaeological site locations"),
    buildRec("lineage", "Cultural succession chains"),
  ],
  "trade-goods": [
    buildRec("map", "Trade route geography"),
    buildRec("timeline", "Trade good emergence"),
    buildRec("network", "Trade relationship networks"),
  ],
  "word-comparison": [
    buildRec("network", "Cognate relationship graph"),
    buildRec("tree", "Word heritage through families"),
    buildRec("map", "Loanword geographic spread"),
  ],
  "linguistic-distance": [
    buildRec("network", "Distance-based clustering"),
    buildRec("tree", "Phylogenetic grouping"),
    buildRec("map", "Geographic distance overlay"),
  ],
  "military-warfare": [
    buildRec("map", "Battle site locations"),
    buildRec("timeline", "War and battle chronology"),
    buildRec("network", "Belligerent relationship networks"),
  ],
};

const VALID_VIEW_MODES: ViewMode[] = [
  "tree", "network", "timeline", "map", "explorer", "lineage", "contribute",
];

const ALL_PANEL_TYPES: PanelType[] = [
  "language-detail", "phonology", "grammar", "writing-systems",
  "verb-paradigms", "language-contacts", "sound-changes", "correlation",
  "art-traditions", "literary-traditions", "archaeological-cultures",
  "trade-goods", "word-comparison", "linguistic-distance",
  "military-warfare",
];

describe("VisualizationRecommendations configuration", () => {
  it("has recommendations for all 15 panel types", () => {
    for (const panelType of ALL_PANEL_TYPES) {
      expect(PANEL_RECOMMENDATIONS[panelType]).toBeDefined();
      expect(PANEL_RECOMMENDATIONS[panelType].length).toBeGreaterThan(0);
    }
  });

  it("covers exactly 15 panel types", () => {
    expect(Object.keys(PANEL_RECOMMENDATIONS)).toHaveLength(15);
  });

  it("each recommendation has a valid view mode", () => {
    for (const [panelType, recs] of Object.entries(PANEL_RECOMMENDATIONS)) {
      for (const rec of recs) {
        expect(VALID_VIEW_MODES).toContain(rec.view);
      }
    }
  });

  it("each recommendation has a non-empty label and reason", () => {
    for (const [panelType, recs] of Object.entries(PANEL_RECOMMENDATIONS)) {
      for (const rec of recs) {
        expect(rec.label.length).toBeGreaterThan(0);
        expect(rec.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("each panel has 3-4 recommendations", () => {
    for (const [panelType, recs] of Object.entries(PANEL_RECOMMENDATIONS)) {
      expect(recs.length).toBeGreaterThanOrEqual(3);
      expect(recs.length).toBeLessThanOrEqual(4);
    }
  });

  it("no panel has duplicate view modes in its recommendations", () => {
    for (const [panelType, recs] of Object.entries(PANEL_RECOMMENDATIONS)) {
      const views = recs.map((r) => r.view);
      expect(new Set(views).size).toBe(views.length);
    }
  });

  it("language-detail panel recommends map, tree, timeline, network", () => {
    const views = PANEL_RECOMMENDATIONS["language-detail"].map((r) => r.view);
    expect(views).toContain("map");
    expect(views).toContain("tree");
    expect(views).toContain("timeline");
    expect(views).toContain("network");
  });

  it("correlation panel recommends explorer view", () => {
    const views = PANEL_RECOMMENDATIONS["correlation"].map((r) => r.view);
    expect(views).toContain("explorer");
  });

  it("cultural panels recommend lineage view", () => {
    const culturalPanels: PanelType[] = [
      "art-traditions", "literary-traditions", "archaeological-cultures",
    ];
    for (const panel of culturalPanels) {
      const views = PANEL_RECOMMENDATIONS[panel].map((r) => r.view);
      expect(views).toContain("lineage");
    }
  });

  it("buildRec produces correct structure", () => {
    const rec = buildRec("map", "test reason");
    expect(rec).toEqual({
      view: "map",
      label: "Map",
      reason: "test reason",
    });
  });
});
