import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";
import { jobStore } from "./job-store";

export interface BattleEntry {
  id: string;
  name: string;
  date: string;
  coordinates: [number, number];
  belligerents: Array<{ name: string; civilization_id: string | null }>;
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

interface ScrapedBattle {
  name: string;
  date: number;
  latitude: number;
  longitude: number;
  belligerents: Array<{ name: string; civilizationId: string | null }>;
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

const BATTLES_FILE = "data/source/lexicons/battles.tsv";

const BATTLE_HEADERS = [
  "id",
  "name",
  "date",
  "coordinates",
  "belligerents",
  "outcome",
  "casualties_estimate",
  "significance",
  "associated_language_changes",
  "war_name",
];

const ERA_PROMPTS = [
  {
    era: "Ancient (before 500 CE)",
    prompt: `Generate 30 historically significant battles from the ancient world (before 500 CE). Include battles from:
- Mesopotamia and Egypt (e.g., Kadesh, Megiddo)
- Greek and Persian conflicts (e.g., Marathon, Plataea, Issus)
- Roman wars (e.g., Cannae, Alesia, Actium, Adrianople)
- Chinese warfare (e.g., Red Cliffs, Changping, Muye)
- Indian warfare (e.g., Hydaspes, Kalinga)
- Other regions (Carthage, Persia, etc.)
Focus on battles that changed borders, spread or displaced languages, or shifted cultural dominance.`,
  },
  {
    era: "Medieval (500-1500 CE)",
    prompt: `Generate 30 historically significant battles from the medieval period (500-1500 CE). Include battles from:
- Islamic expansion (e.g., Yarmouk, Tours/Poitiers, Ain Jalut)
- Crusades (e.g., Hattin, Arsuf, Constantinople 1204)
- Mongol conquests (e.g., Kalka River, Mohi, Baghdad)
- European conflicts (e.g., Hastings, Crécy, Agincourt, Kosovo)
- East Asian conflicts (e.g., Baekgang, Dan-no-ura, Noryang)
- Other regions (Byzantine, Indian, African kingdoms)
Focus on battles that changed borders, spread or displaced languages, or shifted cultural dominance.`,
  },
  {
    era: "Early Modern (1500-1800 CE)",
    prompt: `Generate 30 historically significant battles from the early modern period (1500-1800 CE). Include battles from:
- Colonial conquests (e.g., Tenochtitlan, Cajamarca, Plassey)
- Ottoman conflicts (e.g., Mohács, Lepanto, Vienna 1683)
- European wars (e.g., Breitenfeld, Blenheim, Poltava, Rossbach)
- Asian conflicts (e.g., Panipat, Sekigahara, Sarhu)
- Independence wars (e.g., Saratoga, Yorktown)
Focus on battles that changed borders, spread or displaced languages, or shifted cultural dominance.`,
  },
  {
    era: "Modern (1800-present)",
    prompt: `Generate 30 historically significant battles from the modern period (1800-present). Include battles from:
- Napoleonic Wars (e.g., Austerlitz, Borodino, Waterloo)
- American Civil War (e.g., Gettysburg, Vicksburg)
- World War I (e.g., Marne, Verdun, Gallipoli, Tannenberg)
- World War II (e.g., Stalingrad, Midway, Normandy, Kursk, Berlin)
- Colonial/independence wars (e.g., Adwa, Dien Bien Phu, Isandlwana)
- Other conflicts (e.g., Tsushima, Inchon, 73 Easting)
Focus on battles that changed borders, spread or displaced languages, or shifted cultural dominance.`,
  },
];

export class BattleScraper {
  private static isScraping = false;

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private getExistingBattleIds(): Set<string> {
    const ids = new Set<string>();
    if (!fs.existsSync(BATTLES_FILE)) return ids;

    const content = fs.readFileSync(BATTLES_FILE, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (cols[0]) ids.add(cols[0]);
    }
    return ids;
  }

  private battleToTsvRow(battle: BattleEntry): string {
    return [
      battle.id,
      battle.name,
      battle.date,
      JSON.stringify(battle.coordinates),
      JSON.stringify(battle.belligerents),
      battle.outcome,
      battle.casualtiesEstimate,
      battle.significance,
      battle.associatedLanguageChanges,
      battle.warName,
    ].join("\t");
  }

