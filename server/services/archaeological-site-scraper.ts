import fs from "node:fs";
import path from "node:path";

import type {
  Contribution,
  ContributionService,
} from "./contribution-service";

/**
 * Archaeological Site Scraper
 * Fetches archaeological site data from Pleiades (pleiades.stoa.org) and
 * UNESCO World Heritage Sites, converts to the project's TSV format.
 *
 * US-007 adds Open Context and tDAR adapters that complement the Pleiades path:
 * both normalize to {@link ScrapedSite} with coordinates, time ranges,
 * associated cultures, and {@link SiteProvenance}, and land in the contribution
 * review queue (never a live TSV write) via {@link runArchaeologicalAcquisition}.
 */

/**
 * Where an externally-scraped site came from. Every record acquired from an
 * external adapter (Open Context, tDAR, …) carries one so a reviewer can trace
 * it back to the authority.
 */
export interface SiteProvenance {
  /** Adapter id: `pleiades` | `unesco` | `open-context` | `tdar`. */
  source: string;
  /** The authority's stable identifier for the record (URI / accession id). */
  sourceId: string;
  /** A resolvable URL for the record, when the authority exposes one. */
  sourceUrl: string;
}

export interface ScrapedSite {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  siteType: string;
  timePeriodStart: number | null;
  timePeriodEnd: number | null;
  timePeriodLabel: string;
  associatedLanguageIds: string[];
  associatedCultureIds: string[];
  associatedCivilizationIds: string[];
  excavationStatus: string;
  findings: string[];
  importance: number;
  confidence: number;
  sources: string[];
  description: string;
  /** External-authority provenance (absent for the curated UNESCO dataset). */
  provenance?: SiteProvenance;
}

interface PleiadesPlace {
  id: string;
  title: string;
  description: string;
  reprPoint: [number, number] | null;
  placeTypes: string[];
  locations: PleiadesLocation[];
  names: PleiadesName[];
  features: PleiadesFeature[];
}

interface PleiadesLocation {
  start: number | null;
  end: number | null;
  featureType: string[];
  geometry: { type: string; coordinates: number[] } | null;
  attestations: { timePeriod: string; confidence: string }[];
}

interface PleiadesName {
  romanized: string;
  language: string;
  attested: string;
}

interface PleiadesFeature {
  geometry: { type: string; coordinates: number[] } | null;
  properties: { snippet?: string; title?: string };
}

const PLEIADES_SITE_TYPE_MAP: Record<string, string> = {
  settlement: "settlement",
  "urban-settlement": "settlement",
  "rural-settlement": "settlement",
  village: "settlement",
  town: "settlement",
  city: "city",
  port: "city",
  temple: "temple",
  sanctuary: "temple",
  shrine: "temple",
  "religious-center": "temple",
  church: "temple",
  mosque: "temple",
  cemetery: "burial",
  tomb: "burial",
  necropolis: "burial",
  "tumulus-tumuli": "burial",
  fort: "fortress",
  fortress: "fortress",
  "military-installation": "fortress",
  castle: "fortress",
  wall: "fortress",
  cave: "cave_art",
  "rock-art": "cave_art",
  workshop: "workshop",
  mine: "workshop",
  quarry: "workshop",
  "production-site": "workshop",
  "amphitheatre": "ceremonial",
  "theatre": "ceremonial",
  stadium: "ceremonial",
  hippodrome: "ceremonial",
  bath: "ceremonial",
  agora: "ceremonial",
  forum: "ceremonial",
};

/**
 * Map Pleiades place types to our site_type enum.
 */
function mapPleiadesType(placeTypes: string[]): string {
  for (const pt of placeTypes) {
    const normalized = pt.toLowerCase().trim();
    if (PLEIADES_SITE_TYPE_MAP[normalized]) {
      return PLEIADES_SITE_TYPE_MAP[normalized];
    }
  }
  return "unknown";
}

/**
 * Create a slug-style ID from a name and source prefix.
 */
function slugify(prefix: string, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug}`;
}

/**
 * Format a time period label from start/end years.
 */
function formatTimePeriodLabel(start: number | null, end: number | null): string {
  const fmt = (y: number) => (y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`);
  if (start != null && end != null) return `${fmt(start)} - ${fmt(end)}`;
  if (start != null) return `From ${fmt(start)}`;
  if (end != null) return `Until ${fmt(end)}`;
  return "Unknown period";
}

export class ArchaeologicalSiteScraper {
  private baseUrl = "https://pleiades.stoa.org";
  private rateLimitMs = 500;

