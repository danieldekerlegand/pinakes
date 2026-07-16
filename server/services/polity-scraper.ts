import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";
import { jobStore } from "./job-store";

const LEXICONS_DIR = path.resolve("lexicons");
const CIVILIZATIONS_TSV = path.join(LEXICONS_DIR, "civilizations.tsv");

export interface PolityRecord {
  id: string;
  name: string;
  nativeName: string;
  timePeriodStart: number;
  timePeriodEnd: number | null;
  timePeriodLabel: string;
  associatedLanguageIds: string[];
  writingSystems: string[];
  politicalStructure: string;
  capital: string;
  population: number | null;
  haplogroupIds: string[];
  cuisineId: string;
  sources: string[];
  description: string;
}

export interface PolityScrapeOptions {
  jobId?: string;
  progressCallback?: (progress: {
    type: "progress" | "completed" | "error";
    message: string;
    completed?: number;
    total?: number;
  }) => void;
}

export interface PolityScrapeResult {
  newPolities: number;
  skippedDuplicates: number;
  errors: string[];
}

export const SESHAT_POLITIES_COUNT = 44;

/** Known Seshat polity IDs with their Wikipedia article titles */
const SESHAT_POLITIES: Array<{ seshatId: string; wikiTitle: string; fallbackName: string }> = [
  // Ancient Near East
  { seshatId: "AfAksumite", wikiTitle: "Kingdom_of_Aksum", fallbackName: "Kingdom of Aksum" },
  { seshatId: "AfBenin", wikiTitle: "Kingdom_of_Benin", fallbackName: "Kingdom of Benin" },
  { seshatId: "AfZulu", wikiTitle: "Zulu_Kingdom", fallbackName: "Zulu Kingdom" },
  { seshatId: "AfKongo", wikiTitle: "Kingdom_of_Kongo", fallbackName: "Kingdom of Kongo" },
  { seshatId: "AfEthiopia", wikiTitle: "Ethiopian_Empire", fallbackName: "Ethiopian Empire" },
  // East Asia
  { seshatId: "CnQin", wikiTitle: "Qin_dynasty", fallbackName: "Qin Dynasty" },
  { seshatId: "CnSong", wikiTitle: "Song_dynasty", fallbackName: "Song Dynasty" },
  { seshatId: "CnYuan", wikiTitle: "Yuan_dynasty", fallbackName: "Yuan Dynasty" },
  { seshatId: "CnMing", wikiTitle: "Ming_dynasty", fallbackName: "Ming Dynasty" },
  { seshatId: "CnQing", wikiTitle: "Qing_dynasty", fallbackName: "Qing Dynasty" },
  { seshatId: "JpTokugawa", wikiTitle: "Tokugawa_shogunate", fallbackName: "Tokugawa Shogunate" },
  { seshatId: "JpHeian", wikiTitle: "Heian_period", fallbackName: "Heian Japan" },
  { seshatId: "KrGoryeo", wikiTitle: "Goryeo", fallbackName: "Goryeo" },
  { seshatId: "KrJoseon", wikiTitle: "Joseon", fallbackName: "Joseon Dynasty" },
  // South / Southeast Asia
  { seshatId: "InMughal", wikiTitle: "Mughal_Empire", fallbackName: "Mughal Empire" },
  { seshatId: "InChola", wikiTitle: "Chola_dynasty", fallbackName: "Chola Dynasty" },
  { seshatId: "InMaratha", wikiTitle: "Maratha_Empire", fallbackName: "Maratha Empire" },
  { seshatId: "InVijayanagara", wikiTitle: "Vijayanagara_Empire", fallbackName: "Vijayanagara Empire" },
  { seshatId: "InDelhi", wikiTitle: "Delhi_Sultanate", fallbackName: "Delhi Sultanate" },
  { seshatId: "SeaMajapahit", wikiTitle: "Majapahit", fallbackName: "Majapahit" },
  { seshatId: "SeaSrivijaya", wikiTitle: "Srivijaya", fallbackName: "Srivijaya" },
  { seshatId: "SeaPagan", wikiTitle: "Pagan_Kingdom", fallbackName: "Pagan Kingdom" },
  { seshatId: "SeaAyutthaya", wikiTitle: "Ayutthaya_Kingdom", fallbackName: "Ayutthaya Kingdom" },
  // Middle East / Central Asia
  { seshatId: "MeSasanian", wikiTitle: "Sasanian_Empire", fallbackName: "Sasanian Empire" },
  { seshatId: "MeTimurid", wikiTitle: "Timurid_Empire", fallbackName: "Timurid Empire" },
  { seshatId: "MeSafavid", wikiTitle: "Safavid_dynasty", fallbackName: "Safavid Empire" },
  { seshatId: "MeSeljuk", wikiTitle: "Seljuk_Empire", fallbackName: "Seljuk Empire" },
  { seshatId: "MeGhaznavid", wikiTitle: "Ghaznavids", fallbackName: "Ghaznavid Empire" },
  { seshatId: "MeAbbasid", wikiTitle: "Abbasid_Caliphate", fallbackName: "Abbasid Caliphate" },
  { seshatId: "MeParthi", wikiTitle: "Parthian_Empire", fallbackName: "Parthian Empire" },
  // Europe
  { seshatId: "EuHabsburg", wikiTitle: "Habsburg_monarchy", fallbackName: "Habsburg Monarchy" },
  { seshatId: "EuVenice", wikiTitle: "Republic_of_Venice", fallbackName: "Republic of Venice" },
  { seshatId: "EuPolish", wikiTitle: "Polish%E2%80%93Lithuanian_Commonwealth", fallbackName: "Polish-Lithuanian Commonwealth" },
  { seshatId: "EuSweden", wikiTitle: "Swedish_Empire", fallbackName: "Swedish Empire" },
  { seshatId: "EuFrench", wikiTitle: "French_colonial_empire", fallbackName: "French Colonial Empire" },
  { seshatId: "EuDutch", wikiTitle: "Dutch_Empire", fallbackName: "Dutch Empire" },
  { seshatId: "EuRussian", wikiTitle: "Russian_Empire", fallbackName: "Russian Empire" },
  // Americas
  { seshatId: "AmToltec", wikiTitle: "Toltec", fallbackName: "Toltec Empire" },
  { seshatId: "AmZapotec", wikiTitle: "Zapotec_civilization", fallbackName: "Zapotec Civilization" },
  { seshatId: "AmWari", wikiTitle: "Wari_Empire", fallbackName: "Wari Empire" },
  { seshatId: "AmTiwanaku", wikiTitle: "Tiwanaku", fallbackName: "Tiwanaku" },
  { seshatId: "AmMississippian", wikiTitle: "Mississippian_culture", fallbackName: "Mississippian Culture" },
  // Oceania
  { seshatId: "OcTonga", wikiTitle: "Tu%CA%BBi_Tonga_Empire", fallbackName: "Tu'i Tonga Empire" },
  { seshatId: "OcHawaii", wikiTitle: "Kingdom_of_Hawaii", fallbackName: "Kingdom of Hawaii" },
];

