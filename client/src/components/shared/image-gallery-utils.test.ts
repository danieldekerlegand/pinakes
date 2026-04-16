import { describe, it, expect } from "vitest";
import {
  type GalleryImage,
  MEDIA_TYPE_COLORS,
  normalizeLicense,
  getMediaTypeColor,
  getUniqueTags,
  filterByTag,
  filterByMediaType,
  sortImages,
  getAspectRatio,
  clampIndex,
  nextIndex,
  prevIndex,
  clampZoom,
} from "./image-gallery-utils";

const sampleImages: GalleryImage[] = [
  {
    id: "img-1",
    url: "https://example.com/1.jpg",
    title: "Pyramid",
    mediaType: "image",
    tags: ["egypt", "architecture", "ancient"],
    dateAdded: "2026-04-10",
    license: "cc by-sa 4.0",
    width: 2000,
    height: 1000,
  },
  {
    id: "img-2",
    url: "https://example.com/2.jpg",
    title: "Discobolus",
    mediaType: "image",
    tags: ["greek", "sculpture"],
    dateAdded: "2026-04-15",
    license: "cc by 3.0",
    width: 1000,
    height: 1500,
  },
  {
    id: "img-3",
    url: "https://example.com/3.jpg",
    title: "Hagia Sophia Reconstruction",
    mediaType: "reconstruction",
    tags: ["byzantine", "architecture"],
    dateAdded: "2026-04-01",
    license: "generated",
  },
  {
    id: "img-4",
    url: "https://example.com/4.jpg",
    title: "Ancient Map",
    mediaType: "map",
    tags: [],
    dateAdded: "2026-04-20",
  },
];

describe("normalizeLicense", () => {
  it("returns 'Unknown' for empty values", () => {
    expect(normalizeLicense(undefined)).toBe("Unknown");
    expect(normalizeLicense("")).toBe("Unknown");
  });

  it("normalizes known license codes", () => {
    expect(normalizeLicense("public_domain")).toBe("Public Domain");
    expect(normalizeLicense("cc_by")).toBe("CC BY");
    expect(normalizeLicense("cc_by_sa")).toBe("CC BY-SA");
    expect(normalizeLicense("generated")).toBe("AI Generated");
    expect(normalizeLicense("fair_use")).toBe("Fair Use");
  });

  it("is case insensitive", () => {
    expect(normalizeLicense("CC BY 4.0")).toBe("CC BY 4.0");
    expect(normalizeLicense("cc by-sa 3.0")).toBe("CC BY-SA 3.0");
  });

  it("returns original value for unknown license", () => {
    expect(normalizeLicense("Custom License")).toBe("Custom License");
  });
});