  /**
   * Fetch a single Pleiades place by its numeric ID.
   */
  async fetchPleiadesPlace(placeId: string): Promise<PleiadesPlace | null> {
    const url = `${this.baseUrl}/places/${placeId}/json`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as PleiadesPlace;
    } catch {
      return null;
    }
  }

  /**
   * Convert a Pleiades place JSON to our ScrapedSite format.
   */
  parsePleiadesPlace(place: PleiadesPlace): ScrapedSite | null {
    // Get coordinates from reprPoint or first location geometry
    let lat: number | null = null;
    let lng: number | null = null;

    if (place.reprPoint && place.reprPoint.length === 2) {
      lng = place.reprPoint[0];
      lat = place.reprPoint[1];
    } else {
      for (const loc of place.locations || []) {
        if (loc.geometry?.coordinates?.length === 2) {
          lng = loc.geometry.coordinates[0];
          lat = loc.geometry.coordinates[1];
          break;
        }
      }
    }

    if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;

    // Get time range from locations
    let earliest: number | null = null;
    let latest: number | null = null;
    for (const loc of place.locations || []) {
      if (loc.start != null && (earliest == null || loc.start < earliest)) {
        earliest = loc.start;
      }
      if (loc.end != null && (latest == null || loc.end > latest)) {
        latest = loc.end;
      }
    }

    // Extract language codes from names
    const langIds: string[] = [];
    for (const name of place.names || []) {
      if (name.language && !langIds.includes(name.language)) {
        langIds.push(name.language);
      }
    }

    return {
      id: slugify("pleiades", place.title || place.id),
      name: place.title,
      coordinates: { lat, lng },
      siteType: mapPleiadesType(place.placeTypes || []),
      timePeriodStart: earliest,
      timePeriodEnd: latest,
      timePeriodLabel: formatTimePeriodLabel(earliest, latest),
      associatedLanguageIds: langIds,
      associatedCultureIds: [],
      associatedCivilizationIds: [],
      excavationStatus: "partial",
      findings: [],
      importance: 50,
      confidence: 70,
      sources: [`https://pleiades.stoa.org/places/${place.id}`],
      description: place.description || "",
    };
  }

  /**
   * Scrape a batch of Pleiades places by their IDs.
   */
  async scrapePleiadesBatch(
    placeIds: string[],
    progressCallback?: (completed: number, total: number) => void,
  ): Promise<ScrapedSite[]> {
    const results: ScrapedSite[] = [];

    for (let i = 0; i < placeIds.length; i++) {
      const place = await this.fetchPleiadesPlace(placeIds[i]);
      if (place) {
        const site = this.parsePleiadesPlace(place);
        if (site) results.push(site);
      }

      if (progressCallback) progressCallback(i + 1, placeIds.length);

      // Rate limiting
      if (i < placeIds.length - 1) {
        await new Promise((r) => setTimeout(r, this.rateLimitMs));
      }
    }

    return results;
  }

  /**
   * Parse UNESCO World Heritage Sites data.
   * Since UNESCO's API is behind Cloudflare, we use a curated dataset
   * of major archaeological World Heritage Sites.
   */
  getUnescoArchaeologicalSites(): ScrapedSite[] {
    return UNESCO_ARCHAEOLOGICAL_SITES.map((s) => ({
      ...s,
      id: slugify("unesco", s.name),
    }));
  }

  /**
   * Merge new scraped sites with existing TSV data, avoiding duplicates.
   * Uses name similarity to detect duplicates.
   */
  mergeWithExisting(
    existingSites: ScrapedSite[],
    newSites: ScrapedSite[],
  ): ScrapedSite[] {
    const existingNames = new Set(
      existingSites.map((s) => s.name.toLowerCase().trim()),
    );
    const existingIds = new Set(existingSites.map((s) => s.id));

    const merged = [...existingSites];
    for (const site of newSites) {
      if (existingIds.has(site.id)) continue;
      if (existingNames.has(site.name.toLowerCase().trim())) continue;
      merged.push(site);
    }

    return merged;
  }

  /**
   * Write scraped sites to TSV file in the project format.
   */
  async writeToTsv(sites: ScrapedSite[], filePath: string): Promise<void> {
    const headers = [
      "id",
      "name",
      "coordinates",
      "site_type",
      "time_period_start",
      "time_period_end",
      "time_period_label",
      "associated_language_ids",
      "associated_culture_ids",
      "associated_civilization_ids",
      "excavation_status",
      "findings",
      "importance",
      "confidence",
      "sources",
      "description",
    ];

    const rows = sites.map((s) =>
      [
        s.id,
        s.name,
        JSON.stringify(s.coordinates),
        s.siteType,
        s.timePeriodStart?.toString() ?? "",
        s.timePeriodEnd?.toString() ?? "",
        s.timePeriodLabel,
        JSON.stringify(s.associatedLanguageIds),
        JSON.stringify(s.associatedCultureIds),
        JSON.stringify(s.associatedCivilizationIds),
        s.excavationStatus,
        JSON.stringify(s.findings),
        s.importance.toString(),
        s.confidence.toString(),
        JSON.stringify(s.sources),
        s.description,
      ].join("\t"),
    );

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${filePath}.tmp`;
    const content = [headers.join("\t"), ...rows].join("\n") + "\n";

    try {
      await fs.promises.writeFile(tempFile, content, "utf8");
      await fs.promises.rename(tempFile, filePath);
      console.log(`Wrote ${sites.length} archaeological sites to ${filePath}`);
    } catch (error) {
      try { await fs.promises.unlink(tempFile); } catch { /* ignore */ }
      throw error;
    }
  }

  /**
   * Read existing sites from TSV file.
   */
  readExistingSites(filePath: string): ScrapedSite[] {
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const header = lines[0].split("\t");
    const idx = (col: string) => header.indexOf(col);

    return lines.slice(1).filter((l) => l.trim()).map((line) => {
      const cols = line.split("\t");
      const parseJson = <T>(i: number, fallback: T): T => {
        if (i < 0 || !cols[i]) return fallback;
        try { return JSON.parse(cols[i]); } catch { return fallback; }
      };

      return {
        id: cols[idx("id")] || "",
        name: cols[idx("name")] || "",
        coordinates: parseJson(idx("coordinates"), { lat: 0, lng: 0 }),
        siteType: cols[idx("site_type")] || "unknown",
        timePeriodStart: cols[idx("time_period_start")] ? parseInt(cols[idx("time_period_start")], 10) : null,
        timePeriodEnd: cols[idx("time_period_end")] ? parseInt(cols[idx("time_period_end")], 10) : null,
        timePeriodLabel: cols[idx("time_period_label")] || "",
        associatedLanguageIds: parseJson(idx("associated_language_ids"), []),
        associatedCultureIds: parseJson(idx("associated_culture_ids"), []),
        associatedCivilizationIds: parseJson(idx("associated_civilization_ids"), []),
        excavationStatus: cols[idx("excavation_status")] || "unknown",
        findings: parseJson(idx("findings"), []),
        importance: cols[idx("importance")] ? parseInt(cols[idx("importance")], 10) : 50,
        confidence: cols[idx("confidence")] ? parseInt(cols[idx("confidence")], 10) : 50,
        sources: parseJson(idx("sources"), []),
        description: cols[idx("description")] || "",
      };
    });
  }

  /**
   * Run the full scrape pipeline: fetch from Pleiades + UNESCO, merge with existing, write TSV.
   */
  async scrapeAll(options: {
    pleiadesIds?: string[];
    includeUnesco?: boolean;
    tsvPath?: string;
    progressCallback?: (completed: number, total: number, source: string) => void;
  } = {}): Promise<{ total: number; added: number; sources: string[] }> {
    const {
      pleiadesIds = NOTABLE_PLEIADES_IDS,
      includeUnesco = true,
      tsvPath = "lexicons/archaeological-sites.tsv",
      progressCallback,
    } = options;

    const existing = this.readExistingSites(tsvPath);
    let allNew: ScrapedSite[] = [];

    // Scrape Pleiades
    if (pleiadesIds.length > 0) {
      const pleiadesSites = await this.scrapePleiadesBatch(
        pleiadesIds,
        progressCallback
          ? (c, t) => progressCallback(c, t, "pleiades")
          : undefined,
      );
      allNew.push(...pleiadesSites);
    }

    // Add UNESCO sites
    if (includeUnesco) {
      const unescoSites = this.getUnescoArchaeologicalSites();
      allNew.push(...unescoSites);
    }

    // Merge and write
    const merged = this.mergeWithExisting(existing, allNew);
    await this.writeToTsv(merged, tsvPath);

    return {
      total: merged.length,
      added: merged.length - existing.length,
      sources: [
        ...(pleiadesIds.length > 0 ? ["pleiades.stoa.org"] : []),
        ...(includeUnesco ? ["UNESCO World Heritage"] : []),
      ],
    };
  }
}

/**
 * Notable Pleiades place IDs for important archaeological sites.
 * These are well-documented ancient places with good coordinate data.
 */
export const NOTABLE_PLEIADES_IDS: string[] = [
  // Greece & Aegean
  "570491", // Mycenae
  "570685", // Tiryns
  "589872", // Knossos
  "589918", // Lindos
  "570347", // Kenchreai
  "570382", // Korinth
  "540726", // Dodona
  "570597", // Olympia
  "579888", // Delos
  "580062", // Ephesos
  "550595", // Philippi
  "501382", // Pergamon
  "550771", // Thasos
  // Italy & Western Mediterranean
  "432873", // Pompeii
  "422995", // Ostia
  "423025", // Roma
  "462152", // Paestum
  "403266", // Syracuse (Syrakousai)
  "462201", // Herculaneum
  "314921", // Carthage
  "344282", // Leptis Magna
  "344456", // Sabratha
  // Near East
  "893977", // Ur
  "912910", // Persepolis
  "893964", // Babylon
  "658494", // Byblos
  "678437", // Palmyra
  "668307", // Petra
  "658381", // Baalbek
  "678007", // Jerash (Gerasa)
  // Egypt & North Africa
  "727169", // Thebes (Luxor)
  "727149", // Memphis
  "786067", // Meroe
  "785970", // Aksum
  "727070", // Alexandria
  "716577", // Cyrene
  // Anatolia
  "550893", // Troy (Ilion)
  "609289", // Hattusa
  "648647", // Gobekli Tepe
  "629045", // Catalhoyuk
  "638753", // Ani
  // Central & South Asia
  "59816",  // Taxila
  "59698",  // Mohenjo-daro
];

/**
 * Curated UNESCO World Heritage archaeological sites.
 * Data sourced from UNESCO World Heritage Centre (whc.unesco.org).
 * Since the UNESCO API is behind Cloudflare protection, this dataset
 * provides key archaeological World Heritage Sites directly.
 */
const UNESCO_ARCHAEOLOGICAL_SITES: Omit<ScrapedSite, "id">[] = [
  {
    name: "Angkor",
    coordinates: { lat: 13.4125, lng: 103.8670 },
    siteType: "temple",
    timePeriodStart: 802,
    timePeriodEnd: 1431,
    timePeriodLabel: "802 CE - 1431 CE",
    associatedLanguageIds: ["khm"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["khmer-empire"],
    excavationStatus: "extensive",
    findings: ["Temple complexes", "Bas-reliefs", "Hydraulic engineering", "Sanskrit inscriptions"],
    importance: 98,
    confidence: 95,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/668"],
    description: "Angkor Archaeological Park contains the remains of the Khmer Empire capitals from the 9th to 15th centuries, including Angkor Wat and Angkor Thom.",
  },
  {
    name: "Machu Picchu",
    coordinates: { lat: -13.1631, lng: -72.5450 },
    siteType: "city",
    timePeriodStart: 1450,
    timePeriodEnd: 1572,
    timePeriodLabel: "1450 CE - 1572 CE",
    associatedLanguageIds: ["que"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["inca-empire"],
    excavationStatus: "extensive",
    findings: ["Stone terraces", "Temple of the Sun", "Intihuatana stone", "Royal residences"],
    importance: 97,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/274"],
    description: "15th-century Inca citadel set high in the Andes Mountains above the Urubamba River valley.",
  },
  {
    name: "Teotihuacan",
    coordinates: { lat: 19.6925, lng: -98.8438 },
    siteType: "city",
    timePeriodStart: -200,
    timePeriodEnd: 750,
    timePeriodLabel: "200 BCE - 750 CE",
    associatedLanguageIds: ["nah"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Pyramid of the Sun", "Pyramid of the Moon", "Avenue of the Dead", "Murals"],
    importance: 95,
    confidence: 85,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/414"],
    description: "Pre-Columbian Mesoamerican city known for its massive pyramids and urban planning, one of the largest cities in the ancient world.",
  },
  {
    name: "Chichen Itza",
    coordinates: { lat: 20.6843, lng: -88.5678 },
    siteType: "city",
    timePeriodStart: 600,
    timePeriodEnd: 1200,
    timePeriodLabel: "600 CE - 1200 CE",
    associatedLanguageIds: ["yua"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["maya"],
    excavationStatus: "extensive",
    findings: ["El Castillo pyramid", "Great Ball Court", "Cenote Sagrado", "Observatory"],
    importance: 95,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/483"],
    description: "Major pre-Columbian Maya city featuring a fusion of Maya and Toltec architectural styles.",
  },
  {
    name: "Great Zimbabwe",
    coordinates: { lat: -20.2674, lng: 30.9338 },
    siteType: "city",
    timePeriodStart: 1100,
    timePeriodEnd: 1450,
    timePeriodLabel: "1100 CE - 1450 CE",
    associatedLanguageIds: ["sna"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Great Enclosure", "Stone walls", "Conical tower", "Soapstone birds"],
    importance: 90,
    confidence: 85,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/364"],
    description: "Capital of the Kingdom of Zimbabwe during the late Iron Age, featuring massive stone structures built without mortar.",
  },
  {
    name: "Tikal",
    coordinates: { lat: 17.2220, lng: -89.6237 },
    siteType: "city",
    timePeriodStart: -600,
    timePeriodEnd: 900,
    timePeriodLabel: "600 BCE - 900 CE",
    associatedLanguageIds: ["yua"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["maya"],
    excavationStatus: "extensive",
    findings: ["Temple pyramids", "Stelae", "Maya inscriptions", "Royal tombs"],
    importance: 92,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/64"],
    description: "One of the largest archaeological sites of the pre-Columbian Maya civilization in the rainforests of Guatemala.",
  },
  {
    name: "Sukhothai",
    coordinates: { lat: 17.0196, lng: 99.7013 },
    siteType: "city",
    timePeriodStart: 1238,
    timePeriodEnd: 1438,
    timePeriodLabel: "1238 CE - 1438 CE",
    associatedLanguageIds: ["tha"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Buddha statues", "Temple ruins", "Khmer-influenced art", "Thai inscriptions"],
    importance: 80,
    confidence: 85,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/574"],
    description: "Capital of the first Kingdom of Siam in the 13th and 14th centuries, with fine examples of Thai art and architecture.",
  },
  {
    name: "Hampi",
    coordinates: { lat: 15.3350, lng: 76.4600 },
    siteType: "city",
    timePeriodStart: 1336,
    timePeriodEnd: 1565,
    timePeriodLabel: "1336 CE - 1565 CE",
    associatedLanguageIds: ["kan", "san"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["vijayanagara-empire"],
    excavationStatus: "extensive",
    findings: ["Virupaksha Temple", "Stone chariot", "Royal enclosure", "Bazaar ruins"],
    importance: 85,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/241"],
    description: "Ruins of the last great Hindu kingdom of Vijayanagara, with temples, palaces, and market structures.",
  },
  {
    name: "Moai of Rapa Nui",
    coordinates: { lat: -27.1127, lng: -109.3497 },
    siteType: "ceremonial",
    timePeriodStart: 1250,
    timePeriodEnd: 1500,
    timePeriodLabel: "1250 CE - 1500 CE",
    associatedLanguageIds: ["rap"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Moai statues", "Ahu platforms", "Petroglyphs", "Rongorongo tablets"],
    importance: 90,
    confidence: 80,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/715"],
    description: "Rapa Nui National Park on Easter Island, home to the monumental Moai stone figures carved by the Rapa Nui people.",
  },
  {
    name: "Tiwanaku",
    coordinates: { lat: -16.5544, lng: -68.6734 },
    siteType: "ceremonial",
    timePeriodStart: 200,
    timePeriodEnd: 1000,
    timePeriodLabel: "200 CE - 1000 CE",
    associatedLanguageIds: ["aym"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "partial",
    findings: ["Gate of the Sun", "Akapana pyramid", "Kalasasaya temple", "Stone monoliths"],
    importance: 85,
    confidence: 75,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/567"],
    description: "Spiritual and political centre of the Tiwanaku culture, one of the most important pre-Columbian civilizations in South America.",
  },
  {
    name: "Sigiriya",
    coordinates: { lat: 7.9570, lng: 80.7603 },
    siteType: "fortress",
    timePeriodStart: 477,
    timePeriodEnd: 495,
    timePeriodLabel: "477 CE - 495 CE",
    associatedLanguageIds: ["sin"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Rock fortress", "Frescoes", "Mirror wall", "Water gardens"],
    importance: 85,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/202"],
    description: "Ancient rock fortress and palace ruins atop a 200-metre rock column in central Sri Lanka, built by King Kashyapa.",
  },
  {
    name: "Mesa Verde",
    coordinates: { lat: 37.1838, lng: -108.4887 },
    siteType: "settlement",
    timePeriodStart: 550,
    timePeriodEnd: 1300,
    timePeriodLabel: "550 CE - 1300 CE",
    associatedLanguageIds: [],
    associatedCultureIds: ["ancestral-puebloan"],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Cliff dwellings", "Cliff Palace", "Pottery", "Kivas"],
    importance: 85,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/27"],
    description: "Ancestral Puebloan cliff dwellings in Colorado, featuring some of the best-preserved archaeological sites in North America.",
  },
  {
    name: "Cahokia Mounds",
    coordinates: { lat: 38.6552, lng: -90.0625 },
    siteType: "ceremonial",
    timePeriodStart: 600,
    timePeriodEnd: 1400,
    timePeriodLabel: "600 CE - 1400 CE",
    associatedLanguageIds: [],
    associatedCultureIds: ["mississippian"],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Monks Mound", "Woodhenge", "Mound 72 burials", "Chunkey stones"],
    importance: 85,
    confidence: 85,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/198"],
    description: "Largest pre-Columbian settlement north of Mexico, a major Mississippian culture centre near modern-day St. Louis.",
  },
  {
    name: "Kilwa Kisiwani",
    coordinates: { lat: -8.9575, lng: 39.5225 },
    siteType: "city",
    timePeriodStart: 900,
    timePeriodEnd: 1500,
    timePeriodLabel: "900 CE - 1500 CE",
    associatedLanguageIds: ["swh"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "partial",
    findings: ["Great Mosque", "Husuni Kubwa palace", "Coins", "Chinese porcelain"],
    importance: 80,
    confidence: 80,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/144"],
    description: "Ruins of two great East African trading ports on islands off the coast of Tanzania, important in Swahili coast trade.",
  },
  {
    name: "Nan Madol",
    coordinates: { lat: 6.8440, lng: 158.3340 },
    siteType: "ceremonial",
    timePeriodStart: 1200,
    timePeriodEnd: 1500,
    timePeriodLabel: "1200 CE - 1500 CE",
    associatedLanguageIds: [],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "partial",
    findings: ["Basalt megalithic ruins", "Artificial islets", "Tombs", "Ceremonial centers"],
    importance: 80,
    confidence: 70,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/1503"],
    description: "Ceremonial centre of the Saudeleur dynasty built on artificial islets off the coast of Pohnpei, Micronesia.",
  },
  {
    name: "Chan Chan",
    coordinates: { lat: -8.1067, lng: -79.0742 },
    siteType: "city",
    timePeriodStart: 850,
    timePeriodEnd: 1470,
    timePeriodLabel: "850 CE - 1470 CE",
    associatedLanguageIds: [],
    associatedCultureIds: ["chimu"],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Adobe citadels", "Irrigation channels", "Decorative friezes", "Royal burial platforms"],
    importance: 85,
    confidence: 85,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/366"],
    description: "Largest adobe city in the Americas, capital of the Chimú kingdom on the northern coast of Peru.",
  },
  {
    name: "Ayutthaya",
    coordinates: { lat: 14.3532, lng: 100.5544 },
    siteType: "city",
    timePeriodStart: 1350,
    timePeriodEnd: 1767,
    timePeriodLabel: "1350 CE - 1767 CE",
    associatedLanguageIds: ["tha"],
    associatedCultureIds: [],
    associatedCivilizationIds: [],
    excavationStatus: "extensive",
    findings: ["Temple ruins", "Royal palaces", "Buddha statues", "Prang towers"],
    importance: 82,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/576"],
    description: "Second capital of the Siamese Kingdom, founded in 1350, with impressive temple ruins and art.",
  },
  {
    name: "Copan",
    coordinates: { lat: 14.8400, lng: -89.1400 },
    siteType: "city",
    timePeriodStart: -200,
    timePeriodEnd: 900,
    timePeriodLabel: "200 BCE - 900 CE",
    associatedLanguageIds: [],
    associatedCultureIds: [],
    associatedCivilizationIds: ["maya"],
    excavationStatus: "extensive",
    findings: ["Hieroglyphic Stairway", "Stelae", "Ball court", "Royal tombs"],
    importance: 85,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/129"],
    description: "Major Maya city in western Honduras known for its remarkable series of portrait stelae and hieroglyphic stairway.",
  },
  {
    name: "Sanchi",
    coordinates: { lat: 23.4793, lng: 77.7399 },
    siteType: "temple",
    timePeriodStart: -300,
    timePeriodEnd: 1200,
    timePeriodLabel: "300 BCE - 1200 CE",
    associatedLanguageIds: ["san", "pli"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["maurya-empire"],
    excavationStatus: "extensive",
    findings: ["Great Stupa", "Ashoka pillar", "Toranas (gateways)", "Buddhist monasteries"],
    importance: 82,
    confidence: 90,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/524"],
    description: "Buddhist monuments at Sanchi, including the Great Stupa commissioned by Emperor Ashoka in the 3rd century BCE.",
  },
  {
    name: "Volubilis",
    coordinates: { lat: 34.0730, lng: -5.5544 },
    siteType: "city",
    timePeriodStart: -300,
    timePeriodEnd: 700,
    timePeriodLabel: "300 BCE - 700 CE",
    associatedLanguageIds: ["lat", "ber"],
    associatedCultureIds: [],
    associatedCivilizationIds: ["roman-empire"],
    excavationStatus: "extensive",
    findings: ["Roman mosaics", "Triumphal arch", "Capitol temple", "Olive presses"],
    importance: 75,
    confidence: 85,
    sources: ["UNESCO World Heritage Centre", "https://whc.unesco.org/en/list/836"],
    description: "Partly-excavated Roman city in Morocco, important outpost of the Roman Empire in North Africa.",
  },
];

export const archaeologicalSiteScraper = new ArchaeologicalSiteScraper();

// ============================================================================
// Open Context / tDAR adapters (US-007)
// ----------------------------------------------------------------------------
// Two external archaeological authorities complement the Pleiades path above.
// Each adapter is a pure mapper (raw API record → ScrapedSite | null) plus an
// injectable network boundary (`ArchaeologyDeps`) so the pipeline is unit-tested
// against recorded fixtures — no live network. Acquired sites carry coordinates,
// time ranges, associated cultures, and provenance, and land in the contribution
// review queue (never a live TSV write).
// ============================================================================

export type ArchaeologySourceId = "open-context" | "tdar";

export interface ArchaeologySource {
  id: ArchaeologySourceId;
  label: string;
  description: string;
  homepage: string;
}

export const ARCHAEOLOGY_SOURCES: Record<ArchaeologySourceId, ArchaeologySource> = {
  "open-context": {
    id: "open-context",
    label: "Open Context",
    description:
      "Open-access archaeological data & publications (opencontext.org); GeoJSON search API.",
    homepage: "https://opencontext.org",
  },
  tdar: {
    id: "tdar",
    label: "tDAR (Digital Antiquity)",
    description:
      "The Digital Archaeological Record (core.tdar.org); site records with spatial + temporal coverage.",
    homepage: "https://core.tdar.org",
  },
};

export function listArchaeologySources(): ArchaeologySource[] {
  return Object.values(ARCHAEOLOGY_SOURCES);
}

export function resolveArchaeologySource(
  source: string | undefined,
): ArchaeologySource | undefined {
  if (!source) return undefined;
  return (ARCHAEOLOGY_SOURCES as Record<string, ArchaeologySource>)[source];
}

/** Map a free-text site/culture keyword to our site_type enum, else "unknown". */
function mapKeywordSiteType(keywords: string[]): string {
  for (const kw of keywords) {
    const normalized = kw.toLowerCase().trim();
    if (PLEIADES_SITE_TYPE_MAP[normalized]) return PLEIADES_SITE_TYPE_MAP[normalized];
    // A few extra archaeological synonyms not in the Pleiades map.
    if (/burial|grave|mound|barrow/.test(normalized)) return "burial";
    if (/settlement|habitation|dwelling|village|hamlet/.test(normalized)) return "settlement";
    if (/temple|shrine|ritual|ceremon/.test(normalized)) return "temple";
    if (/fort|citadel|defensive|rampart/.test(normalized)) return "fortress";
    if (/rock.?art|petroglyph|pictograph|cave/.test(normalized)) return "cave_art";
    if (/workshop|kiln|quarry|mine|production/.test(normalized)) return "workshop";
    if (/city|urban|town/.test(normalized)) return "city";
  }
  return "unknown";
}

/** Slugify a culture name into a stable id (`Ancestral Puebloan` → `ancestral-puebloan`). */
function slugifyCulture(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Open Context (GeoJSON search API) ─────────────────────────────────────────

/** A GeoJSON feature from the Open Context search API (`/query/.json`). */
export interface OpenContextFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: number[] } | null;
  properties?: {
    label?: string;
    uri?: string;
    href?: string;
    id?: string;
    category?: string | string[];
    "context label"?: string;
    "early bce/ce"?: number;
    "late bce/ce"?: number;
    "item category"?: string;
    snippet?: string;
    cultures?: string[];
  };
}

export interface OpenContextResponse {
  type?: string;
  features?: OpenContextFeature[];
}

/**
 * Map one Open Context feature → a {@link ScrapedSite}, or `null` when it lacks a
 * name or usable point coordinates.
 */
export function openContextToScrapedSite(
  feature: OpenContextFeature,
): ScrapedSite | null {
  const props = feature.properties ?? {};
  const name = (props.label ?? "").trim();
  if (!name) return null;

  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;

  const start =
    typeof props["early bce/ce"] === "number" ? props["early bce/ce"] : null;
  const end =
    typeof props["late bce/ce"] === "number" ? props["late bce/ce"] : null;

  const categories: string[] = Array.isArray(props.category)
    ? props.category
    : props.category
    ? [props.category]
    : [];
  if (props["item category"]) categories.push(props["item category"]);

  // Cultures: explicit list, else the leaf of the context path (e.g. "Turkey/Çatalhöyük").
  const cultureNames = Array.isArray(props.cultures) ? props.cultures.slice() : [];
  const contextLabel = (props["context label"] ?? "").trim();
  if (cultureNames.length === 0 && contextLabel) {
    const leaf = contextLabel.split("/").map((s) => s.trim()).filter(Boolean).pop();
    if (leaf) cultureNames.push(leaf);
  }
  const associatedCultureIds = Array.from(
    new Set(cultureNames.map(slugifyCulture).filter(Boolean)),
  );

  const uri = (props.uri ?? props.href ?? props.id ?? "").trim();
  const sourceUrl = (props.href ?? props.uri ?? "").trim();

  return {
    id: slugify("opencontext", name),
    name,
    coordinates: { lat, lng },
    siteType: mapKeywordSiteType([...categories, name]),
    timePeriodStart: start,
    timePeriodEnd: end,
    timePeriodLabel: formatTimePeriodLabel(start, end),
    associatedLanguageIds: [],
    associatedCultureIds,
    associatedCivilizationIds: [],
    excavationStatus: "unknown",
    findings: [],
    importance: 50,
    confidence: 65,
    sources: ["Open Context", sourceUrl].filter(Boolean),
    description: (props.snippet ?? "").trim(),
    provenance: {
      source: "open-context",
      sourceId: uri,
      sourceUrl: sourceUrl || uri,
    },
  };
}

// ── tDAR (resource records with spatial + temporal coverage) ──────────────────

/** A tDAR resource record (from its search/resource API). */
export interface TdarResource {
  id?: string | number;
  title?: string;
  url?: string;
  detailUrl?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  minimumLatitude?: number;
  maximumLatitude?: number;
  minimumLongitude?: number;
  maximumLongitude?: number;
  startDate?: number;
  endDate?: number;
  culturalTerms?: string[];
  siteTypeKeywords?: string[];
  siteType?: string;
}

export interface TdarResponse {
  resources?: TdarResource[];
}

/** Resolve a tDAR record's point: explicit lat/lng, else the bounding-box centroid. */
function tdarCoordinates(
  resource: TdarResource,
): { lat: number; lng: number } | null {
  let lat: number | null = null;
  let lng: number | null = null;
  if (typeof resource.latitude === "number" && typeof resource.longitude === "number") {
    lat = resource.latitude;
    lng = resource.longitude;
  } else if (
    typeof resource.minimumLatitude === "number" &&
    typeof resource.maximumLatitude === "number" &&
    typeof resource.minimumLongitude === "number" &&
    typeof resource.maximumLongitude === "number"
  ) {
    lat = (resource.minimumLatitude + resource.maximumLatitude) / 2;
    lng = (resource.minimumLongitude + resource.maximumLongitude) / 2;
  }
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Map one tDAR resource → a {@link ScrapedSite}, or `null` when it lacks a title
 * or usable coordinates.
 */
export function tdarToScrapedSite(resource: TdarResource): ScrapedSite | null {
  const name = (resource.title ?? "").trim();
  if (!name) return null;

  const coordinates = tdarCoordinates(resource);
  if (!coordinates) return null;

  const start = typeof resource.startDate === "number" ? resource.startDate : null;
  const end = typeof resource.endDate === "number" ? resource.endDate : null;

  const cultures = (resource.culturalTerms ?? []).map((c) => c.trim()).filter(Boolean);
  const associatedCultureIds = Array.from(
    new Set(cultures.map(slugifyCulture).filter(Boolean)),
  );

  const siteTypeKeywords = [
    ...(resource.siteType ? [resource.siteType] : []),
    ...(resource.siteTypeKeywords ?? []),
  ];

  const sourceId = resource.id != null ? String(resource.id) : "";
  const sourceUrl = (resource.url ?? resource.detailUrl ?? "").trim();

  return {
    id: slugify("tdar", sourceId || name),
    name,
    coordinates,
    siteType: mapKeywordSiteType([...siteTypeKeywords, name]),
    timePeriodStart: start,
    timePeriodEnd: end,
    timePeriodLabel: formatTimePeriodLabel(start, end),
    associatedLanguageIds: [],
    associatedCultureIds,
    associatedCivilizationIds: [],
    excavationStatus: "unknown",
    findings: [],
    importance: 50,
    confidence: 60,
    sources: ["tDAR", sourceUrl].filter(Boolean),
    description: (resource.description ?? "").trim(),
    provenance: {
      source: "tdar",
      sourceId,
      sourceUrl,
    },
  };
}

// ── Injectable network boundary + live deps ───────────────────────────────────

export interface ArchaeologyFetchContext {
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * The network boundary for the external adapters. Tests inject fixture-backed
 * deps; `liveArchaeologyDeps` hits the real APIs.
 */
export interface ArchaeologyDeps {
  fetchOpenContext(context: ArchaeologyFetchContext): Promise<OpenContextResponse>;
  fetchTdar(context: ArchaeologyFetchContext): Promise<TdarResponse>;
}

export class ArchaeologyAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchaeologyAcquisitionError";
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ArchaeologyAcquisitionError(
      `fetch ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

export const liveArchaeologyDeps: ArchaeologyDeps = {
  async fetchOpenContext({ query, limit, signal }) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("rows", String(limit && limit > 0 ? Math.min(limit, 100) : 25));
    params.set("type", "subjects");
    const url = `https://opencontext.org/query/.json?${params.toString()}`;
    return fetchJson<OpenContextResponse>(url, signal);
  },
  async fetchTdar({ query, limit, signal }) {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    params.set("recordsPerPage", String(limit && limit > 0 ? Math.min(limit, 100) : 25));
    const url = `https://core.tdar.org/api/lookup/resource?${params.toString()}`;
    return fetchJson<TdarResponse>(url, signal);
  },
};