interface WikipediaExtract {
  title: string;
  extract: string;
}

interface WikipediaInfobox {
  capital?: string;
  commonLanguages?: string;
  religion?: string;
  government?: string;
  era?: string;
  populationEstimate?: string;
}

/**
 * Fetch a summary extract from Wikipedia for a given article title.
 * Uses the REST API which returns plain-text extracts.
 */
async function fetchWikipediaExtract(title: string): Promise<WikipediaExtract | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pinakes/1.0 (polity-scraper)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return {
      title: data.title ?? title.replace(/_/g, " "),
      extract: data.extract ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch infobox data from Wikipedia using the parse API (wikitext extraction).
 */
async function fetchWikipediaInfobox(title: string): Promise<WikipediaInfobox> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&section=0&format=json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pinakes/1.0 (polity-scraper)" },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as any;
    const wikitext: string = data?.parse?.wikitext?.["*"] ?? "";
    return parseInfobox(wikitext);
  } catch {
    return {};
  }
}

function parseInfobox(wikitext: string): WikipediaInfobox {
  const result: WikipediaInfobox = {};

  const getField = (names: string[]): string | undefined => {
    for (const name of names) {
      const pattern = new RegExp(`\\|\\s*${name}\\s*=\\s*(.+?)(?:\\n|\\|\\s*\\w+\\s*=)`, "is");
      const match = wikitext.match(pattern);
      if (match) {
        return stripWikiMarkup(match[1].trim());
      }
    }
    return undefined;
  };

  result.capital = getField(["capital", "capital_city"]);
  result.commonLanguages = getField(["common_languages", "languages_type", "language", "official_languages"]);
  result.government = getField(["government_type", "government", "title_leader"]);
  result.populationEstimate = getField(["population_estimate", "population_census", "population"]);
  result.era = getField(["era", "event_start", "year_start"]);

  return result;
}