  private async writeBattles(battles: BattleEntry[]): Promise<void> {
    const dir = path.dirname(BATTLES_FILE);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${BATTLES_FILE}.tmp`;
    const headerLine = BATTLE_HEADERS.join("\t");
    const dataLines = battles.map((b) => this.battleToTsvRow(b));
    const content = [headerLine, ...dataLines].join("\n") + "\n";

    await fs.promises.writeFile(tempFile, content, "utf8");
    await fs.promises.rename(tempFile, BATTLES_FILE);
    console.log(`Wrote ${battles.length} battles to ${BATTLES_FILE}`);
  }

  private convertScrapedBattle(scraped: ScrapedBattle): BattleEntry {
    const id = `battle-${this.slugify(scraped.name)}`;
    return {
      id,
      name: scraped.name,
      date: scraped.date.toString(),
      coordinates: [scraped.latitude, scraped.longitude],
      belligerents: scraped.belligerents.map((b) => ({
        name: b.name,
        civilization_id: b.civilizationId || null,
      })),
      outcome: scraped.outcome,
      casualtiesEstimate: scraped.casualtiesEstimate || "",
      significance: scraped.significance,
      associatedLanguageChanges: scraped.associatedLanguageChanges || "",
      warName: scraped.warName,
    };
  }

  private async scrapeEra(
    eraPrompt: { era: string; prompt: string },
    existingIds: Set<string>,
    progressCallback?: (type: string, message: string, data?: unknown) => void
  ): Promise<BattleEntry[]> {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY not set");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            battles: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  date: { type: SchemaType.NUMBER },
                  latitude: { type: SchemaType.NUMBER },
                  longitude: { type: SchemaType.NUMBER },
                  belligerents: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        name: { type: SchemaType.STRING },
                        civilizationId: {
                          type: SchemaType.STRING,
                          nullable: true,
                        },
                      },
                      required: ["name"],
                    },
                  },
                  outcome: { type: SchemaType.STRING },
                  casualtiesEstimate: { type: SchemaType.STRING },
                  significance: { type: SchemaType.STRING },
                  associatedLanguageChanges: { type: SchemaType.STRING },
                  warName: { type: SchemaType.STRING },
                },
                required: [
                  "name",
                  "date",
                  "latitude",
                  "longitude",
                  "belligerents",
                  "outcome",
                  "significance",
                  "warName",
                ],
              },
            },
          },
          required: ["battles"],
        },
      },
    });

    const fullPrompt = `You are a military historian. ${eraPrompt.prompt}

For each battle provide:
- name: Official battle name (e.g., "Battle of Thermopylae")
- date: Year as integer (BCE as negative, e.g., -480 for 480 BCE)
- latitude/longitude: Approximate coordinates of the battlefield
- belligerents: Array of combatant sides with name and optional civilizationId (use kebab-case like "roman-empire", "ancient-greece")
- outcome: Brief result description
- casualtiesEstimate: Approximate total casualties (e.g., "~50000")
- significance: Why this battle mattered historically
- associatedLanguageChanges: How this battle affected languages in the region
- warName: Name of the larger war/conflict

Avoid duplicates. Each battle should be distinct and well-documented historically.`;

    const result = await model.generateContent(fullPrompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed?.battles || !Array.isArray(parsed.battles)) {
      throw new Error(`Invalid response for era: ${eraPrompt.era}`);
    }

    const battles: BattleEntry[] = [];
    for (const scraped of parsed.battles) {
      const entry = this.convertScrapedBattle(scraped);
      if (!existingIds.has(entry.id)) {
        battles.push(entry);
        existingIds.add(entry.id);
      }
    }

    if (progressCallback) {
      progressCallback(
        "progress",
        `Scraped ${battles.length} new battles for ${eraPrompt.era}`
      );
    }

    return battles;
  }

  async scrapeBattles(options: {
    clearExisting?: boolean;
    eraFilter?: string;
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: unknown) => void;
  } = {}): Promise<BattleEntry[]> {
    const { clearExisting = false, eraFilter, jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (BattleScraper.isScraping) {
      throw new Error("Battle scraping is already in progress");
    }

    BattleScraper.isScraping = true;

    try {
      console.log("Starting battle and military history scraping...");

      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "running",
          startedAt: new Date().toISOString(),
        });
      }

      const existingIds = clearExisting ? new Set<string>() : this.getExistingBattleIds();

      // Load existing battles if not clearing
      let allBattles: BattleEntry[] = [];
      if (!clearExisting && fs.existsSync(BATTLES_FILE)) {
        const content = fs.readFileSync(BATTLES_FILE, "utf8");
        const lines = content.split("\n").filter((l) => l.trim() !== "");
        if (lines.length > 1) {
          const header = lines[0].split("\t");
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split("\t");
            const idIdx = header.indexOf("id");
            const nameIdx = header.indexOf("name");
            const dateIdx = header.indexOf("date");
            const coordIdx = header.indexOf("coordinates");
            const bellIdx = header.indexOf("belligerents");
            const outIdx = header.indexOf("outcome");
            const casIdx = header.indexOf("casualties_estimate");
            const sigIdx = header.indexOf("significance");
            const langIdx = header.indexOf("associated_language_changes");
            const warIdx = header.indexOf("war_name");

            allBattles.push({
              id: cols[idIdx] || "",
              name: cols[nameIdx] || "",
              date: cols[dateIdx] || "",
              coordinates: (() => {
                try {
                  return JSON.parse(cols[coordIdx] || "[0,0]");
                } catch {
                  return [0, 0] as [number, number];
                }
              })(),
              belligerents: (() => {
                try {
                  return JSON.parse(cols[bellIdx] || "[]");
                } catch {
                  return [];
                }
              })(),
              outcome: cols[outIdx] || "",
              casualtiesEstimate: cols[casIdx] || "",
              significance: cols[sigIdx] || "",
              associatedLanguageChanges: cols[langIdx] || "",
              warName: cols[warIdx] || "",
            });
          }
        }
      }

      if (progressCallback) {
        progressCallback("progress", `Starting with ${allBattles.length} existing battles`);
      }

      const eras = eraFilter
        ? ERA_PROMPTS.filter((e) => e.era.toLowerCase().includes(eraFilter.toLowerCase()))
        : ERA_PROMPTS;

      if (jobId) {
        jobStore.updateJob(jobId, { totalWords: eras.length });
      }

      for (let i = 0; i < eras.length; i++) {
        const era = eras[i];
        if (progressCallback) {
          progressCallback("progress", `Scraping era ${i + 1}/${eras.length}: ${era.era}...`);
        }

        try {
          const newBattles = await this.scrapeEra(era, existingIds, progressCallback);
          allBattles.push(...newBattles);
          console.log(`  → Scraped ${newBattles.length} battles for ${era.era}`);

          if (jobId) {
            jobStore.updateJob(jobId, { completedWords: i + 1 });
          }
        } catch (error) {
          console.error(`Failed to scrape era ${era.era}:`, error);
          if (progressCallback) {
            progressCallback("error", `Failed to scrape ${era.era}: ${error}`);
          }
        }
      }

      // Sort by date
      allBattles.sort((a, b) => parseInt(a.date) - parseInt(b.date));

      // Write to TSV
      if (progressCallback) {
        progressCallback("progress", "Writing battles to TSV...");
      }

      await this.writeBattles(allBattles);

      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "completed",
          completedWords: eras.length,
          completedAt: new Date().toISOString(),
        });
      }

      if (progressCallback) {
        progressCallback("completed", `Scraping completed: ${allBattles.length} total battles`);
      }

      console.log(`Battle scraping completed: ${allBattles.length} total battles`);
      return allBattles;
    } catch (error) {
      console.error("Error during battle scraping:", error);

      if (jobId) {
        jobStore.updateJob(jobId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          completedAt: new Date().toISOString(),
        });
      }

      if (progressCallback) {
        progressCallback("error", `Scraping failed: ${error}`);
      }
      throw error;
    } finally {
      BattleScraper.isScraping = false;
    }
  }
}

export const battleScraper = new BattleScraper();
