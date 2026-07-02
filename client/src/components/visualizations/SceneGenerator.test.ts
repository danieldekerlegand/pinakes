import { describe, it, expect } from "vitest";
import {
  SCENE_OPTIONS,
  STYLE_OPTIONS,
  DEFAULT_FORM_STATE,
  WATERMARK_TEXT,
  buildSceneDescription,
  buildGenerateRequest,
  buildCacheAssetPayload,
  buildDataUrl,
  mapUiSceneToBackend,
  validateSceneForm,
  type CultureContext,
  type GeneratedSceneResult,
  type SceneFormState,
} from "./scene-generator-utils";

const culture: CultureContext = {
  id: "cp-rome",
  name: "Roman Republic",
  region: "Central Italy",
  timePeriod: "2nd century BCE",
};

function formWith(overrides: Partial<SceneFormState> = {}): SceneFormState {
  return { ...DEFAULT_FORM_STATE, ...overrides };
}

describe("SCENE_OPTIONS", () => {
  it("includes all scene types called out in the spec", () => {
    const values = SCENE_OPTIONS.map((o) => o.value);
    for (const v of ["daily_life", "ceremony", "battle", "marketplace", "landscape"]) {
      expect(values).toContain(v);
    }
  });

  it("each option has a non-empty label and helper", () => {
    for (const option of SCENE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.helper.length).toBeGreaterThan(0);
    }
  });
});

describe("STYLE_OPTIONS", () => {
  it("covers all four backend styles", () => {
    const values = STYLE_OPTIONS.map((o) => o.value).sort();
    expect(values).toEqual(
      ["archaeological_sketch", "illustrated", "realistic", "watercolor"].sort(),
    );
  });
});

describe("mapUiSceneToBackend", () => {
  it("maps ceremony/battle/marketplace to daily_life", () => {
    expect(mapUiSceneToBackend("ceremony")).toBe("daily_life");
    expect(mapUiSceneToBackend("battle")).toBe("daily_life");
    expect(mapUiSceneToBackend("marketplace")).toBe("daily_life");
    expect(mapUiSceneToBackend("daily_life")).toBe("daily_life");
  });

  it("maps landscape and city to city_reconstruction", () => {
    expect(mapUiSceneToBackend("landscape")).toBe("city_reconstruction");
    expect(mapUiSceneToBackend("city")).toBe("city_reconstruction");
  });

  it("maps architecture to architectural", () => {
    expect(mapUiSceneToBackend("architecture")).toBe("architectural");
  });

  it("maps artifact to artifact", () => {
    expect(mapUiSceneToBackend("artifact")).toBe("artifact");
  });
});

describe("buildSceneDescription", () => {
  it("includes the culture name", () => {
    const desc = buildSceneDescription(formWith({ sceneType: "daily_life" }), culture);
    expect(desc).toContain("Roman Republic");
  });

  it("uses scene-specific language", () => {
    expect(buildSceneDescription(formWith({ sceneType: "battle" }), culture)).toContain("battle");
    expect(
      buildSceneDescription(formWith({ sceneType: "ceremony" }), culture),
    ).toContain("ceremonial");
    expect(
      buildSceneDescription(formWith({ sceneType: "marketplace" }), culture),
    ).toContain("marketplace");
    expect(
      buildSceneDescription(formWith({ sceneType: "landscape" }), culture),
    ).toContain("landscape");
  });

  it("appends extra details when provided", () => {
    const desc = buildSceneDescription(
      formWith({ sceneType: "daily_life", extraDetails: "bread baking in a domestic oven" }),
      culture,
    );
    expect(desc).toContain("Specific elements: bread baking in a domestic oven");
  });

  it("falls back gracefully when culture is null", () => {
    const desc = buildSceneDescription(formWith({ sceneType: "daily_life" }), null);
    expect(desc).toContain("unspecified culture");
  });
});

