import fs from "node:fs";
import path from "node:path";
import type { MediaAsset } from "../tsv-storage";
import { TsvWriter } from "./tsv-writer";

const MEDIA_ASSETS_FILE = "data/source/lexicons/media-assets.tsv";

const VALID_ENTITY_TYPES = [
  "art_tradition",
  "archaeological_site",
  "archaeological_culture",
  "civilization",
  "culture_profile",
  "writing_system",
  "music_tradition",
  "dance_tradition",
  "language",
  "language_family",
  "religion",
  "deity",
  "cuisine",
  "literary_tradition",
  "literary_work",
  "architectural_style",
  "building_type",
  "settlement",
  "empire",
  "trade_route",
] as const;

const VALID_MEDIA_TYPES = ["image", "audio", "video", "document"] as const;

export interface CreateMediaAssetInput {
  entityType: string;
  entityId: string;
  mediaType: string;
  url: string;
  title: string;
  description?: string;
  source?: string;
  license?: string;
  attribution?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  tags?: string[];
}

export interface MediaAssetValidationError {
  field: string;
  message: string;
}

export class MediaAssetService {
  private lexiconsDir: string;
  private tsvWriter: TsvWriter;

  constructor(lexiconsDir: string) {
    this.lexiconsDir = lexiconsDir;
    this.tsvWriter = new TsvWriter();
  }

  private getFilePath(): string {
    return path.join(this.lexiconsDir, "media-assets.tsv");
  }

  validate(input: CreateMediaAssetInput): MediaAssetValidationError[] {
    const errors: MediaAssetValidationError[] = [];

    if (!input.entityType) {
      errors.push({ field: "entityType", message: "entityType is required" });
    } else if (!(VALID_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
      errors.push({ field: "entityType", message: `Invalid entityType: ${input.entityType}` });
    }

    if (!input.entityId) {
      errors.push({ field: "entityId", message: "entityId is required" });
    }

    if (!input.mediaType) {
      errors.push({ field: "mediaType", message: "mediaType is required" });
    } else if (!(VALID_MEDIA_TYPES as readonly string[]).includes(input.mediaType)) {
      errors.push({ field: "mediaType", message: `Invalid mediaType: ${input.mediaType}` });
    }

    if (!input.url) {
      errors.push({ field: "url", message: "url is required" });
    }

    if (!input.title) {
      errors.push({ field: "title", message: "title is required" });
    }

    if (input.width !== undefined && (input.width < 0 || !Number.isInteger(input.width))) {
      errors.push({ field: "width", message: "width must be a non-negative integer" });
    }

    if (input.height !== undefined && (input.height < 0 || !Number.isInteger(input.height))) {
      errors.push({ field: "height", message: "height must be a non-negative integer" });
    }

    return errors;
  }

  private generateId(existingAssets: MediaAsset[]): string {
    let maxNum = 0;
    for (const asset of existingAssets) {
      const match = asset.id.match(/^media-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return `media-${String(maxNum + 1).padStart(3, "0")}`;
  }

  async loadAssets(): Promise<MediaAsset[]> {
    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length <= 1) return [];

    const header = lines[0].split("\t");
    const idIdx = header.indexOf("id");
    const entityTypeIdx = header.indexOf("entity_type");
    const entityIdIdx = header.indexOf("entity_id");
    const mediaTypeIdx = header.indexOf("media_type");
    const urlIdx = header.indexOf("url");
    const titleIdx = header.indexOf("title");
    const descIdx = header.indexOf("description");
    const sourceIdx = header.indexOf("source");
    const licenseIdx = header.indexOf("license");
    const attrIdx = header.indexOf("attribution");
    const mimeIdx = header.indexOf("mime_type");
    const widthIdx = header.indexOf("width");
    const heightIdx = header.indexOf("height");
    const tagsIdx = header.indexOf("tags");
    const dateIdx = header.indexOf("date_added");

    return lines.slice(1).map((line) => {
      const cols = line.split("\t");
      return {
        id: cols[idIdx] ?? "",
        entityType: cols[entityTypeIdx] ?? "",
        entityId: cols[entityIdIdx] ?? "",
        mediaType: cols[mediaTypeIdx] ?? "",
        url: cols[urlIdx] ?? "",
        title: cols[titleIdx] ?? "",
        description: cols[descIdx] ?? "",
        source: cols[sourceIdx] ?? "",
        license: cols[licenseIdx] ?? "",
        attribution: cols[attrIdx] ?? "",
        mimeType: cols[mimeIdx] ?? "",
        width: cols[widthIdx] ? parseInt(cols[widthIdx]) || null : null,
        height: cols[heightIdx] ? parseInt(cols[heightIdx]) || null : null,
        tags: (() => {
          try { return JSON.parse(cols[tagsIdx]); } catch { return []; }
        })() as string[],
        dateAdded: cols[dateIdx] ?? "",
      };
    });
  }

  async addAsset(input: CreateMediaAssetInput): Promise<MediaAsset> {
    const errors = this.validate(input);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.map((e) => e.message).join(", ")}`);
    }

    const existingAssets = await this.loadAssets();
    const id = this.generateId(existingAssets);
    const today = new Date().toISOString().split("T")[0];

    const newAsset: MediaAsset = {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      mediaType: input.mediaType,
      url: input.url,
      title: input.title,
      description: input.description ?? "",
      source: input.source ?? "",
      license: input.license ?? "",
      attribution: input.attribution ?? "",
      mimeType: input.mimeType ?? "",
      width: input.width ?? null,
      height: input.height ?? null,
      tags: input.tags ?? [],
      dateAdded: today,
    };

    const allAssets = [...existingAssets, newAsset];
    await this.writeAssets(allAssets);

    return newAsset;
  }

  async deleteAsset(id: string): Promise<boolean> {
    const assets = await this.loadAssets();
    const filtered = assets.filter((a) => a.id !== id);
    if (filtered.length === assets.length) return false;
    await this.writeAssets(filtered);
    return true;
  }

  private async writeAssets(assets: MediaAsset[]): Promise<void> {
    const headers = [
      "id", "entity_type", "entity_id", "media_type", "url", "title",
      "description", "source", "license", "attribution", "mime_type",
      "width", "height", "tags", "date_added",
    ];

    const rows = assets.map((a) => [
      a.id,
      a.entityType,
      a.entityId,
      a.mediaType,
      a.url,
      a.title,
      a.description,
      a.source,
      a.license,
      a.attribution,
      a.mimeType,
      a.width?.toString() ?? "",
      a.height?.toString() ?? "",
      JSON.stringify(a.tags),
      a.dateAdded,
    ]);

    await this.tsvWriter.writeGenericTSV(this.getFilePath(), headers, rows);
  }

  getValidEntityTypes(): readonly string[] {
    return VALID_ENTITY_TYPES;
  }

  getValidMediaTypes(): readonly string[] {
    return VALID_MEDIA_TYPES;
  }
}
