import fs from "node:fs";
import path from "node:path";
import type { WikimediaCommonsImage } from "../tsv-storage";
import { jobStore } from "./job-store";

const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";

const CULTURAL_CATEGORIES = [
  "Cultural_heritage",
  "Archaeological_artifacts",
  "Ancient_art",
  "Traditional_architecture",
  "Religious_architecture",
  "World_Heritage_Sites",
  "Historical_monuments_and_memorials",
  "Sacred_places",
  "Traditional_clothing",
  "Musical_instruments_by_country",
  "Masks_by_country",
  "Pottery_by_country",
  "Sculptures_by_country",
  "Ancient_monuments",
  "Temples",
  "Mosques",
  "Churches_(buildings)",
  "Pagodas",
  "Castles",
  "Pyramids",
  "Stone_circles",
  "Petroglyphs",
  "Cave_paintings",
  "Totem_poles",
  "Textile_arts",
];

interface WikimediaApiResponse {
  query?: {
    categorymembers?: Array<{
      pageid: number;
      title: string;
    }>;
  };
  continue?: {
    cmcontinue: string;
  };
}

interface WikimediaImageInfoResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid: number;
        title: string;
        imageinfo?: Array<{
          url: string;
          thumburl?: string;
          extmetadata?: Record<
            string,
            { value: string }
          >;
          timestamp?: string;
        }>;
        categories?: Array<{ title: string }>;
        coordinates?: Array<{ lat: number; lon: number }>;
      }
    >;
  };
}

/**
 * Where scraped images are persisted. Overridable via `WIKIMEDIA_COMMONS_TSV` so tests never
 * write into the real `data/source/lexicons/` tree — a unit test that drops an unmapped TSV there races
 * `contracts/lexicon-mapping.test.ts` (which reads the live directory) and can clobber curated data.
 */
export const WIKIMEDIA_COMMONS_TSV_PATH = (): string =>
  path.resolve(process.env.WIKIMEDIA_COMMONS_TSV ?? "data/source/lexicons/wikimedia-commons-images.tsv");

export class WikimediaCommonsScraper {
  private static isScraping = false;