describe("getMediaTypeColor", () => {
  it("returns the correct color for known media types", () => {
    expect(getMediaTypeColor("image")).toBe("#3b82f6");
    expect(getMediaTypeColor("reconstruction")).toBe("#f59e0b");
    expect(getMediaTypeColor("map")).toBe("#10b981");
  });

  it("is case insensitive", () => {
    expect(getMediaTypeColor("IMAGE")).toBe("#3b82f6");
    expect(getMediaTypeColor("Illustration")).toBe("#8b5cf6");
  });

  it("returns fallback for unknown or missing type", () => {
    expect(getMediaTypeColor(undefined)).toBe("#6b7280");
    expect(getMediaTypeColor("something-else")).toBe("#6b7280");
  });

  it("has valid hex colors for all known types", () => {
    for (const color of Object.values(MEDIA_TYPE_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("getUniqueTags", () => {
  it("returns sorted unique tags across images", () => {
    const result = getUniqueTags(sampleImages);
    expect(result).toEqual([
      "ancient",
      "architecture",
      "byzantine",
      "egypt",
      "greek",
      "sculpture",
    ]);
  });

  it("handles images without tags", () => {
    expect(getUniqueTags([{ id: "x", url: "u", title: "t" }])).toEqual([]);
  });

  it("handles empty input", () => {
    expect(getUniqueTags([])).toEqual([]);
  });

  it("trims and skips empty tags", () => {
    const images: GalleryImage[] = [
      { id: "a", url: "u", title: "t", tags: ["  ", "valid", ""] },
    ];
    expect(getUniqueTags(images)).toEqual(["valid"]);
  });
});

describe("filterByTag", () => {
  it("returns all images when tag is null", () => {
    expect(filterByTag(sampleImages, null)).toHaveLength(4);
  });

  it("returns all images when tag is 'all'", () => {
    expect(filterByTag(sampleImages, "all")).toHaveLength(4);
  });

  it("filters to images with the given tag", () => {
    const result = filterByTag(sampleImages, "architecture");
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["img-1", "img-3"]);
  });

  it("returns empty array when no matches", () => {
    expect(filterByTag(sampleImages, "nonexistent")).toHaveLength(0);
  });
});

describe("filterByMediaType", () => {
  it("returns all images when type is null or 'all'", () => {
    expect(filterByMediaType(sampleImages, null)).toHaveLength(4);
    expect(filterByMediaType(sampleImages, "all")).toHaveLength(4);
  });

  it("filters images by exact media type", () => {
    const result = filterByMediaType(sampleImages, "image");
    expect(result).toHaveLength(2);
  });

  it("is case insensitive", () => {
    expect(filterByMediaType(sampleImages, "IMAGE")).toHaveLength(2);
    expect(filterByMediaType(sampleImages, "Reconstruction")).toHaveLength(1);
  });

  it("returns empty when no type matches", () => {
    expect(filterByMediaType(sampleImages, "video")).toHaveLength(0);
  });
});

describe("sortImages", () => {
  it("returns original order for relevance sort", () => {
    const result = sortImages(sampleImages, "relevance");
    expect(result.map((i) => i.id)).toEqual([
      "img-1",
      "img-2",
      "img-3",
      "img-4",
    ]);
  });

  it("sorts by date descending (newest first)", () => {
    const result = sortImages(sampleImages, "date");
    expect(result.map((i) => i.id)).toEqual([
      "img-4",
      "img-2",
      "img-1",
      "img-3",
    ]);
  });

  it("sorts by title alphabetically", () => {
    const result = sortImages(sampleImages, "title");
    expect(result.map((i) => i.title)).toEqual([
      "Ancient Map",
      "Discobolus",
      "Hagia Sophia Reconstruction",
      "Pyramid",
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = [...sampleImages];
    sortImages(sampleImages, "title");
    expect(sampleImages).toEqual(copy);
  });
});

describe("getAspectRatio", () => {
  it("computes aspect ratio from width and height", () => {
    expect(getAspectRatio(2000, 1000)).toBe(2);
    expect(getAspectRatio(1000, 2000)).toBe(0.5);
  });

  it("returns null for missing dimensions", () => {
    expect(getAspectRatio(null, null)).toBeNull();
    expect(getAspectRatio(undefined, 500)).toBeNull();
    expect(getAspectRatio(500, undefined)).toBeNull();
  });

  it("returns null for zero height", () => {
    expect(getAspectRatio(500, 0)).toBeNull();
  });
});

describe("clampIndex", () => {
  it("returns 0 for empty length", () => {
    expect(clampIndex(5, 0)).toBe(0);
  });

  it("wraps positive overflow", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(6, 3)).toBe(0);
  });

  it("wraps negative indices", () => {
    expect(clampIndex(-1, 3)).toBe(2);
    expect(clampIndex(-3, 3)).toBe(0);
  });

  it("returns index in range unchanged", () => {
    expect(clampIndex(1, 3)).toBe(1);
  });
});

describe("nextIndex and prevIndex", () => {
  it("advances forward with wraparound", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe(0);
  });

  it("advances backward with wraparound", () => {
    expect(prevIndex(0, 3)).toBe(2);
    expect(prevIndex(2, 3)).toBe(1);
  });

  it("handles single image", () => {
    expect(nextIndex(0, 1)).toBe(0);
    expect(prevIndex(0, 1)).toBe(0);
  });
});

describe("clampZoom", () => {
  it("clamps to default min/max", () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(10)).toBe(5);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("accepts custom bounds", () => {
    expect(clampZoom(0.25, 0.5, 3)).toBe(0.5);
    expect(clampZoom(4, 0.5, 3)).toBe(3);
    expect(clampZoom(1.5, 0.5, 3)).toBe(1.5);
  });
});