describe("validateSceneForm", () => {
  it("requires a culture", () => {
    const errors = validateSceneForm(formWith(), null);
    expect(errors.some((e) => e.field === "culture")).toBe(true);
  });

  it("passes with culture and defaults", () => {
    const errors = validateSceneForm(formWith(), culture);
    expect(errors).toEqual([]);
  });
});

describe("buildGenerateRequest", () => {
  it("uses culture_profile as entity type and culture id", () => {
    const req = buildGenerateRequest(formWith(), culture);
    expect(req.entityType).toBe("culture_profile");
    expect(req.entityId).toBe("cp-rome");
  });

  it("maps UI scene to backend scene", () => {
    const req = buildGenerateRequest(formWith({ sceneType: "ceremony" }), culture);
    expect(req.sceneType).toBe("daily_life");
  });

  it("uses form time period when provided, else falls back to culture", () => {
    const withForm = buildGenerateRequest(formWith({ timePeriod: "1st century CE" }), culture);
    expect(withForm.timePeriod).toBe("1st century CE");
    const withoutForm = buildGenerateRequest(formWith(), culture);
    expect(withoutForm.timePeriod).toBe("2nd century BCE");
  });

  it("uses form region when provided, else falls back to culture", () => {
    const withForm = buildGenerateRequest(formWith({ region: "Gaul" }), culture);
    expect(withForm.region).toBe("Gaul");
    const withoutForm = buildGenerateRequest(formWith(), culture);
    expect(withoutForm.region).toBe("Central Italy");
  });

  it("omits time period and region when neither form nor culture provide them", () => {
    const req = buildGenerateRequest(formWith(), {
      id: "cp-x",
      name: "Culture X",
    });
    expect(req.timePeriod).toBeUndefined();
    expect(req.region).toBeUndefined();
  });
});

describe("buildDataUrl", () => {
  it("builds a base64 data URL", () => {
    const url = buildDataUrl({ imageBase64: "AAA", mimeType: "image/png" });
    expect(url).toBe("data:image/png;base64,AAA");
  });
});

describe("buildCacheAssetPayload", () => {
  const result: GeneratedSceneResult = {
    id: "img_1_1",
    entityType: "culture_profile",
    entityId: "cp-rome",
    sceneType: "daily_life",
    style: "illustrated",
    prompt: "Some generated prompt text",
    imageBase64: "ZZZ",
    mimeType: "image/png",
    generatedAt: "2026-04-16T00:00:00.000Z",
  };

  it("builds a payload targeting the culture_profile entity", () => {
    const payload = buildCacheAssetPayload(
      result,
      formWith({ sceneType: "ceremony", style: "watercolor" }),
      culture,
    );
    expect(payload.entityType).toBe("culture_profile");
    expect(payload.entityId).toBe("cp-rome");
    expect(payload.mediaType).toBe("image");
  });

  it("stores the image as a data URL", () => {
    const payload = buildCacheAssetPayload(result, formWith(), culture);
    expect(payload.url).toBe("data:image/png;base64,ZZZ");
  });

  it("labels the title with the culture name and human-readable scene/style", () => {
    const payload = buildCacheAssetPayload(
      result,
      formWith({ sceneType: "ceremony", style: "watercolor" }),
      culture,
    );
    expect(payload.title).toContain("Roman Republic");
    expect(payload.title).toContain("Ceremony");
    expect(payload.title).toContain("Watercolor");
  });

  it("marks the asset with the generated license and watermark attribution", () => {
    const payload = buildCacheAssetPayload(result, formWith(), culture);
    expect(payload.license).toBe("generated");
    expect(payload.attribution).toBe(WATERMARK_TEXT);
  });

  it("tags the asset with scene type, style, and culture id for retrieval", () => {
    const payload = buildCacheAssetPayload(
      result,
      formWith({ sceneType: "battle", style: "archaeological_sketch" }),
      culture,
    );
    expect(payload.tags).toContain("generated");
    expect(payload.tags).toContain("ai_reconstruction");
    expect(payload.tags).toContain("battle");
    expect(payload.tags).toContain("archaeological_sketch");
    expect(payload.tags).toContain("culture:cp-rome");
  });
});
