export type BackendSceneType =
  | "city_reconstruction"
  | "architectural"
  | "daily_life"
  | "artifact";

export type UiSceneType =
  | "daily_life"
  | "ceremony"
  | "battle"
  | "marketplace"
  | "landscape"
  | "city"
  | "architecture"
  | "artifact";

export type ImageStyle =
  | "realistic"
  | "illustrated"
  | "watercolor"
  | "archaeological_sketch";

export interface SceneFormState {
  sceneType: UiSceneType;
  style: ImageStyle;
  timePeriod: string;
  region: string;
  extraDetails: string;
}

export interface CultureContext {
  id: string;
  name: string;
  region?: string;
  timePeriod?: string;
}

export interface GenerateRequestPayload {
  entityType: string;
  entityId: string;
  sceneType: BackendSceneType;
  style: ImageStyle;
  description: string;
  timePeriod?: string;
  region?: string;
}

export interface SceneOption {
  value: UiSceneType;
  label: string;
  helper: string;
}

export interface StyleOption {
  value: ImageStyle;
  label: string;
}

export const SCENE_OPTIONS: SceneOption[] = [
  {
    value: "daily_life",
    label: "Daily Life",
    helper: "Everyday activities, domestic routines, and common people",
  },
  {
    value: "ceremony",
    label: "Ceremony",
    helper: "Religious rituals, royal court, or civic ceremonies",
  },
  {
    value: "battle",
    label: "Battle",
    helper: "Military engagement or notable warfare scene",
  },
  {
    value: "marketplace",
    label: "Marketplace",
    helper: "Bustling commerce, trade goods, merchants, and buyers",
  },
  {
    value: "landscape",
    label: "Landscape",
    helper: "Panoramic view of the culture's territory and natural setting",
  },
  {
    value: "city",
    label: "City View",
    helper: "Reconstructed cityscape showing architecture and streets",
  },
  {
    value: "architecture",
    label: "Architecture",
    helper: "Focused reconstruction of a notable building or structure",
  },
  {
    value: "artifact",
    label: "Artifact",
    helper: "Close-up reconstruction of a cultural artifact or object",
  },
];

export const STYLE_OPTIONS: StyleOption[] = [
  { value: "realistic", label: "Photorealistic" },
  { value: "illustrated", label: "Illustrated" },
  { value: "watercolor", label: "Watercolor" },
  { value: "archaeological_sketch", label: "Archaeological Sketch" },
];

const UI_TO_BACKEND_SCENE: Record<UiSceneType, BackendSceneType> = {
  daily_life: "daily_life",
  ceremony: "daily_life",
  battle: "daily_life",
  marketplace: "daily_life",
  landscape: "city_reconstruction",
  city: "city_reconstruction",
  architecture: "architectural",
  artifact: "artifact",
};

const UI_SCENE_DESCRIPTIONS: Record<UiSceneType, string> = {
  daily_life: "a daily life scene showing ordinary people engaged in typical activities",
  ceremony:
    "a ceremonial or ritual scene with religious officiants, participants, and ceremonial regalia",
  battle: "a battle scene with warriors in period-accurate armor and weapons",
  marketplace:
    "a busy marketplace with merchants, buyers, stalls, and culturally characteristic trade goods",
  landscape:
    "a panoramic landscape view of the culture's territory with characteristic terrain and settlements",
  city: "a reconstructed city view showing streets, architecture, and public spaces",
  architecture:
    "a detailed reconstruction of a signature building or monument",
  artifact: "a close-up view of a signature cultural artifact in its original intact form",
};

export function mapUiSceneToBackend(ui: UiSceneType): BackendSceneType {
  return UI_TO_BACKEND_SCENE[ui];
}

export function buildSceneDescription(
  form: SceneFormState,
  culture: CultureContext | null,
): string {
  const cultureName = culture?.name?.trim() || "an unspecified culture";
  const basePhrase = UI_SCENE_DESCRIPTIONS[form.sceneType];
  const parts = [`${basePhrase} from ${cultureName}`];
  const extras = form.extraDetails.trim();
  if (extras.length > 0) parts.push(`Specific elements: ${extras}`);
  return parts.join(". ");
}

export interface SceneFormError {
  field: keyof SceneFormState | "culture";
  message: string;
}

export function validateSceneForm(
  form: SceneFormState,
  culture: CultureContext | null,
): SceneFormError[] {
  const errors: SceneFormError[] = [];
  if (!culture || !culture.id) {
    errors.push({ field: "culture", message: "Select a culture to generate a scene for" });
  }
  if (!form.sceneType) {
    errors.push({ field: "sceneType", message: "Scene type is required" });
  }
  if (!form.style) {
    errors.push({ field: "style", message: "Style is required" });
  }
  return errors;
}

export function buildGenerateRequest(
  form: SceneFormState,
  culture: CultureContext,
): GenerateRequestPayload {
  const description = buildSceneDescription(form, culture);
  const timePeriod = form.timePeriod.trim() || culture.timePeriod?.trim() || undefined;
  const region = form.region.trim() || culture.region?.trim() || undefined;
  return {
    entityType: "culture_profile",
    entityId: culture.id,
    sceneType: mapUiSceneToBackend(form.sceneType),
    style: form.style,
    description,
    timePeriod,
    region,
  };
}

export interface GeneratedSceneResult {
  id: string;
  entityType: string;
  entityId: string;
  sceneType: BackendSceneType;
  style: ImageStyle;
  prompt: string;
  imageBase64: string;
  mimeType: string;
  generatedAt: string;
}

export interface SceneAssetPayload {
  entityType: string;
  entityId: string;
  mediaType: "image";
  url: string;
  title: string;
  description: string;
  license: "generated";
  attribution: string;
  mimeType: string;
  tags: string[];
}

export const WATERMARK_TEXT = "AI-Generated Reconstruction";

export function buildCacheAssetPayload(
  result: GeneratedSceneResult,
  form: SceneFormState,
  culture: CultureContext,
): SceneAssetPayload {
  const sceneLabel =
    SCENE_OPTIONS.find((o) => o.value === form.sceneType)?.label ?? form.sceneType;
  const styleLabel =
    STYLE_OPTIONS.find((o) => o.value === form.style)?.label ?? form.style;
  const dataUrl = `data:${result.mimeType};base64,${result.imageBase64}`;
  const tags = [
    "generated",
    "ai_reconstruction",
    form.sceneType,
    form.style,
    `culture:${culture.id}`,
  ];
  return {
    entityType: "culture_profile",
    entityId: culture.id,
    mediaType: "image",
    url: dataUrl,
    title: `${culture.name} — ${sceneLabel} (${styleLabel})`,
    description: result.prompt,
    license: "generated",
    attribution: WATERMARK_TEXT,
    mimeType: result.mimeType,
    tags,
  };
}

export function buildDataUrl(result: Pick<GeneratedSceneResult, "imageBase64" | "mimeType">): string {
  return `data:${result.mimeType};base64,${result.imageBase64}`;
}

export const DEFAULT_FORM_STATE: SceneFormState = {
  sceneType: "daily_life",
  style: "illustrated",
  timePeriod: "",
  region: "",
  extraDetails: "",
};
