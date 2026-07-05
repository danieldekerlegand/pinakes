/**
 * US-010 — authoring-time suggested relationships (pure ranking).
 *
 * Fixtures are a small hand-built entity set so the temporal / spatial /
 * linguistic proximity math and the resulting ranking are asserted directly —
 * no storage, no network. A fixed `now` keeps open-ended spans deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  computeProximity,
  combinedConfidence,
  suggestRelationshipType,
  suggestRelationships,
  type SuggestionEntity,
  type ExistingEdge,
} from "./relationship-suggestions";

const NOW = 2000;

const rome: SuggestionEntity = {
  id: "rome",
  name: "Roman Republic",
  entityType: "civilization",
  languageIds: ["latin"],
  coordinates: { lat: 41.9, lng: 12.5 },
  timeStart: -509,
  timeEnd: 476,
  region: "Mediterranean",
};

const latinCuisine: SuggestionEntity = {
  id: "latin-cuisine",
  name: "Roman Cuisine",
  entityType: "cuisine",
  languageIds: ["latin"],
  coordinates: { lat: 41.0, lng: 12.0 },
  timeStart: -200,
  timeEnd: 500,
  region: "Mediterranean",
};

const etruria: SuggestionEntity = {
  id: "etruria",
  name: "Etruscan Civilization",
  entityType: "civilization",
  languageIds: ["etruscan"],
  coordinates: { lat: 42.5, lng: 11.8 },
  timeStart: -900,
  timeEnd: -27,
  region: "Mediterranean",
};

const greekReligion: SuggestionEntity = {
  id: "greek-religion",
  name: "Hellenic Religion",
  entityType: "religion",
  languageIds: ["greek"],
  coordinates: { lat: 38.0, lng: 23.0 },
  timeStart: -800,
  timeEnd: 400,
  region: "Mediterranean",
};

const japanMusic: SuggestionEntity = {
  id: "japan-music",
  name: "Gagaku",
  entityType: "music-tradition",
  languageIds: ["japanese"],
  coordinates: { lat: 35.0, lng: 139.0 },
  timeStart: 600,
  timeEnd: 1800,
  region: "East Asia",
};

const pool = [rome, latinCuisine, etruria, greekReligion, japanMusic];

describe("computeProximity", () => {
  it("scores shared associated languages as full linguistic proximity", () => {
    const p = computeProximity(rome, latinCuisine, { now: NOW });
    expect(p.applicable.linguistic).toBe(true);
    expect(p.sharedLanguages).toEqual(["latin"]);
    expect(p.linguistic).toBeCloseTo(1, 5); // Jaccard 1/1
  });

  it("marks linguistic inapplicable when a side has no languages", () => {
    const noLang: SuggestionEntity = { id: "x", name: "X", entityType: "civilization" };
    const p = computeProximity(noLang, latinCuisine, { now: NOW });
    expect(p.applicable.linguistic).toBe(false);
    expect(p.linguistic).toBe(0);
  });

  it("computes temporal overlap as a share of the shorter span", () => {
    const p = computeProximity(rome, latinCuisine, { now: NOW });
    expect(p.applicable.temporal).toBe(true);
    expect(p.overlapYears).toBe(476 - -200); // 676
    expect(p.temporal).toBeGreaterThan(0);
    expect(p.temporal).toBeLessThanOrEqual(1);
  });

  it("reports zero temporal overlap for disjoint spans", () => {
    const p = computeProximity(rome, japanMusic, { now: NOW });
    expect(p.applicable.temporal).toBe(true);
    expect(p.temporal).toBe(0);
    expect(p.overlapYears).toBe(0);
  });

  it("scores nearby coordinates highly and distant ones at zero", () => {
    const near = computeProximity(rome, etruria, { now: NOW });
    expect(near.applicable.spatial).toBe(true);
    expect(near.spatial).toBeGreaterThan(0.9);

    const far = computeProximity(rome, japanMusic, { now: NOW });
    // >2000km apart and different region ⇒ no spatial proximity.
    expect(far.spatial).toBe(0);
  });

  it("falls back to a region match when coordinates are absent", () => {
    const a: SuggestionEntity = { id: "a", name: "A", entityType: "civilization", region: "Levant" };
    const b: SuggestionEntity = { id: "b", name: "B", entityType: "religion", region: "levant" };
    const p = computeProximity(a, b, { now: NOW });
    expect(p.applicable.spatial).toBe(true);
    expect(p.spatial).toBe(0.5);
    expect(p.sharedRegion).toBe("Levant");
  });
});

describe("combinedConfidence", () => {
  it("averages only the applicable dimensions (no dilution by inapplicable ones)", () => {
    // Only linguistic applies, perfect score ⇒ near the cap, not diluted to ~40.
    const proximity = {
      linguistic: 1,
      temporal: 0,
      spatial: 0,
      applicable: { linguistic: true, temporal: false, spatial: false },
      sharedLanguages: ["latin"],
      overlapYears: null,
      distanceKm: null,
      sharedRegion: null,
    };
    expect(combinedConfidence(proximity)).toBeGreaterThanOrEqual(90);
  });

  it("returns 0 when nothing is applicable", () => {
    const proximity = {
      linguistic: 0,
      temporal: 0,
      spatial: 0,
      applicable: { linguistic: false, temporal: false, spatial: false },
      sharedLanguages: [],
      overlapYears: null,
      distanceKm: null,
      sharedRegion: null,
    };
    expect(combinedConfidence(proximity)).toBe(0);
  });

  it("never reaches 100 — a suggestion always needs confirmation", () => {
    const proximity = {
      linguistic: 1,
      temporal: 1,
      spatial: 1,
      applicable: { linguistic: true, temporal: true, spatial: true },
      sharedLanguages: ["latin"],
      overlapYears: 100,
      distanceKm: 0,
      sharedRegion: "Mediterranean",
    };
    expect(combinedConfidence(proximity)).toBeLessThan(100);
  });
});

describe("suggestRelationshipType", () => {
  it("suggests cognate-with between two languages sharing a language signal", () => {
    const langA: SuggestionEntity = { id: "la", name: "Latin", entityType: "language", languageIds: ["la"] };
    const langB: SuggestionEntity = { id: "it", name: "Italian", entityType: "language", languageIds: ["la"] };
    const p = computeProximity(langA, langB, { now: NOW });
    expect(suggestRelationshipType(langA, langB, p)).toBe("cognate-with");
  });

  it("suggests contemporary-with when temporal proximity dominates", () => {
    const p = computeProximity(rome, greekReligion, { now: NOW });
    // No shared language, so temporal dominates over the region-only spatial.
    expect(suggestRelationshipType(rome, greekReligion, p)).toBe("contemporary-with");
  });

  it("suggests located-in when spatial dominates and the target is a place", () => {
    const site: SuggestionEntity = {
      id: "pompeii",
      name: "Pompeii",
      entityType: "archaeological-site",
      coordinates: { lat: 40.75, lng: 14.49 },
    };
    const p = computeProximity(rome, site, { now: NOW });
    expect(suggestRelationshipType(rome, site, p)).toBe("located-in");
  });
});

describe("suggestRelationships", () => {
  it("ranks candidates by confidence, strongest signal first", () => {
    const out = suggestRelationships(rome, pool, [], { now: NOW, minConfidence: 1 });
    const ids = out.map((s) => s.targetId);
    // rome excluded (self); japan excluded (no signal at all).
    expect(ids).not.toContain("rome");
    expect(ids).not.toContain("japan-music");
    expect(ids[0]).toBe("latin-cuisine"); // shared language ⇒ highest
    // Confidence is monotonically non-increasing.
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].confidence).toBeGreaterThanOrEqual(out[i].confidence);
    }
  });

  it("attaches a rationale explaining each proximity signal that fired", () => {
    const out = suggestRelationships(rome, pool, [], { now: NOW, minConfidence: 1 });
    const cuisine = out.find((s) => s.targetId === "latin-cuisine")!;
    const kinds = cuisine.rationale.map((r) => r.kind);
    expect(kinds).toContain("linguistic");
    expect(kinds).toContain("temporal");
    expect(kinds).toContain("spatial");
    expect(cuisine.rationale[0].detail).toMatch(/latin/i);
  });

  it("packages a ready-to-submit edge but never submits it", () => {
    const out = suggestRelationships(rome, pool, [], { now: NOW, minConfidence: 1 });
    const cuisine = out.find((s) => s.targetId === "latin-cuisine")!;
    expect(cuisine.edge.sourceId).toBe("rome");
    expect(cuisine.edge.targetId).toBe("latin-cuisine");
    expect(cuisine.edge.relationshipType).toBe(cuisine.relationshipType);
    expect(cuisine.edge.confidence).toBe(cuisine.confidence);
    expect(cuisine.relationshipToken).not.toBe(""); // resolved canonical token
  });

  it("excludes a pair already connected in EITHER direction", () => {
    const forward: ExistingEdge[] = [
      { sourceId: "rome", targetId: "latin-cuisine", relationshipType: "influenced-by" },
    ];
    expect(
      suggestRelationships(rome, pool, forward, { now: NOW, minConfidence: 1 }).map((s) => s.targetId),
    ).not.toContain("latin-cuisine");

    const reverse: ExistingEdge[] = [
      { sourceId: "latin-cuisine", targetId: "rome", relationshipType: "influenced-by" },
    ];
    expect(
      suggestRelationships(rome, pool, reverse, { now: NOW, minConfidence: 1 }).map((s) => s.targetId),
    ).not.toContain("latin-cuisine");
  });

  it("drops suggestions below minConfidence and honours the limit", () => {
    const all = suggestRelationships(rome, pool, [], { now: NOW, minConfidence: 1 });
    expect(all.length).toBeGreaterThan(1);

    const limited = suggestRelationships(rome, pool, [], { now: NOW, minConfidence: 1, limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].targetId).toBe(all[0].targetId);

    const strict = suggestRelationships(rome, pool, [], { now: NOW, minConfidence: 85 });
    expect(strict.every((s) => s.confidence >= 85)).toBe(true);
    expect(strict.map((s) => s.targetId)).toEqual(["latin-cuisine"]);
  });

  it("returns nothing for an entity with no proximity signal to the pool", () => {
    const isolated: SuggestionEntity = {
      id: "isolated",
      name: "Isolated",
      entityType: "civilization",
      languageIds: ["klingon"],
      coordinates: { lat: -80, lng: 170 },
      timeStart: 3000,
      timeEnd: 3100,
      region: "Antarctica",
    };
    expect(suggestRelationships(isolated, pool, [], { now: NOW, minConfidence: 1 })).toEqual([]);
  });
});