/** Fetch + normalize sites from one external source. */
export async function scrapeArchaeologySource(
  source: ArchaeologySourceId,
  context: ArchaeologyFetchContext,
  deps: ArchaeologyDeps = liveArchaeologyDeps,
): Promise<ScrapedSite[]> {
  if (source === "open-context") {
    const data = await deps.fetchOpenContext(context);
    return (data.features ?? [])
      .map(openContextToScrapedSite)
      .filter((s): s is ScrapedSite => s !== null);
  }
  const data = await deps.fetchTdar(context);
  return (data.resources ?? [])
    .map(tdarToScrapedSite)
    .filter((s): s is ScrapedSite => s !== null);
}

// ── Contribution mapping + orchestration ──────────────────────────────────────

/** Clamp a 0..100 confidence to 1..99 (< 100 ⇒ always reads as "needs review"). */
function toContributionConfidence(confidence: number): number {
  const value = Number.isFinite(confidence) ? confidence : 50;
  return Math.max(1, Math.min(99, Math.round(value)));
}

/**
 * Map a {@link ScrapedSite} → a `Partial<Contribution>` for the review queue, or
 * `null` when it is missing the required name/coordinates. Filed as an
 * `archaeological-site` `add`, flagged `autoDerived` with source provenance so a
 * reviewer (US-009) promotes it — never a live TSV write.
 */