function stripWikiMarkup(text: string): string {
  return text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1") // [[link|text]] -> text
    .replace(/'{2,}/g, "") // bold/italic
    .replace(/\{\{[^}]*\}\}/g, "") // templates
    .replace(/<[^>]+>/g, "") // HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch polity data from the Seshat databank API.
 * Returns general variables (polity territory, population, etc.) if available.
 */
async function fetchSeshatPolity(seshatId: string): Promise<{
  population?: number;
  territory?: number;
  capital?: string;
} | null> {
  const url = `https://seshatdatabank.info/api/v1/polities/?name=${encodeURIComponent(seshatId)}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pinakes/1.0 (polity-scraper)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data?.results?.length) return null;
    const polity = data.results[0];
    return {
      population: polity.peak_population ?? undefined,
      capital: polity.capital ?? undefined,
    };
  } catch {
    return null;
  }
}

/** Derive a kebab-case ID from a polity name */
function toId(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Read existing polity IDs from civilizations.tsv */
function readExistingIds(): Set<string> {
  if (!fs.existsSync(CIVILIZATIONS_TSV)) return new Set();
  const content = fs.readFileSync(CIVILIZATIONS_TSV, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  // Skip header
  return new Set(lines.slice(1).map((l) => l.split("\t")[0]));
}

/** Map well-known polities to their language IDs */
const POLITY_LANGUAGES: Record<string, string[]> = {
  "kingdom-of-aksum": ["gez"],
  "kingdom-of-benin": ["bin"],
  "zulu-kingdom": ["zul"],
  "kingdom-of-kongo": ["kon"],
  "ethiopian-empire": ["amh"],
  "qin-dynasty": ["cmn"],
  "song-dynasty": ["cmn"],
  "yuan-dynasty": ["cmn"],
  "ming-dynasty": ["cmn"],
  "qing-dynasty": ["cmn"],
  "tokugawa-shogunate": ["jpn"],
  "heian-japan": ["jpn"],
  "goryeo": ["kor"],
  "joseon-dynasty": ["kor"],
  "mughal-empire": ["fas", "urd"],
  "chola-dynasty": ["tam"],
  "maratha-empire": ["mar"],
  "vijayanagara-empire": ["kan", "tel"],
  "delhi-sultanate": ["fas", "urd"],
  "majapahit": ["jav"],
  "srivijaya": ["msa"],
  "pagan-kingdom": ["mya"],
  "ayutthaya-kingdom": ["tha"],
  "sasanian-empire": ["pal"],
  "timurid-empire": ["fas", "tur"],
  "safavid-empire": ["fas"],
  "seljuk-empire": ["tur", "fas"],
  "ghaznavid-empire": ["fas"],
  "abbasid-caliphate": ["arb"],
  "parthian-empire": ["xpr"],
  "habsburg-monarchy": ["deu"],
  "republic-of-venice": ["ita"],
  "polish-lithuanian-commonwealth": ["pol", "lit"],
  "swedish-empire": ["swe"],
  "french-colonial-empire": ["fra"],
  "dutch-empire": ["nld"],
  "russian-empire": ["rus"],
  "toltec-empire": ["nah"],
  "zapotec-civilization": ["zap"],
  "wari-empire": ["que"],
  "tiwanaku": ["aym"],
  "mississippian-culture": [],
  "tui-tonga-empire": ["ton"],
  "kingdom-of-hawaii": ["haw"],
};

const POLITY_WRITING_SYSTEMS: Record<string, string[]> = {
  "kingdom-of-aksum": ["Ge'ez script"],
  "kingdom-of-benin": ["None"],
  "zulu-kingdom": ["None"],
  "kingdom-of-kongo": ["None"],
  "ethiopian-empire": ["Ge'ez script"],
  "qin-dynasty": ["Chinese characters"],
  "song-dynasty": ["Chinese characters"],
  "yuan-dynasty": ["Chinese characters", "Phags-pa script"],
  "ming-dynasty": ["Chinese characters"],
  "qing-dynasty": ["Chinese characters", "Manchu script"],
  "tokugawa-shogunate": ["Kanji", "Hiragana", "Katakana"],
  "heian-japan": ["Kanji", "Hiragana", "Katakana"],
  "goryeo": ["Chinese characters", "Korean script"],
  "joseon-dynasty": ["Hangul", "Chinese characters"],
  "mughal-empire": ["Persian script"],
  "chola-dynasty": ["Tamil script", "Grantha"],
  "maratha-empire": ["Modi script", "Devanagari"],
  "vijayanagara-empire": ["Kannada script", "Telugu script"],
  "delhi-sultanate": ["Persian script"],
  "majapahit": ["Kawi script"],
  "srivijaya": ["Pallava script"],
  "pagan-kingdom": ["Burmese script"],
  "ayutthaya-kingdom": ["Thai script"],
  "sasanian-empire": ["Pahlavi script"],
  "timurid-empire": ["Persian script"],
  "safavid-empire": ["Persian script"],
  "seljuk-empire": ["Persian script", "Arabic script"],
  "ghaznavid-empire": ["Persian script"],
  "abbasid-caliphate": ["Arabic script"],
  "parthian-empire": ["Parthian script"],
  "habsburg-monarchy": ["Latin alphabet"],
  "republic-of-venice": ["Latin alphabet"],
  "polish-lithuanian-commonwealth": ["Latin alphabet"],
  "swedish-empire": ["Latin alphabet"],
  "french-colonial-empire": ["Latin alphabet"],
  "dutch-empire": ["Latin alphabet"],
  "russian-empire": ["Cyrillic"],
  "toltec-empire": ["Mesoamerican glyphs"],
  "zapotec-civilization": ["Zapotec script"],
  "wari-empire": ["Quipu"],
  "tiwanaku": ["None"],
  "mississippian-culture": ["None"],
  "tui-tonga-empire": ["None"],
  "kingdom-of-hawaii": ["None"],
};

const POLITY_STRUCTURES: Record<string, string> = {
  "kingdom-of-aksum": "Kingdom",
  "kingdom-of-benin": "Kingdom",
  "zulu-kingdom": "Kingdom",
  "kingdom-of-kongo": "Kingdom",
  "ethiopian-empire": "Empire",
  "qin-dynasty": "Empire",
  "song-dynasty": "Empire",
  "yuan-dynasty": "Empire",
  "ming-dynasty": "Empire",
  "qing-dynasty": "Empire",
  "tokugawa-shogunate": "Shogunate",
  "heian-japan": "Empire",
  "goryeo": "Kingdom",
  "joseon-dynasty": "Kingdom",
  "mughal-empire": "Empire",
  "chola-dynasty": "Empire",
  "maratha-empire": "Confederacy",
  "vijayanagara-empire": "Empire",
  "delhi-sultanate": "Sultanate",
  "majapahit": "Empire",
  "srivijaya": "Thalassocracy",
  "pagan-kingdom": "Kingdom",
  "ayutthaya-kingdom": "Kingdom",
  "sasanian-empire": "Empire",
  "timurid-empire": "Empire",
  "safavid-empire": "Empire",
  "seljuk-empire": "Empire",
  "ghaznavid-empire": "Sultanate",
  "abbasid-caliphate": "Caliphate",
  "parthian-empire": "Empire",
  "habsburg-monarchy": "Monarchy",
  "republic-of-venice": "Republic",
  "polish-lithuanian-commonwealth": "Commonwealth",
  "swedish-empire": "Empire",
  "french-colonial-empire": "Empire",
  "dutch-empire": "Republic",
  "russian-empire": "Empire",
  "toltec-empire": "Empire",
  "zapotec-civilization": "City-states",
  "wari-empire": "Empire",
  "tiwanaku": "State",
  "mississippian-culture": "Chiefdoms",
  "tui-tonga-empire": "Empire",
  "kingdom-of-hawaii": "Kingdom",
};

/** Time period data for polities (BCE as negative, CE as positive) */
const POLITY_DATES: Record<string, { start: number; end: number | null }> = {
  "kingdom-of-aksum": { start: -100, end: 940 },
  "kingdom-of-benin": { start: 1180, end: 1897 },
  "zulu-kingdom": { start: 1816, end: 1897 },
  "kingdom-of-kongo": { start: 1390, end: 1914 },
  "ethiopian-empire": { start: 1270, end: 1975 },
  "qin-dynasty": { start: -221, end: -206 },
  "song-dynasty": { start: 960, end: 1279 },
  "yuan-dynasty": { start: 1271, end: 1368 },
  "ming-dynasty": { start: 1368, end: 1644 },
  "qing-dynasty": { start: 1636, end: 1912 },
  "tokugawa-shogunate": { start: 1603, end: 1868 },
  "heian-japan": { start: 794, end: 1185 },
  "goryeo": { start: 918, end: 1392 },
  "joseon-dynasty": { start: 1392, end: 1897 },
  "mughal-empire": { start: 1526, end: 1857 },
  "chola-dynasty": { start: -300, end: 1279 },
  "maratha-empire": { start: 1674, end: 1818 },
  "vijayanagara-empire": { start: 1336, end: 1646 },
  "delhi-sultanate": { start: 1206, end: 1526 },
  "majapahit": { start: 1293, end: 1527 },
  "srivijaya": { start: 650, end: 1377 },
  "pagan-kingdom": { start: 849, end: 1297 },
  "ayutthaya-kingdom": { start: 1351, end: 1767 },
  "sasanian-empire": { start: 224, end: 651 },
  "timurid-empire": { start: 1370, end: 1507 },
  "safavid-empire": { start: 1501, end: 1736 },
  "seljuk-empire": { start: 1037, end: 1194 },
  "ghaznavid-empire": { start: 977, end: 1186 },
  "abbasid-caliphate": { start: 750, end: 1258 },
  "parthian-empire": { start: -247, end: 224 },
  "habsburg-monarchy": { start: 1282, end: 1918 },
  "republic-of-venice": { start: 697, end: 1797 },
  "polish-lithuanian-commonwealth": { start: 1569, end: 1795 },
  "swedish-empire": { start: 1611, end: 1721 },
  "french-colonial-empire": { start: 1534, end: 1980 },
  "dutch-empire": { start: 1602, end: 1975 },
  "russian-empire": { start: 1721, end: 1917 },
  "toltec-empire": { start: 900, end: 1168 },
  "zapotec-civilization": { start: -700, end: 1521 },
  "wari-empire": { start: 600, end: 1000 },
  "tiwanaku": { start: 300, end: 1000 },
  "mississippian-culture": { start: 800, end: 1600 },
  "tui-tonga-empire": { start: 950, end: 1865 },
  "kingdom-of-hawaii": { start: 1795, end: 1893 },
};

function formatTimePeriodLabel(name: string, start: number, end: number | null): string {
  const startStr = start < 0 ? `${Math.abs(start)} BCE` : `${start} CE`;
  const endStr = end === null ? "present" : end < 0 ? `${Math.abs(end)} BCE` : `${end} CE`;
  return `${name} (${startStr} - ${endStr})`;
}

/**
 * Scrape polity/empire data from Wikipedia and Seshat, appending new entries
 * to civilizations.tsv.
 */
export class PolityScraper {
  private static isScraping = false;

  private updateJobStatus(
    jobId: string | undefined,
    updates: Partial<{
      status: string;
      completedWords: number;
      totalWords: number;
      errorMessage: string;
      statusMessage: string;
      startedAt: string;
      completedAt: string;
    }>
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  async scrapePolities(options: PolityScrapeOptions = {}): Promise<PolityScrapeResult> {
    const { jobId, progressCallback } = options;

    if (PolityScraper.isScraping) {
      throw new Error("Polity scraping is already in progress");
    }

    PolityScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      progressCallback?.({ type: "progress", message: "Reading existing civilizations..." });

      const existingIds = readExistingIds();
      const polities = SESHAT_POLITIES.filter((p) => {
        const id = toId(p.fallbackName);
        return !existingIds.has(id);
      });

      if (polities.length === 0) {
        progressCallback?.({
          type: "completed",
          message: "All polities already exist in civilizations.tsv",
        });
        this.updateJobStatus(jobId, {
          status: "completed",
          completedAt: new Date().toISOString(),
        });
        return { newPolities: 0, skippedDuplicates: SESHAT_POLITIES.length, errors: [] };
      }

      this.updateJobStatus(jobId, { totalWords: polities.length });
      progressCallback?.({
        type: "progress",
        message: `Found ${polities.length} new polities to scrape (${SESHAT_POLITIES.length - polities.length} already exist)`,
        total: polities.length,
      });

      const newRecords: PolityRecord[] = [];
      const errors: string[] = [];

      for (let i = 0; i < polities.length; i++) {
        const polity = polities[i];
        const id = toId(polity.fallbackName);

        progressCallback?.({
          type: "progress",
          message: `Scraping ${polity.fallbackName} (${i + 1}/${polities.length})...`,
          completed: i,
          total: polities.length,
        });
        this.updateJobStatus(jobId, { completedWords: i });

        try {
          const record = await this.scrapeOnePolity(polity.seshatId, polity.wikiTitle, polity.fallbackName, id);
          newRecords.push(record);

          // Rate-limit: ~200ms between Wikipedia requests
          await new Promise((r) => setTimeout(r, 200));
        } catch (err) {
          const msg = `Failed to scrape ${polity.fallbackName}: ${err instanceof Error ? err.message : err}`;
          console.error(msg);
          errors.push(msg);
        }
      }

      // Append new records to civilizations.tsv
      if (newRecords.length > 0) {
        progressCallback?.({
          type: "progress",
          message: `Writing ${newRecords.length} new polities to civilizations.tsv...`,
          completed: polities.length,
          total: polities.length,
        });
        await this.appendToCivilizations(newRecords);
      }

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: polities.length,
        completedAt: new Date().toISOString(),
      });

      progressCallback?.({
        type: "completed",
        message: `Scraped ${newRecords.length} new polities (${errors.length} errors)`,
        completed: newRecords.length,
        total: polities.length,
      });

      return {
        newPolities: newRecords.length,
        skippedDuplicates: SESHAT_POLITIES.length - polities.length,
        errors,
      };
    } finally {
      PolityScraper.isScraping = false;
    }
  }

  private async scrapeOnePolity(
    seshatId: string,
    wikiTitle: string,
    fallbackName: string,
    id: string
  ): Promise<PolityRecord> {
    // Fetch from both sources concurrently
    const [wikiExtract, wikiInfobox, seshatData] = await Promise.all([
      fetchWikipediaExtract(wikiTitle),
      fetchWikipediaInfobox(wikiTitle),
      fetchSeshatPolity(seshatId),
    ]);

    const name = wikiExtract?.title ?? fallbackName;
    const dates = POLITY_DATES[id] ?? { start: 0, end: null };

    // Resolve population: Seshat > Wikipedia infobox > null
    let population: number | null = seshatData?.population ?? null;
    if (!population && wikiInfobox.populationEstimate) {
      const numMatch = wikiInfobox.populationEstimate.replace(/,/g, "").match(/(\d+)/);
      if (numMatch) population = parseInt(numMatch[1], 10);
    }

    // Resolve capital: Seshat > Wikipedia infobox > empty
    const capital = seshatData?.capital ?? wikiInfobox.capital ?? "";

    const description = wikiExtract?.extract
      ? wikiExtract.extract.slice(0, 300).replace(/\t/g, " ").replace(/\n/g, " ")
      : "";

    return {
      id,
      name,
      nativeName: "",
      timePeriodStart: dates.start,
      timePeriodEnd: dates.end,
      timePeriodLabel: formatTimePeriodLabel(name, dates.start, dates.end),
      associatedLanguageIds: POLITY_LANGUAGES[id] ?? [],
      writingSystems: POLITY_WRITING_SYSTEMS[id] ?? [],
      politicalStructure: POLITY_STRUCTURES[id] ?? wikiInfobox.government ?? "Empire",
      capital,
      population,
      haplogroupIds: [],
      cuisineId: "",
      sources: ["Wikipedia", "Seshat Global History Databank"],
      description,
    };
  }

  private async appendToCivilizations(records: PolityRecord[]): Promise<void> {
    const lines = records.map((r) =>
      [
        r.id,
        r.name,
        r.nativeName,
        r.timePeriodStart.toString(),
        r.timePeriodEnd?.toString() ?? "",
        r.timePeriodLabel,
        JSON.stringify(r.associatedLanguageIds),
        JSON.stringify(r.writingSystems),
        r.politicalStructure,
        r.capital,
        r.population?.toString() ?? "",
        JSON.stringify(r.haplogroupIds),
        r.cuisineId,
        JSON.stringify(r.sources),
        r.description,
      ].join("\t")
    );

    const content = lines.join("\n") + "\n";
    await fs.promises.appendFile(CIVILIZATIONS_TSV, content, "utf-8");
    console.log(`Appended ${records.length} polity records to civilizations.tsv`);
  }
}

export const polityScraper = new PolityScraper();
