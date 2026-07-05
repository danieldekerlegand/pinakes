/**
 * LLM text extractor (US-008).
 *
 * Turns a pasted paragraph (from a paper, textbook, or article) into structured,
 * per-field entity *drafts* — entities (name, type, description, coordinates,
 * dates) and the relationships between them — that land in the *contribution
 * review queue* (US-009), never the live dataset. Every field carries a 0..1
 * confidence and each draft is flagged `aiGenerated`/`autoDerived` so a reviewer
 * can accept/edit/reject before anything is promoted to TSV.
 *
 * Extraction uses the **existing Gemini client** (same `@google/generative-ai`
 * responseSchema pattern as {@link ./map-image-analyzer}). The LLM call is behind
 * the injectable {@link TextExtractorDeps} so tests drive the extractor with
 * recorded fixtures — no live model call, no API key.
 */

import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import type { ContributionEntityType, Contribution } from "./contribution-service";

// ── Public draft shape ────────────────────────────────────────────────────────

/** A single extracted value with a 0..1 confidence. */
export interface FieldValue<T> {
  value: T;
  /** Extraction confidence, 0 (guess) … 1 (verbatim from the text). */
  confidence: number;
}

/** One entity surfaced from the pasted text, each field independently scored. */
export interface ExtractedEntity {
  name: FieldValue<string>;
  /** The LLM's guessed kind (civilization/language/site/…); mapped to a queue type. */
  rawType: string;
  description?: FieldValue<string>;
  coordinates?: FieldValue<{ lat: number; lng: number }>;
  /** Start year (negative = BCE). */
  timePeriodStart?: FieldValue<number>;
  /** End year (negative = BCE). */
  timePeriodEnd?: FieldValue<number>;
}

/** One relationship between two named entities in the text. */
export interface ExtractedRelationship {
  /** Source entity name (matched to an {@link ExtractedEntity} by normalized name). */
  source: string;
  /** Target entity name. */
  target: string;
  /** Relationship label (e.g. `descended-from`, `traded-with`, `located-in`). */
  type: string;
  confidence: number;
}

/** The structured, AI-generated extraction returned to the client + queued. */
export interface TextExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  /** Always true — every text extraction is machine-derived and unverified. */
  aiGenerated: true;
  autoDerived: true;
}

/** Raised when the input text is empty/unusable. */
export class TextExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextExtractionError";
  }
}

// ── Raw LLM payload (matches RESPONSE_SCHEMA) ──────────────────────────────────

/** Raw per-entity object the model returns (flat, per-field confidence). */
export interface RawEntity {
  name: string;
  entityType: string;
  /** Confidence in the name/identity (0..1). Falls back for unscored fields. */
  confidence: number;
  description?: string;
  descriptionConfidence?: number;
  latitude?: number;
  longitude?: number;
  coordinatesConfidence?: number;
  startYear?: number;
  startYearConfidence?: number;
  endYear?: number;
  endYearConfidence?: number;
}

/** Raw per-relationship object the model returns. */
export interface RawRelationship {
  source: string;
  target: string;
  type: string;
  confidence: number;
}

/** The full JSON payload the Gemini call produces. */
export interface RawTextExtraction {
  entities: RawEntity[];
  relationships: RawRelationship[];
}

// ── Injectable LLM boundary ────────────────────────────────────────────────────

export interface TextExtractorDeps {
  /** Run the extraction model over `text` and return its raw structured JSON. */
  extract(text: string): Promise<RawTextExtraction>;
}

// ── Normalization (pure) ────────────────────────────────────────────────────────

