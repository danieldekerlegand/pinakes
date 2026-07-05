import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  LOW_CONFIDENCE_THRESHOLD,
  isAiDraft,
  projectDraft,
  applyFieldReviews,
  validateAcceptedDraft,
  promoteContribution,
  isPromotable,
  AiReviewError,
} from "./ai-review";
import type { Contribution } from "./contribution-service";

/** A representative AI-extracted draft (as US-008's text extractor queues it). */
function makeDraft(overrides: Partial<Contribution> = {}): Contribution {
  return {
    id: "contrib-ai-1",
    entityType: "civilization",
    action: "add",
    status: "pending",
    submittedAt: "2026-07-05T00:00:00.000Z",
    sources: [{ title: "AI extraction" }],
    confidence: 70,
    entityData: {
      name: "Roman Empire",
      description: "An ancient empire",
      timePeriodStart: -27,
      timePeriodEnd: 476,
      source: "ai-extracted",
      aiGenerated: true,
      autoDerived: true,
      relationships: [{ type: "spoke", target: "Latin", confidence: 0.6 }],
      perFieldConfidence: {
        name: 0.95,
        description: 0.3,
        timePeriodStart: 0.8,
        timePeriodEnd: 0.4,
      },
    },
    ...overrides,
  };
}

describe("isAiDraft", () => {
  it("is true only when entityData.aiGenerated is true", () => {
    expect(isAiDraft(makeDraft())).toBe(true);
    const human = makeDraft({ entityData: { name: "Rome" } });
    expect(isAiDraft(human)).toBe(false);
  });
});

describe("projectDraft", () => {
  it("projects content fields with per-field confidence and low-confidence flags", () => {
    const view = projectDraft(makeDraft());
    expect(view.aiGenerated).toBe(true);
    expect(view.aiSource).toBe("ai-extracted");
    expect(view.overallConfidence).toBe(70);
    expect(view.promotable).toBe(true);

    const byName = Object.fromEntries(view.fields.map((f) => [f.field, f]));
    // Metadata keys are excluded.
    expect(byName.source).toBeUndefined();
    expect(byName.aiGenerated).toBeUndefined();
    expect(byName.relationships).toBeUndefined();
    // Content fields present with confidence.
    expect(byName.name.confidence).toBe(0.95);
    expect(byName.name.lowConfidence).toBe(false);
    // description (0.3) and timePeriodEnd (0.4) are below threshold.
    expect(byName.description.lowConfidence).toBe(true);
    expect(byName.timePeriodEnd.lowConfidence).toBe(true);
    expect(byName.timePeriodStart.lowConfidence).toBe(false);
    // Relationships surfaced separately.
    expect(view.relationships).toHaveLength(1);
  });

  it("marks a field with no recorded confidence as null / not low-confidence", () => {
    const draft = makeDraft({
      entityData: { name: "X", capital: "Rome", aiGenerated: true, source: "ai-extracted", perFieldConfidence: { name: 0.9 } },
    });
    const view = projectDraft(draft);
    const capital = view.fields.find((f) => f.field === "capital")!;
    expect(capital.confidence).toBeNull();
    expect(capital.lowConfidence).toBe(false);
  });

  it("LOW_CONFIDENCE_THRESHOLD is the 0..1 boundary", () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(LOW_CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });
});

describe("applyFieldReviews", () => {
  it("accepts all fields by default (strips metadata)", () => {
    const { acceptedData, fieldReviews, rejectedFields } = applyFieldReviews(makeDraft());
    expect(acceptedData.name).toBe("Roman Empire");
    expect(acceptedData.description).toBe("An ancient empire");
    expect(acceptedData.source).toBeUndefined();
    expect(acceptedData.aiGenerated).toBeUndefined();
    expect(rejectedFields).toEqual([]);
    expect(fieldReviews.name).toEqual({ decision: "accept" });
  });

  it("applies edit + reject decisions", () => {
    const { acceptedData, fieldReviews, rejectedFields } = applyFieldReviews(makeDraft(), {
      description: { decision: "edit", value: "The Roman Empire, an ancient Mediterranean state" },
      timePeriodEnd: { decision: "reject" },
    });
    expect(acceptedData.description).toBe("The Roman Empire, an ancient Mediterranean state");
    expect(acceptedData.timePeriodEnd).toBeUndefined();
    expect(rejectedFields).toEqual(["timePeriodEnd"]);
    expect(fieldReviews.description).toEqual({
      decision: "edit",
      value: "The Roman Empire, an ancient Mediterranean state",
    });
    expect(fieldReviews.timePeriodEnd).toEqual({ decision: "reject" });
  });

  it("throws on an unknown field decision", () => {
    expect(() => applyFieldReviews(makeDraft(), { nope: { decision: "reject" } })).toThrow(
      AiReviewError,
    );
  });
});

describe("validateAcceptedDraft", () => {
  it("flags a rejected required field", () => {
    const errors = validateAcceptedDraft("civilization", { description: "x" });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/name/);
  });

  it("requires coordinates for archaeological-site", () => {
    expect(validateAcceptedDraft("archaeological-site", { name: "Pompeii" }).length).toBe(1);
    expect(
      validateAcceptedDraft("archaeological-site", { name: "Pompeii", coordinates: { lat: 1, lng: 2 } }),
    ).toEqual([]);
  });
});

