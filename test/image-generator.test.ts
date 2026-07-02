import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildImagePrompt,
  validateSceneType,
  validateStyle,
  appendPromptRecord,
  readPromptRecords,
  generateId,
  type ImageGenerationRequest,
  type SceneType,
  type ImageStyle,
  type PromptRecord,
} from "../server/services/image-generator";

// ============================================================================
// buildImagePrompt
// ============================================================================

describe("buildImagePrompt", () => {
  const baseRequest: ImageGenerationRequest = {
    entityType: "settlement",
    entityId: "rome_001",
    sceneType: "city_reconstruction",
    style: "realistic",
    description: "Ancient Rome during the height of the Roman Empire, 2nd century CE",
  };

  it("includes the description in the prompt", () => {
    const prompt = buildImagePrompt(baseRequest);
    expect(prompt).toContain("Ancient Rome during the height of the Roman Empire");
  });

  it("includes scene type directive for city_reconstruction", () => {
    const prompt = buildImagePrompt(baseRequest);
    expect(prompt).toContain("panoramic reconstruction");
  });

  it("includes style directive for realistic", () => {
    const prompt = buildImagePrompt(baseRequest);
    expect(prompt).toContain("Photorealistic");
  });

  it("includes time period when provided", () => {
    const prompt = buildImagePrompt({ ...baseRequest, timePeriod: "2nd century CE" });
    expect(prompt).toContain("Time Period: 2nd century CE");
  });

  it("includes region when provided", () => {
    const prompt = buildImagePrompt({ ...baseRequest, region: "Central Italy" });
    expect(prompt).toContain("Region: Central Italy");
  });

  it("omits time period when not provided", () => {
    const prompt = buildImagePrompt(baseRequest);
    expect(prompt).not.toContain("Time Period:");
  });

  it("omits region when not provided", () => {
    const prompt = buildImagePrompt(baseRequest);
    expect(prompt).not.toContain("Region:");
  });

  it("includes historical accuracy requirements", () => {
    const prompt = buildImagePrompt(baseRequest);
    expect(prompt).toContain("Historically and archaeologically accurate");
    expect(prompt).toContain("No modern elements or anachronisms");
  });

  it("uses correct directive for architectural scene type", () => {
    const prompt = buildImagePrompt({ ...baseRequest, sceneType: "architectural" });
    expect(prompt).toContain("architectural reconstruction");
  });

  it("uses correct directive for daily_life scene type", () => {
    const prompt = buildImagePrompt({ ...baseRequest, sceneType: "daily_life" });
    expect(prompt).toContain("everyday life");
  });

  it("uses correct directive for artifact scene type", () => {
    const prompt = buildImagePrompt({ ...baseRequest, sceneType: "artifact" });
    expect(prompt).toContain("cultural artifact");
  });

  it("uses correct directive for illustrated style", () => {
    const prompt = buildImagePrompt({ ...baseRequest, style: "illustrated" });
    expect(prompt).toContain("digital illustration");
  });

  it("uses correct directive for watercolor style", () => {
    const prompt = buildImagePrompt({ ...baseRequest, style: "watercolor" });
    expect(prompt).toContain("watercolor painting");
  });

  it("uses correct directive for archaeological_sketch style", () => {
    const prompt = buildImagePrompt({ ...baseRequest, style: "archaeological_sketch" });
    expect(prompt).toContain("archaeological pencil sketch");
  });
});

// ============================================================================
// Validation
// ============================================================================

describe("validateSceneType", () => {
  it("accepts valid scene types", () => {
    expect(validateSceneType("city_reconstruction")).toBe(true);
    expect(validateSceneType("architectural")).toBe(true);
    expect(validateSceneType("daily_life")).toBe(true);
    expect(validateSceneType("artifact")).toBe(true);
  });

  it("rejects invalid scene types", () => {
    expect(validateSceneType("landscape")).toBe(false);
    expect(validateSceneType("")).toBe(false);
    expect(validateSceneType("CITY_RECONSTRUCTION")).toBe(false);
  });
});

describe("validateStyle", () => {
  it("accepts valid styles", () => {
    expect(validateStyle("realistic")).toBe(true);
    expect(validateStyle("illustrated")).toBe(true);
    expect(validateStyle("watercolor")).toBe(true);
    expect(validateStyle("archaeological_sketch")).toBe(true);
  });

  it("rejects invalid styles", () => {
    expect(validateStyle("oil_painting")).toBe(false);
    expect(validateStyle("")).toBe(false);
    expect(validateStyle("REALISTIC")).toBe(false);
  });
});