export function siteToContribution(
  site: ScrapedSite,
): Partial<Contribution> | null {
  if (!site.name || !site.coordinates) return null;
  const { lat, lng } = site.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const provenance = site.provenance;
  const entityData: Record<string, unknown> = {
    name: site.name,
    coordinates: site.coordinates,
    siteType: site.siteType,
    timePeriodStart: site.timePeriodStart,
    timePeriodEnd: site.timePeriodEnd,
    timePeriodLabel: site.timePeriodLabel,
    associatedLanguageIds: site.associatedLanguageIds,
    associatedCultureIds: site.associatedCultureIds,
    associatedCivilizationIds: site.associatedCivilizationIds,
    description: site.description,
    // Provenance + review flags (mirrors US-005 auto-derived acquisitions).
    source: provenance?.source ?? "archaeological-scraper",
    sourceId: provenance?.sourceId,
    sourceUrl: provenance?.sourceUrl,
    autoDerived: true,
    aiGenerated: false,
  };

  const sourceLabel = provenance
    ? ARCHAEOLOGY_SOURCES[provenance.source as ArchaeologySourceId]?.label ??
      provenance.source
    : "archaeological scraper";

  return {
    entityType: "archaeological-site",
    action: "add",
    entityData,
    sources: [
      {
        title: `${site.name} — ${sourceLabel}`,
        url: provenance?.sourceUrl || undefined,
        license: "See source",
      },
    ],
    confidence: toContributionConfidence(site.confidence),
    notes: `Acquired from ${sourceLabel}; awaiting review.`,
  };
}