  private updateJobStatus(
    jobId: string | undefined,
    updates: {
      status?: string;
      completedWords?: number;
      totalWords?: number;
      errorMessage?: string;
      startedAt?: string;
      completedAt?: string;
    }
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/^file:/i, "")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .substring(0, 80);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getCategoryMembers(
    category: string,
    limit: number = 50
  ): Promise<Array<{ pageid: number; title: string }>> {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${category}`,
      cmtype: "file",
      cmnamespace: "6",
      cmlimit: String(Math.min(limit, 50)),
      format: "json",
      origin: "*",
    });

    const results: Array<{ pageid: number; title: string }> = [];
    let continueToken: string | undefined;

    while (results.length < limit) {
      const url = `${COMMONS_API_URL}?${params.toString()}${continueToken ? `&cmcontinue=${encodeURIComponent(continueToken)}` : ""}`;
      const data = await this.fetchJson<WikimediaApiResponse>(url);

      if (data.query?.categorymembers) {
        results.push(...data.query.categorymembers);
      }

      if (!data.continue?.cmcontinue || results.length >= limit) break;
      continueToken = data.continue.cmcontinue;
      await this.delay(300);
    }

    return results.slice(0, limit);
  }

  async getImageInfo(
    pageIds: number[]
  ): Promise<WikimediaCommonsImage[]> {
    if (pageIds.length === 0) return [];

    const batchSize = 20;
    const allImages: WikimediaCommonsImage[] = [];

    for (let i = 0; i < pageIds.length; i += batchSize) {
      const batch = pageIds.slice(i, i + batchSize);
      const params = new URLSearchParams({
        action: "query",
        pageids: batch.join("|"),
        prop: "imageinfo|categories|coordinates",
        iiprop: "url|extmetadata|timestamp",
        iiurlwidth: "400",
        cllimit: "50",
        format: "json",
        origin: "*",
      });

      const url = `${COMMONS_API_URL}?${params.toString()}`;
      const data = await this.fetchJson<WikimediaImageInfoResponse>(url);

      if (data.query?.pages) {
        for (const page of Object.values(data.query.pages)) {
          const info = page.imageinfo?.[0];
          if (!info) continue;

          const meta = info.extmetadata || {};
          const categories = (page.categories || []).map((c) =>
            c.title.replace(/^Category:/, "")
          );

          const coords = page.coordinates?.[0] ?? null;
          const description = this.cleanHtml(
            meta.ImageDescription?.value || ""
          );
          const artist = this.cleanHtml(meta.Artist?.value || "");
          const license = meta.LicenseShortName?.value || "Unknown";
          const dateCreated =
            meta.DateTimeOriginal?.value || info.timestamp || "";

          const { culture, artifactType, region, languageIds } =
            this.inferCulturalMetadata(
              page.title,
              description,
              categories
            );

          const image: WikimediaCommonsImage = {
            id: this.slugify(page.title),
            title: page.title.replace(/^File:/, ""),
            description: description.substring(0, 500),
            imageUrl: info.url,
            thumbUrl: info.thumburl || info.url,
            artist,
            license,
            categories,
            coordinates: coords
              ? { lat: coords.lat, lng: coords.lon }
              : null,
            dateCreated,
            associatedCulture: culture,
            associatedLanguageIds: languageIds,
            artifactType,
            region,
            source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
          };

          allImages.push(image);
        }
      }

      if (i + batchSize < pageIds.length) {
        await this.delay(300);
      }
    }

    return allImages;
  }

  private cleanHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private inferCulturalMetadata(
    title: string,
    description: string,
    categories: string[]
  ): {
    culture: string;
    artifactType: string;
    region: string;
    languageIds: string[];
  } {
    const text = `${title} ${description} ${categories.join(" ")}`.toLowerCase();

    const cultureMap: Record<string, { culture: string; region: string; languageIds: string[] }> = {
      egypt: { culture: "Ancient Egyptian", region: "North Africa", languageIds: ["egy"] },
      greek: { culture: "Ancient Greek", region: "Southern Europe", languageIds: ["el"] },
      roman: { culture: "Roman", region: "Southern Europe", languageIds: ["la"] },
      byzantine: { culture: "Byzantine", region: "Eastern Europe", languageIds: ["el"] },
      persian: { culture: "Persian", region: "Middle East", languageIds: ["fa"] },
      islamic: { culture: "Islamic", region: "Middle East", languageIds: ["ar"] },
      chinese: { culture: "Chinese", region: "East Asia", languageIds: ["zh"] },
      japanese: { culture: "Japanese", region: "East Asia", languageIds: ["ja"] },
      indian: { culture: "Indian", region: "South Asia", languageIds: ["hi", "sa"] },
      hindu: { culture: "Hindu", region: "South Asia", languageIds: ["sa"] },
      buddhist: { culture: "Buddhist", region: "South Asia", languageIds: ["sa", "pi"] },
      maya: { culture: "Maya", region: "Central America", languageIds: [] },
      aztec: { culture: "Aztec", region: "Central America", languageIds: ["nah"] },
      inca: { culture: "Inca", region: "South America", languageIds: ["qu"] },
      celtic: { culture: "Celtic", region: "Western Europe", languageIds: ["ga", "cy"] },
      viking: { culture: "Norse", region: "Northern Europe", languageIds: ["non"] },
      norse: { culture: "Norse", region: "Northern Europe", languageIds: ["non"] },
      african: { culture: "African", region: "Sub-Saharan Africa", languageIds: [] },
      ottoman: { culture: "Ottoman", region: "Middle East", languageIds: ["tr"] },
      khmer: { culture: "Khmer", region: "Southeast Asia", languageIds: ["km"] },
      thai: { culture: "Thai", region: "Southeast Asia", languageIds: ["th"] },
      korean: { culture: "Korean", region: "East Asia", languageIds: ["ko"] },
      tibetan: { culture: "Tibetan", region: "Central Asia", languageIds: ["bo"] },
      polynesian: { culture: "Polynesian", region: "Oceania", languageIds: [] },
      aboriginal: { culture: "Aboriginal Australian", region: "Oceania", languageIds: [] },
      mesopotamia: { culture: "Mesopotamian", region: "Middle East", languageIds: ["akk"] },
      sumerian: { culture: "Sumerian", region: "Middle East", languageIds: ["sux"] },
    };

    let culture = "";
    let region = "";
    let languageIds: string[] = [];

    for (const [keyword, meta] of Object.entries(cultureMap)) {
      if (text.includes(keyword)) {
        culture = meta.culture;
        region = meta.region;
        languageIds = meta.languageIds;
        break;
      }
    }

    const artifactTypes: Record<string, string> = {
      temple: "temple",
      mosque: "mosque",
      church: "church",
      cathedral: "cathedral",
      palace: "palace",
      castle: "castle",
      fortress: "fortress",
      pyramid: "pyramid",
      stupa: "stupa",
      pagoda: "pagoda",
      statue: "sculpture",
      sculpture: "sculpture",
      mask: "mask",
      pottery: "pottery",
      ceramic: "pottery",
      textile: "textile",
      weaving: "textile",
      jewelry: "jewelry",
      coin: "numismatic",
      painting: "painting",
      mural: "mural",
      fresco: "painting",
      mosaic: "mosaic",
      petroglyph: "rock_art",
      "cave painting": "rock_art",
      "rock art": "rock_art",
      manuscript: "manuscript",
      inscription: "inscription",
      stele: "stele",
      totem: "totem",
      monument: "monument",
      tomb: "funerary",
      sarcophagus: "funerary",
      relief: "relief",
      carving: "carving",
      instrument: "musical_instrument",
    };

    let artifactType = "cultural_artifact";
    for (const [keyword, type] of Object.entries(artifactTypes)) {
      if (text.includes(keyword)) {
        artifactType = type;
        break;
      }
    }

    return { culture, artifactType, region, languageIds };
  }

  private loadExistingIds(): Set<string> {
    const filePath = WIKIMEDIA_COMMONS_TSV_PATH();
    if (!fs.existsSync(filePath)) return new Set();

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      const ids = new Set<string>();
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols[0]) ids.add(cols[0]);
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  async scrapeImages(options: {
    categories?: string[];
    maxPerCategory?: number;
    jobId?: string;
    progressCallback?: (type: string, message: string) => void;
  } = {}): Promise<{ images: WikimediaCommonsImage[]; count: number }> {
    const {
      categories = CULTURAL_CATEGORIES,
      maxPerCategory = 20,
      jobId,
      progressCallback,
    } = options;

    if (WikimediaCommonsScraper.isScraping) {
      throw new Error("Wikimedia Commons scraping is already in progress");
    }

    WikimediaCommonsScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        totalWords: categories.length * maxPerCategory,
        startedAt: new Date().toISOString(),
      });

      const existingIds = this.loadExistingIds();
      const allImages: WikimediaCommonsImage[] = [];
      let processedCategories = 0;

      for (const category of categories) {
        progressCallback?.(
          "progress",
          `Scraping category ${processedCategories + 1}/${categories.length}: ${category}`
        );

        try {
          const members = await this.getCategoryMembers(
            category,
            maxPerCategory
          );

          if (members.length > 0) {
            const images = await this.getImageInfo(
              members.map((m) => m.pageid)
            );

            const newImages = images.filter(
              (img) => !existingIds.has(img.id)
            );

            for (const img of newImages) {
              existingIds.add(img.id);
              allImages.push(img);
            }

            progressCallback?.(
              "progress",
              `Found ${newImages.length} new images from ${category}`
            );
          }
        } catch (error) {
          console.error(`Error scraping category ${category}:`, error);
          progressCallback?.(
            "warning",
            `Failed to scrape category ${category}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }

