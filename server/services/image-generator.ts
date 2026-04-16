import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type SceneType = "city_reconstruction" | "architectural" | "daily_life" | "artifact";
export type ImageStyle = "realistic" | "illustrated" | "watercolor" | "archaeological_sketch";

export interface ImageGenerationRequest {
  entityType: string;
  entityId: string;
  sceneType: SceneType;
  style: ImageStyle;
  description: string;
  timePeriod?: string;
  region?: string;
}

export interface GeneratedImageResult {
  id: string;
  entityType: string;
  entityId: string;
  sceneType: SceneType;
  style: ImageStyle;
  prompt: string;
  imageBase64: string;
  mimeType: string;
  generatedAt: string;
}

export interface PromptRecord {
  id: string;
  entityType: string;
  entityId: string;
  promptText: string;
  sceneType: SceneType;
  style: ImageStyle;
  generatedAt: string;
  status: "success" | "error";
}

// ============================================================================
// Prompt Construction
// ============================================================================

const STYLE_DIRECTIVES: Record<ImageStyle, string> = {
  realistic:
    "Photorealistic rendering with accurate materials, lighting, and atmospheric perspective. Museum-quality historical reconstruction.",
  illustrated:
    "Detailed digital illustration with clean linework and rich colors. Educational illustration style suitable for a history textbook.",
  watercolor:
    "Soft watercolor painting with gentle washes, visible brushstrokes, and muted earth tones. Fine art style reminiscent of 19th-century archaeological expedition paintings.",
  archaeological_sketch:
    "Technical archaeological pencil sketch with cross-hatching, measurement annotations, and labeled architectural features. Scientific illustration style.",
};

const SCENE_DIRECTIVES: Record<SceneType, string> = {
  city_reconstruction:
    "A panoramic reconstruction of an ancient city showing its architecture, streets, public spaces, walls, and surrounding landscape. Include people going about daily activities to show scale.",
  architectural:
    "A detailed architectural reconstruction showing the structure's full form, construction materials, decorative elements, and spatial proportions. Include contextual surroundings.",
  daily_life:
    "A scene depicting everyday life showing people in period-accurate clothing engaged in typical activities like trade, craftsmanship, cooking, or ceremonies. Show tools, vessels, and furnishings of the era.",
  artifact:
    "A detailed close-up reconstruction of a cultural artifact shown in its original complete form, with accurate materials, colors, patterns, and decorative elements. Show the object from multiple angles or in its usage context.",
};

export function buildImagePrompt(request: ImageGenerationRequest): string {
  const styleDirective = STYLE_DIRECTIVES[request.style];
  const sceneDirective = SCENE_DIRECTIVES[request.sceneType];

  const parts = [
    `Create a historical reconstruction image.`,
    ``,
    `Subject: ${request.description}`,
  ];

  if (request.timePeriod) {
    parts.push(`Time Period: ${request.timePeriod}`);
  }
  if (request.region) {
    parts.push(`Region: ${request.region}`);
  }

  parts.push(
    ``,
    `Scene Type: ${sceneDirective}`,
    ``,
    `Art Style: ${styleDirective}`,
    ``,
    `Requirements:`,
    `- Historically and archaeologically accurate based on current scholarly understanding`,
    `- No modern elements or anachronisms`,
    `- Respectful and dignified portrayal of cultures and peoples`,
    `- Include environmental context appropriate to the geographic region`,
  );

  return parts.join("\n");
}

// ============================================================================
// Prompt TSV Storage
// ============================================================================

const PROMPTS_TSV_PATH = path.join(process.cwd(), "lexicons", "genai-prompts.tsv");
const PROMPTS_HEADER = "id\tentity_type\tentity_id\tprompt_text\tscene_type\tstyle\tgenerated_at\tstatus";

function ensurePromptsTsv(): void {
  if (!fs.existsSync(PROMPTS_TSV_PATH)) {
    fs.writeFileSync(PROMPTS_TSV_PATH, PROMPTS_HEADER + "\n", "utf-8");
  }
}

function escapeTsvField(value: string): string {
  return value.replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
}

export function appendPromptRecord(record: PromptRecord): void {
  ensurePromptsTsv();
  const line = [
    record.id,
    escapeTsvField(record.entityType),
    escapeTsvField(record.entityId),
    escapeTsvField(record.promptText),
    record.sceneType,
    record.style,
    record.generatedAt,
    record.status,
  ].join("\t");
  fs.appendFileSync(PROMPTS_TSV_PATH, line + "\n", "utf-8");
}

export function readPromptRecords(): PromptRecord[] {
  if (!fs.existsSync(PROMPTS_TSV_PATH)) return [];
  const content = fs.readFileSync(PROMPTS_TSV_PATH, "utf-8");
  const lines = content.trim().split("\n");
  if (lines.length <= 1) return [];

  return lines.slice(1).map((line) => {
    const [id, entityType, entityId, promptText, sceneType, style, generatedAt, status] = line.split("\t");
    return {
      id,
      entityType,
      entityId,
      promptText,
      sceneType: sceneType as SceneType,
      style: style as ImageStyle,
      generatedAt,
      status: status as "success" | "error",
    };
  });
}

// ============================================================================
// ID Generation
// ============================================================================

let idCounter = 0;

export function generateId(): string {
  idCounter++;
  return `img_${Date.now()}_${idCounter}`;
}

// ============================================================================
// Gemini Image Generation
// ============================================================================

export async function generateReconstructionImage(
  request: ImageGenerationRequest
): Promise<GeneratedImageResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required for image generation");
  }

  const prompt = buildImagePrompt(request);
  const id = generateId();
  const generatedAt = new Date().toISOString();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-exp";

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseModalities: ["image", "text"] as any,
    } as any,
  });

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const candidates = response.candidates;

    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates returned from image generation");
    }

    const parts = candidates[0].content?.parts || [];
    let imageBase64 = "";
    let mimeType = "image/png";

    for (const part of parts) {
      if ((part as any).inlineData) {
        imageBase64 = (part as any).inlineData.data;
        mimeType = (part as any).inlineData.mimeType || "image/png";
        break;
      }
    }

    if (!imageBase64) {
      throw new Error("No image data returned from generation model");
    }

    appendPromptRecord({
      id,
      entityType: request.entityType,
      entityId: request.entityId,
      promptText: prompt,
      sceneType: request.sceneType,
      style: request.style,
      generatedAt,
      status: "success",
    });

    return {
      id,
      entityType: request.entityType,
      entityId: request.entityId,
      sceneType: request.sceneType,
      style: request.style,
      prompt,
      imageBase64,
      mimeType,
      generatedAt,
    };
  } catch (error) {
    appendPromptRecord({
      id,
      entityType: request.entityType,
      entityId: request.entityId,
      promptText: prompt,
      sceneType: request.sceneType,
      style: request.style,
      generatedAt,
      status: "error",
    });
    throw error;
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

const VALID_SCENE_TYPES: SceneType[] = ["city_reconstruction", "architectural", "daily_life", "artifact"];
const VALID_STYLES: ImageStyle[] = ["realistic", "illustrated", "watercolor", "archaeological_sketch"];

export function validateSceneType(value: string): value is SceneType {
  return VALID_SCENE_TYPES.includes(value as SceneType);
}

export function validateStyle(value: string): value is ImageStyle {
  return VALID_STYLES.includes(value as ImageStyle);
}