export interface ArchaeologyAcquisitionProgress {
  phase: "starting" | "fetching" | "queueing" | "done";
  message: string;
  acquired: number;
  queued: number;
  skipped: number;
  total?: number;
}

export interface ArchaeologyAcquisitionResult {
  source: ArchaeologySourceId;
  acquired: number;
  queued: number;
  skipped: number;
  contributionIds: string[];
}

export interface RunArchaeologyAcquisitionOptions {
  source: ArchaeologySourceId;
  contributions: ContributionService;
  deps?: ArchaeologyDeps;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ArchaeologyAcquisitionProgress) => void;
}

/**
 * Run one archaeological acquisition end to end: fetch + normalize via the
 * source adapter, then map + enqueue each site into the contribution review
 * queue. Returns per-run counts.
 */
export async function runArchaeologicalAcquisition(
  options: RunArchaeologyAcquisitionOptions,
): Promise<ArchaeologyAcquisitionResult> {
  const {
    source,
    contributions,
    deps = liveArchaeologyDeps,
    query,
    limit,
    signal,
    onProgress,
  } = options;
  const label = ARCHAEOLOGY_SOURCES[source].label;

  onProgress?.({
    phase: "starting",
    message: `Starting acquisition from ${label}`,
    acquired: 0,
    queued: 0,
    skipped: 0,
  });

  const sites = await scrapeArchaeologySource(source, { query, limit, signal }, deps);

  onProgress?.({
    phase: "fetching",
    message: `Fetched ${sites.length} site(s) from ${label}`,
    acquired: sites.length,
    queued: 0,
    skipped: 0,
    total: sites.length,
  });

  let queued = 0;
  let skipped = 0;
  const contributionIds: string[] = [];

  for (let i = 0; i < sites.length; i++) {
    if (signal?.aborted) break;
    const draft = siteToContribution(sites[i]);
    if (!draft) {
      skipped++;
      continue;
    }
    const { contribution } = contributions.submit(draft);
    if (contribution) {
      queued++;
      contributionIds.push(contribution.id);
    } else {
      skipped++;
    }
    if ((i + 1) % 25 === 0 || i === sites.length - 1) {
      onProgress?.({
        phase: "queueing",
        message: `Queued ${queued} / ${sites.length} for review (${skipped} skipped)`,
        acquired: sites.length,
        queued,
        skipped,
        total: sites.length,
      });
    }
  }

  onProgress?.({
    phase: "done",
    message: `Acquisition complete: ${queued} queued for review, ${skipped} skipped`,
    acquired: sites.length,
    queued,
    skipped,
    total: sites.length,
  });

  return { source, acquired: sites.length, queued, skipped, contributionIds };
}