describe("isPromotable", () => {
  it("covers the AI-extracted target types", () => {
    expect(isPromotable("civilization")).toBe(true);
    expect(isPromotable("language")).toBe(true);
    expect(isPromotable("archaeological-site")).toBe(true);
    expect(isPromotable("trade-good")).toBe(true);
    // No target TSV for these.
    expect(isPromotable("historical-figure")).toBe(false);
    expect(isPromotable("relationship")).toBe(false);
  });
});

describe("promoteContribution", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-promote-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function rows(file: string): string[] {
    return fs
      .readFileSync(path.join(dir, file), "utf-8")
      .split(/\r?\n/)
      .filter(Boolean);
  }

  it("appends a civilization row + a provenance ledger row recording AI source and reviewer", () => {
    const rec = promoteContribution({
      contributionId: "contrib-ai-1",
      entityType: "civilization",
      acceptedData: { name: "Roman Empire", description: "An ancient empire", timePeriodStart: -27, timePeriodEnd: 476 },
      reviewer: "alice",
      aiSource: "ai-extracted",
      overallConfidence: 70,
      lexiconsDir: dir,
      now: "2026-07-05T12:00:00.000Z",
    });

    expect(rec.file).toBe("civilizations.tsv");
    expect(rec.targetId).toBe("roman-empire");
    expect(rec.reviewer).toBe("alice");

    const civRows = rows("civilizations.tsv");
    const header = civRows[0].split("\t");
    const cells = civRows[1].split("\t");
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    expect(row.id).toBe("roman-empire");
    expect(row.name).toBe("Roman Empire");
    expect(row.time_period_start).toBe("-27");
    expect(row.description).toBe("An ancient empire");
    // Provenance is inlined into the `sources` column (string-array shape preserved).
    expect(JSON.parse(row.sources)[0]).toContain("ai-extracted");
    expect(JSON.parse(row.sources)[0]).toContain("alice");

    // Structured ledger.
    const ledger = rows("contribution-provenance.tsv");
    const lHeader = ledger[0].split("\t");
    const lCells = ledger[1].split("\t");
    const lRow = Object.fromEntries(lHeader.map((h, i) => [h, lCells[i]]));
    expect(lRow.contribution_id).toBe("contrib-ai-1");
    expect(lRow.ai_source).toBe("ai-extracted");
    expect(lRow.reviewer).toBe("alice");
    expect(lRow.reviewed_at).toBe("2026-07-05T12:00:00.000Z");
    expect(lRow.target_id).toBe("roman-empire");
  });

  it("de-duplicates the generated id against existing rows in the target file", () => {
    const base = {
      reviewer: "bob",
      aiSource: "auto-derived",
      overallConfidence: 60,
      lexiconsDir: dir,
      now: "2026-07-05T12:00:00.000Z",
      entityType: "civilization" as const,
    };
    const first = promoteContribution({ ...base, contributionId: "c1", acceptedData: { name: "Sparta" } });
    const second = promoteContribution({ ...base, contributionId: "c2", acceptedData: { name: "Sparta" } });
    expect(first.targetId).toBe("sparta");
    expect(second.targetId).toBe("sparta-2");
    expect(rows("civilizations.tsv")).toHaveLength(3); // header + 2
  });

  it("writes an archaeological-site coordinates cell + confidence", () => {
    promoteContribution({
      contributionId: "c3",
      entityType: "archaeological-site",
      acceptedData: { name: "Pompeii", coordinates: { lat: 40.75, lng: 14.48 } },
      reviewer: "carol",
      aiSource: "ai-extracted",
      overallConfidence: 85,
      lexiconsDir: dir,
      now: "2026-07-05T12:00:00.000Z",
    });
    const siteRows = rows("archaeological-sites.tsv");
    const header = siteRows[0].split("\t");
    const cells = siteRows[1].split("\t");
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
    expect(JSON.parse(row.coordinates)).toEqual({ lat: 40.75, lng: 14.48 });
    expect(row.confidence).toBe("85");
  });

  it("throws for a non-promotable entity type", () => {
    expect(() =>
      promoteContribution({
        contributionId: "c4",
        entityType: "historical-figure",
        acceptedData: { name: "Caesar" },
        reviewer: "d",
        aiSource: "ai-extracted",
        overallConfidence: 50,
        lexiconsDir: dir,
        now: "2026-07-05T12:00:00.000Z",
      }),
    ).toThrow(AiReviewError);
  });

  it("throws when a required field is missing (e.g. name was rejected)", () => {
    expect(() =>
      promoteContribution({
        contributionId: "c5",
        entityType: "civilization",
        acceptedData: { description: "x" },
        reviewer: "d",
        aiSource: "ai-extracted",
        overallConfidence: 50,
        lexiconsDir: dir,
        now: "2026-07-05T12:00:00.000Z",
      }),
    ).toThrow(AiReviewError);
  });
});