        processedCategories++;
        this.updateJobStatus(jobId, {
          completedWords: allImages.length,
        });

        await this.delay(500);
      }

      if (allImages.length > 0) {
        await this.writeImagesTSV(allImages);
      }

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: allImages.length,
        totalWords: allImages.length,
        completedAt: new Date().toISOString(),
      });

      progressCallback?.(
        "complete",
        `Scraped ${allImages.length} images from ${categories.length} categories`
      );

      return { images: allImages, count: allImages.length };
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      WikimediaCommonsScraper.isScraping = false;
    }
  }

  private async writeImagesTSV(
    newImages: WikimediaCommonsImage[]
  ): Promise<void> {
    const filePath = WIKIMEDIA_COMMONS_TSV_PATH();
    const headers = [
      "id",
      "title",
      "description",
      "image_url",
      "thumb_url",
      "artist",
      "license",
      "categories",
      "coordinates",
      "date_created",
      "associated_culture",
      "associated_language_ids",
      "artifact_type",
      "region",
      "source",
    ];

    let existingRows: string[][] = [];
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      existingRows = lines.slice(1).map((line) => line.split("\t"));
    }

    const newRows = newImages.map((img) => [
      img.id,
      img.title,
      img.description.replace(/\t/g, " ").replace(/\n/g, " "),
      img.imageUrl,
      img.thumbUrl,
      img.artist.replace(/\t/g, " ").replace(/\n/g, " "),
      img.license,
      JSON.stringify(img.categories),
      img.coordinates ? JSON.stringify(img.coordinates) : "",
      img.dateCreated,
      img.associatedCulture,
      JSON.stringify(img.associatedLanguageIds),
      img.artifactType,
      img.region,
      img.source,
    ]);

    const allRows = [...existingRows, ...newRows];

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${filePath}.tmp`;
    const headerLine = headers.join("\t");
    const dataLines = allRows.map((row) => row.join("\t"));
    const tsvContent = [headerLine, ...dataLines].join("\n") + "\n";

    await fs.promises.writeFile(tempFile, tsvContent, "utf8");
    await fs.promises.rename(tempFile, filePath);

    console.log(
      `Wrote ${allRows.length} images to ${filePath} (${newRows.length} new)`
    );
  }
}

export const wikimediaCommonsScraper = new WikimediaCommonsScraper();
