import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import type { TradeGood, TradeRoute } from "../tsv-storage";

interface ScrapedTradeGood {
  name: string;
  category: string;
  originRegion: string;
  originLat: number;
  originLng: number;
  tradeRoutes: string[];
  timePeriod: string;
  economicSignificance: string;
  associatedLanguages: string[];
}

interface ScrapedTradeRoute {
  name: string;
  routeType: string;
  waypointsCoordinates: number[][];
  startDate: string;
  endDate: string;
  tradedGoods: string[];
  keyCities: string[];
  controllingPowers: string[];
  associatedLanguages: string[];
  description: string;
  economicImpact: string;
}

export class TradeGoodsScraper {
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
      statusMessage?: string;
    }
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  async scrapeTradeGoods(options: {
    existingGoods?: TradeGood[];
    existingRoutes?: TradeRoute[];
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  } = {}): Promise<{ goods: TradeGood[]; routes: TradeRoute[] }> {
    const { existingGoods = [], existingRoutes = [], jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (TradeGoodsScraper.isScraping) {
      throw new Error("Trade goods scraping is already in progress");
    }

    TradeGoodsScraper.isScraping = true;

    try {
      console.log("Starting trade goods and economic data scraping...");

      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("progress", "Scraping trade goods...");
      }

      // Step 1: Scrape trade goods
      const newGoods = await this.scrapeGoodsFromGemini(existingGoods, progressCallback);

      this.updateJobStatus(jobId, {
        completedWords: 1,
        totalWords: 2,
        statusMessage: `Scraped ${newGoods.length} trade goods`,
      });

      if (progressCallback) {
        progressCallback("progress", `Scraped ${newGoods.length} trade goods. Now scraping trade routes...`);
      }

      // Step 2: Scrape trade routes
      const newRoutes = await this.scrapeRoutesFromGemini(existingRoutes, progressCallback);

      this.updateJobStatus(jobId, {
        completedWords: 2,
        statusMessage: `Scraped ${newRoutes.length} trade routes`,
      });

      if (progressCallback) {
        progressCallback("progress", "Writing TSV files...");
      }

      // Merge existing and new data
      const allGoods = [...existingGoods, ...newGoods];
      const allRoutes = [...existingRoutes, ...newRoutes];

      // Write TSV files
      await tsvWriter.writeTradeGoodsTSV(allGoods, "lexicons/trade-goods.tsv");
      await tsvWriter.writeTradeRoutesTSV(allRoutes, "lexicons/trade-routes.tsv");

      this.updateJobStatus(jobId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("completed", `Scraping completed: ${newGoods.length} goods, ${newRoutes.length} routes added`);
      }

      console.log(`Trade goods scraping completed: ${newGoods.length} goods, ${newRoutes.length} routes`);

      return { goods: allGoods, routes: allRoutes };
    } catch (error) {
      console.error("Error during trade goods scraping:", error);

      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });

      if (progressCallback) {
        progressCallback("error", `Scraping failed: ${error}`);
      }
      throw error;
    } finally {
      TradeGoodsScraper.isScraping = false;
    }
  }

  private async scrapeGoodsFromGemini(
    existingGoods: TradeGood[],
    progressCallback?: (type: string, message: string, data?: any) => void,
  ): Promise<TradeGood[]> {
    const existingNames = existingGoods.map(g => g.name.toLowerCase());
    const nextId = existingGoods.length > 0
      ? Math.max(...existingGoods.map(g => parseInt(g.id.replace("tg-", ""), 10) || 0)) + 1
      : 1;

    const excludeNote = existingNames.length > 0
      ? `\n\nDO NOT include goods we already have:\n${existingNames.join(", ")}`
      : "";

    const prompt = `You are a historical economist and trade specialist. Generate a list of 30 historically significant trade goods and commodities that were important in global trade networks.${excludeNote}

Focus on goods from these categories:
- Precious metals and gemstones (gold, silver, diamonds, emeralds)
- Textiles and fibers (silk, cotton, wool, linen, dyes)
- Spices and aromatics (pepper, cinnamon, clove, frankincense)
- Agricultural products (grain, rice, sugar, tea, coffee, tobacco)
- Animal products (furs, ivory, leather, horses, slaves)
- Minerals and materials (salt, obsidian, tin, copper, iron, coal)
- Luxury goods (porcelain, glass, jade, lacquerware)
- Naval stores and raw materials (timber, tar, rubber)
- Manufactured goods (weapons, textiles, tools)
- Narcotics and stimulants (opium, coca, betel)

For each good provide:
- Accurate origin region and coordinates
- Relevant trade route IDs from existing routes (e.g., "silk-road", "spice-trade", "trans-saharan-trade")
- Time period in format "-3000 to present" or "-1000 to 1500"
- Economic significance (1-2 sentences)
- ISO 639-2/3 language codes for associated languages`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            goods: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  category: { type: SchemaType.STRING },
                  originRegion: { type: SchemaType.STRING },
                  originLat: { type: SchemaType.NUMBER },
                  originLng: { type: SchemaType.NUMBER },
                  tradeRoutes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  timePeriod: { type: SchemaType.STRING },
                  economicSignificance: { type: SchemaType.STRING },
                  associatedLanguages: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                },
                required: ["name", "category", "originRegion", "originLat", "originLng", "tradeRoutes", "timePeriod", "economicSignificance", "associatedLanguages"],
              },
            },
          },
          required: ["goods"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.goods)) {
      throw new Error("Invalid response structure from Gemini for trade goods");
    }

    if (progressCallback) {
      progressCallback("progress", `Received ${parsed.goods.length} trade goods from Gemini`);
    }

    return parsed.goods.map((good: ScrapedTradeGood, i: number) => ({
      id: `tg-${String(nextId + i).padStart(3, "0")}`,
      name: good.name,
      category: good.category,
      originRegion: good.originRegion,
      originCoordinates: { lat: good.originLat, lng: good.originLng },
      tradeRoutes: good.tradeRoutes,
      timePeriod: good.timePeriod,
      economicSignificance: good.economicSignificance,
      associatedLanguages: good.associatedLanguages,
    }));
  }

  private async scrapeRoutesFromGemini(
    existingRoutes: TradeRoute[],
    progressCallback?: (type: string, message: string, data?: any) => void,
  ): Promise<TradeRoute[]> {
    const existingNames = existingRoutes.map(r => r.name.toLowerCase());
    const nextId = existingRoutes.length > 0
      ? Math.max(...existingRoutes.map(r => parseInt(r.id.replace("tr-", ""), 10) || 0)) + 1
      : 1;

    const excludeNote = existingNames.length > 0
      ? `\n\nDO NOT include routes we already have:\n${existingNames.join(", ")}`
      : "";

    const prompt = `You are a historical economist and trade specialist. Generate a list of 15 historically significant trade routes that were important in global economic networks.${excludeNote}

Include routes from different eras and regions:
- Ancient trade networks (Bronze Age, Classical antiquity)
- Medieval trade routes (Islamic Golden Age, Hanseatic League)
- Early modern maritime routes (Age of Exploration, colonial trade)
- Regional trade networks (African, American, Pacific)

For each route provide:
- Route type: "land", "maritime", or "river"
- Waypoint coordinates as [longitude, latitude] pairs forming a path
- Start and end dates (negative = BCE)
- IDs of traded goods (use slugified names like "silk", "gold", "salt")
- Key cities along the route
- Controlling powers/empires
- Associated language ISO codes
- Description (1-2 sentences)
- Economic impact (1-2 sentences)`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            routes: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  routeType: { type: SchemaType.STRING },
                  waypointsCoordinates: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER } },
                  },
                  startDate: { type: SchemaType.STRING },
                  endDate: { type: SchemaType.STRING },
                  tradedGoods: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  keyCities: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  controllingPowers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  associatedLanguages: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                  description: { type: SchemaType.STRING },
                  economicImpact: { type: SchemaType.STRING },
                },
                required: ["name", "routeType", "waypointsCoordinates", "startDate", "endDate", "tradedGoods", "keyCities", "controllingPowers", "associatedLanguages", "description", "economicImpact"],
              },
            },
          },
          required: ["routes"],
        },
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.routes)) {
      throw new Error("Invalid response structure from Gemini for trade routes");
    }

    if (progressCallback) {
      progressCallback("progress", `Received ${parsed.routes.length} trade routes from Gemini`);
    }

    return parsed.routes.map((route: ScrapedTradeRoute, i: number) => ({
      id: `tr-${String(nextId + i).padStart(3, "0")}`,
      name: route.name,
      routeType: route.routeType,
      waypoints: {
        type: "LineString",
        coordinates: route.waypointsCoordinates,
      },
      startDate: route.startDate,
      endDate: route.endDate,
      tradedGoods: route.tradedGoods,
      keyCities: route.keyCities,
      controllingPowers: route.controllingPowers,
      associatedLanguages: route.associatedLanguages,
      description: route.description,
      economicImpact: route.economicImpact,
    }));
  }
}

export const tradeGoodsScraper = new TradeGoodsScraper();
