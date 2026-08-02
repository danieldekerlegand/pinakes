import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MediaAssetService } from "../server/services/media-asset-service";

const HEADERS = [
  "id", "entity_type", "entity_id", "media_type", "url", "title",
  "description", "source", "license", "attribution", "mime_type",
  "width", "height", "tags", "date_added",
].join("\t");

const SAMPLE_ROW = [
  "media-001", "art_tradition", "art-001", "image",
  "https://example.com/image.jpg", "Test Image", "A test image",
  "Test Source", "CC BY 4.0", "Test Author", "image/jpeg",
  "1024", "768", '["test","sample"]', "2026-04-16",
].join("\t");

function makeTsv(rows: string[]): string {
  return [HEADERS, ...rows].join("\n") + "\n";
}

describe("MediaAssetService", () => {
  let tmpDir: string;
  let service: MediaAssetService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-test-"));
    service = new MediaAssetService(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadAssets", () => {
    it("returns empty array when file does not exist", async () => {
      const assets = await service.loadAssets();
      expect(assets).toEqual([]);
    });

    it("parses TSV file correctly", async () => {
      fs.writeFileSync(path.join(tmpDir, "media-assets.tsv"), makeTsv([SAMPLE_ROW]));
      const assets = await service.loadAssets();
      expect(assets).toHaveLength(1);
      expect(assets[0].id).toBe("media-001");
      expect(assets[0].entityType).toBe("art_tradition");
      expect(assets[0].entityId).toBe("art-001");
      expect(assets[0].mediaType).toBe("image");
      expect(assets[0].width).toBe(1024);
      expect(assets[0].height).toBe(768);
      expect(assets[0].tags).toEqual(["test", "sample"]);
    });
  });

  describe("validate", () => {
    it("returns no errors for valid input", () => {
      const errors = service.validate({
        entityType: "art_tradition",
        entityId: "art-001",
        mediaType: "image",
        url: "https://example.com/img.jpg",
        title: "Test",
      });
      expect(errors).toHaveLength(0);
    });

    it("rejects invalid entityType", () => {
      const errors = service.validate({
        entityType: "invalid_type",
        entityId: "x",
        mediaType: "image",
        url: "https://example.com",
        title: "Test",
      });
      expect(errors.some((e) => e.field === "entityType")).toBe(true);
    });

    it("rejects invalid mediaType", () => {
      const errors = service.validate({
        entityType: "art_tradition",
        entityId: "x",
        mediaType: "hologram",
        url: "https://example.com",
        title: "Test",
      });
      expect(errors.some((e) => e.field === "mediaType")).toBe(true);
    });

    it("rejects missing required fields", () => {
      const errors = service.validate({
        entityType: "",
        entityId: "",
        mediaType: "",
        url: "",
        title: "",
      });
      expect(errors.length).toBeGreaterThanOrEqual(5);
    });

    it("rejects negative width/height", () => {
      const errors = service.validate({
        entityType: "art_tradition",
        entityId: "art-001",
        mediaType: "image",
        url: "https://example.com",
        title: "Test",
        width: -1,
        height: -5,
      });
      expect(errors.some((e) => e.field === "width")).toBe(true);
      expect(errors.some((e) => e.field === "height")).toBe(true);
    });
  });

  describe("addAsset", () => {
    it("adds an asset and writes to TSV", async () => {
      const asset = await service.addAsset({
        entityType: "civilization",
        entityId: "civ-001",
        mediaType: "image",
        url: "https://example.com/civ.jpg",
        title: "Civilization Image",
        tags: ["civilization", "history"],
      });

      expect(asset.id).toBe("media-001");
      expect(asset.entityType).toBe("civilization");
      expect(asset.tags).toEqual(["civilization", "history"]);

      // Verify written to disk
      const loaded = await service.loadAssets();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("media-001");
    });

    it("auto-increments IDs", async () => {
      fs.writeFileSync(path.join(tmpDir, "media-assets.tsv"), makeTsv([SAMPLE_ROW]));

      const asset = await service.addAsset({
        entityType: "art_tradition",
        entityId: "art-002",
        mediaType: "image",
        url: "https://example.com/art2.jpg",
        title: "Second Image",
      });

      expect(asset.id).toBe("media-002");
      const loaded = await service.loadAssets();
      expect(loaded).toHaveLength(2);
    });

    it("throws on invalid input", async () => {
      await expect(
        service.addAsset({
          entityType: "invalid",
          entityId: "",
          mediaType: "",
          url: "",
          title: "",
        })
      ).rejects.toThrow("Validation failed");
    });
  });

  describe("deleteAsset", () => {
    it("deletes an existing asset", async () => {
      fs.writeFileSync(path.join(tmpDir, "media-assets.tsv"), makeTsv([SAMPLE_ROW]));
      const deleted = await service.deleteAsset("media-001");
      expect(deleted).toBe(true);

      const loaded = await service.loadAssets();
      expect(loaded).toHaveLength(0);
    });

    it("returns false for non-existent asset", async () => {
      fs.writeFileSync(path.join(tmpDir, "media-assets.tsv"), makeTsv([SAMPLE_ROW]));
      const deleted = await service.deleteAsset("media-999");
      expect(deleted).toBe(false);
    });
  });

  describe("getValidEntityTypes / getValidMediaTypes", () => {
    it("returns valid entity types", () => {
      const types = service.getValidEntityTypes();
      expect(types).toContain("art_tradition");
      expect(types).toContain("civilization");
      expect(types).toContain("language");
    });

    it("returns valid media types", () => {
      const types = service.getValidMediaTypes();
      expect(types).toContain("image");
      expect(types).toContain("audio");
      expect(types).toContain("video");
    });
  });
});

describe("TsvStorage media asset loading", () => {
  it("loads media assets from lexicons directory", async () => {
    const { TsvStorage } = await import("../server/tsv-storage");
    const tsvStorage = new TsvStorage();
    const assets = await tsvStorage.getMediaAssets();
    // Should load from actual data/source/lexicons/media-assets.tsv
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets[0]).toHaveProperty("id");
    expect(assets[0]).toHaveProperty("entityType");
    expect(assets[0]).toHaveProperty("url");
    expect(assets[0]).toHaveProperty("tags");
  });

  it("filters by entityType", async () => {
    const { TsvStorage } = await import("../server/tsv-storage");
    const tsvStorage = new TsvStorage();
    const assets = await tsvStorage.getMediaAssets({ entityType: "art_tradition" });
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(a.entityType).toBe("art_tradition");
    }
  });

  it("gets asset by id", async () => {
    const { TsvStorage } = await import("../server/tsv-storage");
    const tsvStorage = new TsvStorage();
    const asset = await tsvStorage.getMediaAssetById("media-001");
    expect(asset).not.toBeNull();
    expect(asset!.id).toBe("media-001");
  });

  it("gets assets for entity", async () => {
    const { TsvStorage } = await import("../server/tsv-storage");
    const tsvStorage = new TsvStorage();
    const assets = await tsvStorage.getMediaAssetsForEntity("art_tradition", "art-001");
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(a.entityType).toBe("art_tradition");
      expect(a.entityId).toBe("art-001");
    }
  });
});