// ============================================================================
// ID Generation
// ============================================================================

describe("generateId", () => {
  it("returns a string starting with img_", () => {
    const id = generateId();
    expect(id).toMatch(/^img_\d+_\d+$/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ============================================================================
// TSV Prompt Storage
// ============================================================================

describe("prompt TSV storage", () => {
  const testTsvDir = path.join(process.cwd(), "lexicons");
  const testTsvPath = path.join(testTsvDir, "genai-prompts.tsv");
  let originalContent: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(testTsvPath)) {
      originalContent = fs.readFileSync(testTsvPath, "utf-8");
    }
  });

  afterEach(() => {
    if (originalContent !== null) {
      fs.writeFileSync(testTsvPath, originalContent, "utf-8");
    } else if (fs.existsSync(testTsvPath)) {
      fs.unlinkSync(testTsvPath);
    }
  });

  it("appendPromptRecord writes a record and readPromptRecords reads it back", () => {
    // Reset to just header
    fs.writeFileSync(
      testTsvPath,
      "id\tentity_type\tentity_id\tprompt_text\tscene_type\tstyle\tgenerated_at\tstatus\n",
      "utf-8"
    );

    const record: PromptRecord = {
      id: "img_test_1",
      entityType: "settlement",
      entityId: "rome_001",
      promptText: "Generate a city reconstruction of ancient Rome",
      sceneType: "city_reconstruction",
      style: "realistic",
      generatedAt: "2026-04-16T00:00:00.000Z",
      status: "success",
    };

    appendPromptRecord(record);
    const records = readPromptRecords();

    expect(records.length).toBe(1);
    expect(records[0].id).toBe("img_test_1");
    expect(records[0].entityType).toBe("settlement");
    expect(records[0].entityId).toBe("rome_001");
    expect(records[0].sceneType).toBe("city_reconstruction");
    expect(records[0].style).toBe("realistic");
    expect(records[0].status).toBe("success");
  });

  it("escapes tabs and newlines in prompt text", () => {
    fs.writeFileSync(
      testTsvPath,
      "id\tentity_type\tentity_id\tprompt_text\tscene_type\tstyle\tgenerated_at\tstatus\n",
      "utf-8"
    );

    const record: PromptRecord = {
      id: "img_test_2",
      entityType: "artifact",
      entityId: "vase_001",
      promptText: "A prompt with\ttabs and\nnewlines",
      sceneType: "artifact",
      style: "watercolor",
      generatedAt: "2026-04-16T00:00:00.000Z",
      status: "success",
    };

    appendPromptRecord(record);
    const records = readPromptRecords();

    expect(records.length).toBe(1);
    expect(records[0].promptText).not.toContain("\t");
    expect(records[0].promptText).not.toContain("\n");
  });

  it("readPromptRecords returns empty array for empty file", () => {
    fs.writeFileSync(
      testTsvPath,
      "id\tentity_type\tentity_id\tprompt_text\tscene_type\tstyle\tgenerated_at\tstatus\n",
      "utf-8"
    );
    const records = readPromptRecords();
    expect(records).toEqual([]);
  });

  it("appends multiple records", () => {
    fs.writeFileSync(
      testTsvPath,
      "id\tentity_type\tentity_id\tprompt_text\tscene_type\tstyle\tgenerated_at\tstatus\n",
      "utf-8"
    );

    for (let i = 0; i < 3; i++) {
      appendPromptRecord({
        id: `img_test_${i}`,
        entityType: "settlement",
        entityId: `city_${i}`,
        promptText: `Prompt ${i}`,
        sceneType: "city_reconstruction",
        style: "realistic",
        generatedAt: "2026-04-16T00:00:00.000Z",
        status: "success",
      });
    }

    const records = readPromptRecords();
    expect(records.length).toBe(3);
    expect(records[0].id).toBe("img_test_0");
    expect(records[2].id).toBe("img_test_2");
  });
});

// ============================================================================
// generateReconstructionImage (mocked Gemini)
// ============================================================================

describe("generateReconstructionImage", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;

    const { generateReconstructionImage } = await import("../server/services/image-generator");

    await expect(
      generateReconstructionImage({
        entityType: "settlement",
        entityId: "rome_001",
        sceneType: "city_reconstruction",
        style: "realistic",
        description: "Ancient Rome",
      })
    ).rejects.toThrow("GEMINI_API_KEY");
  });
});