/** Clamp any number-ish value into 0..1, defaulting to `fallback`. */
function clampConfidence(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalize a raw LLM payload into the {@link TextExtractionResult} draft shape.
 * Pure — no network. Drops entities with a blank name; coordinates are only kept
 * when both lat/lng are finite; years must be finite integers.
 */
export function normalizeExtraction(raw: RawTextExtraction): TextExtractionResult {
  const entities: ExtractedEntity[] = [];

  for (const e of raw.entities ?? []) {
    const name = (e.name ?? "").trim();
    if (!name) continue;

    const nameConfidence = clampConfidence(e.confidence, 0.5);
    const entity: ExtractedEntity = {
      name: { value: name, confidence: nameConfidence },
      rawType: (e.entityType ?? "").trim() || "unknown",
    };

    const description = (e.description ?? "").trim();
    if (description) {
      entity.description = {
        value: description,
        confidence: clampConfidence(e.descriptionConfidence, nameConfidence),
      };
    }

    if (typeof e.latitude === "number" && Number.isFinite(e.latitude) &&
        typeof e.longitude === "number" && Number.isFinite(e.longitude)) {
      entity.coordinates = {
        value: { lat: e.latitude, lng: e.longitude },
        confidence: clampConfidence(e.coordinatesConfidence, nameConfidence),
      };
    }

    if (typeof e.startYear === "number" && Number.isFinite(e.startYear)) {
      entity.timePeriodStart = {
        value: Math.trunc(e.startYear),
        confidence: clampConfidence(e.startYearConfidence, nameConfidence),
      };
    }
    if (typeof e.endYear === "number" && Number.isFinite(e.endYear)) {
      entity.timePeriodEnd = {
        value: Math.trunc(e.endYear),
        confidence: clampConfidence(e.endYearConfidence, nameConfidence),
      };
    }

    entities.push(entity);
  }

  const relationships: ExtractedRelationship[] = [];
  const seen = new Set<string>();
  for (const r of raw.relationships ?? []) {
    const source = (r.source ?? "").trim();
    const target = (r.target ?? "").trim();
    const type = (r.type ?? "").trim();
    if (!source || !target || !type) continue;
    if (normalizeName(source) === normalizeName(target)) continue; // no self edge
    const key = `${normalizeName(source)}→${normalizeName(target)}:${type.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relationships.push({
      source,
      target,
      type,
      confidence: clampConfidence(r.confidence, 0.5),
    });
  }

  return { entities, relationships, aiGenerated: true, autoDerived: true };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// ── Entity type resolution ──────────────────────────────────────────────────────

/**
 * Map the LLM's free-text entity kind to a **queue-safe** {@link ContributionEntityType}.
 * Only maps to types whose required fields we can guarantee: name-only types plus
 * `archaeological-site` (which needs coordinates — used only when they are present).
 * Anything unrecognized falls back to `civilization` (name-only).
 */
export function resolveContributionEntityType(
  rawType: string,
  hasCoordinates: boolean,
): ContributionEntityType {
  const t = rawType.trim().toLowerCase();
  if (t.includes("language") || t.includes("dialect")) return "language";
  // NB: `religion` requires a `religionType` we can't guarantee from free text, so
  // religions fall through to the name-only-safe `civilization` bucket below.
  if (
    (t.includes("site") || t.includes("settlement") || t.includes("city") ||
      t.includes("ruin") || t.includes("archaeolog")) &&
    hasCoordinates
  ) {
    return "archaeological-site";
  }
  if (t.includes("figure") || t.includes("person") || t.includes("ruler") ||
      t.includes("king") || t.includes("emperor") || t.includes("leader")) {
    return "historical-figure";
  }
  if (t.includes("trade") || t.includes("good") || t.includes("commodity") ||
      t.includes("product")) {
    return "trade-good";
  }
  return "civilization";
}

// ── Draft → contributions ───────────────────────────────────────────────────────

/**
 * Overall 1..100 contribution confidence for one entity = the mean of its present
 * field confidences (0..1) scaled to 1..99. Always < 100 so a reviewer sees it
 * needs verification.
 */
export function overallConfidence(entity: ExtractedEntity): number {
  const scores: number[] = [entity.name.confidence];
  if (entity.description) scores.push(entity.description.confidence);
  if (entity.coordinates) scores.push(entity.coordinates.confidence);
  if (entity.timePeriodStart) scores.push(entity.timePeriodStart.confidence);
  if (entity.timePeriodEnd) scores.push(entity.timePeriodEnd.confidence);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.max(1, Math.min(99, Math.round(mean * 100)));
}

/**
 * Convert a normalized extraction into one `Partial<Contribution>` per entity for
 * the review queue. Each is flagged AI-generated/auto-derived and enters as a
 * `pending` contribution — never the live dataset. Relationships are attached to
 * the contribution of their *source* entity (matched by normalized name), so no
 * edge is silently lost; a relationship whose source is not among the entities is
 * attached to its target instead (else dropped, but still present in the result).
 */
export function extractionToContributions(
  result: TextExtractionResult,
  opts: {
    sourceText?: string;
    contributorName?: string;
    contributorEmail?: string;
  } = {},
): Partial<Contribution>[] {
  const byName = new Map<string, ExtractedEntity>();
  for (const e of result.entities) byName.set(normalizeName(e.name.value), e);

  // Group relationships onto the owning entity (source, else target).
  const relByEntity = new Map<string, ExtractedRelationship[]>();
  for (const rel of result.relationships) {
    const owner = byName.has(normalizeName(rel.source))
      ? normalizeName(rel.source)
      : byName.has(normalizeName(rel.target))
        ? normalizeName(rel.target)
        : null;
    if (!owner) continue;
    const list = relByEntity.get(owner) ?? [];
    list.push(rel);
    relByEntity.set(owner, list);
  }

  const excerpt = (opts.sourceText ?? "").trim().slice(0, 280);

  return result.entities.map((entity) => {
    const hasCoordinates = !!entity.coordinates;
    const entityType = resolveContributionEntityType(entity.rawType, hasCoordinates);

    const perFieldConfidence: Record<string, number> = {
      name: entity.name.confidence,
    };
    if (entity.description) perFieldConfidence.description = entity.description.confidence;
    if (entity.coordinates) perFieldConfidence.coordinates = entity.coordinates.confidence;
    if (entity.timePeriodStart)
      perFieldConfidence.timePeriodStart = entity.timePeriodStart.confidence;
    if (entity.timePeriodEnd)
      perFieldConfidence.timePeriodEnd = entity.timePeriodEnd.confidence;

    const relationships = relByEntity.get(normalizeName(entity.name.value)) ?? [];

    const entityData: Record<string, unknown> = {
      name: entity.name.value,
      source: "ai-extracted",
      aiGenerated: true,
      autoDerived: true,
      llmEntityType: entity.rawType,
      relationships,
      perFieldConfidence,
    };
    if (entity.description) entityData.description = entity.description.value;
    if (entity.coordinates) entityData.coordinates = entity.coordinates.value;
    if (entity.timePeriodStart) entityData.timePeriodStart = entity.timePeriodStart.value;
    if (entity.timePeriodEnd) entityData.timePeriodEnd = entity.timePeriodEnd.value;

    return {
      entityType,
      action: "add" as const,
      entityData,
      sources: [
        {
          title: excerpt
            ? `AI text extraction: "${excerpt}${excerpt.length >= 280 ? "…" : ""}"`
            : "AI text extraction",
        },
      ],
      confidence: overallConfidence(entity),
      contributorName: opts.contributorName,
      contributorEmail: opts.contributorEmail,
      notes: "AI-extracted draft from pasted text — review before promoting.",
    };
  });
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/** Extract a structured draft from a pasted paragraph. @throws {TextExtractionError} */
export async function extractDraftFromText(
  text: string,
  deps: TextExtractorDeps,
): Promise<TextExtractionResult> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new TextExtractionError("text is required");
  const raw = await deps.extract(trimmed);
  return normalizeExtraction(raw);
}

// ── Default (live) Gemini implementation ────────────────────────────────────────

const RESPONSE_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    entities: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          entityType: {
            type: SchemaType.STRING,
            description:
              "One of: civilization, language, archaeological-site, historical-figure, trade-good, religion, or a short kind label.",
          },
          confidence: { type: SchemaType.NUMBER, description: "0..1 confidence in the entity identity." },
          description: { type: SchemaType.STRING },
          descriptionConfidence: { type: SchemaType.NUMBER },
          latitude: { type: SchemaType.NUMBER },
          longitude: { type: SchemaType.NUMBER },
          coordinatesConfidence: { type: SchemaType.NUMBER },
          startYear: {
            type: SchemaType.NUMBER,
            description: "Start year as a signed integer; negative for BCE.",
          },
          startYearConfidence: { type: SchemaType.NUMBER },
          endYear: {
            type: SchemaType.NUMBER,
            description: "End year as a signed integer; negative for BCE.",
          },
          endYearConfidence: { type: SchemaType.NUMBER },
        },
        required: ["name", "entityType", "confidence"],
      },
    },
    relationships: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          source: { type: SchemaType.STRING },
          target: { type: SchemaType.STRING },
          type: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ["source", "target", "type", "confidence"],
      },
    },
  },
  required: ["entities", "relationships"],
};

export function buildExtractionPrompt(text: string): string {
  return `You are extracting structured cultural/historical data from a paragraph of text (from a paper, textbook, or article).

Extract:
- entities: named civilizations, languages, archaeological sites/settlements, historical figures, trade goods, religions, or other cultural entities. For each, give its name, a short entityType label, an optional one-sentence description, coordinates (latitude/longitude) if the text implies a location, and a start/end year if the text implies a time period (use signed integers; negative for BCE).
- relationships: directed links between two named entities that the text asserts (e.g. one language descended from another, one civilization traded with another, a site located in a region). Give source, target, and a short relationship type label.

Assign every field a confidence score from 0.0 (a guess) to 1.0 (stated explicitly in the text). Only include a coordinate or year when the text supports it. Do not invent entities or facts that are not in the text.

Return valid JSON matching the schema. If nothing of a kind is present, return an empty array.

TEXT:
"""
${text}
"""`;
}

/** Live deps calling the real Gemini model (same client as map-image-analyzer). */
export const liveDeps: TextExtractorDeps = {
  async extract(text: string): Promise<RawTextExtraction> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for text extraction");
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const result = await model.generateContent([buildExtractionPrompt(text)]);
    const raw = JSON.parse(result.response.text()) as RawTextExtraction;
    return {
      entities: Array.isArray(raw.entities) ? raw.entities : [],
      relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
    };
  },
};

// Exported for testing.
export { RESPONSE_SCHEMA };
