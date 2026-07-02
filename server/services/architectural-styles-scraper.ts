import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ArchitecturalStyle } from "../tsv-storage";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import fs from "node:fs";
import path from "node:path";

export interface BuildingType {
  id: string;
  name: string;
  category: string;
  parentTypeId: string;
  description: string;
  historicalPeriod: string;
  regions: string[];
  associatedStyles: string[];
  structuralFeatures: string[];
  culturalFunction: string;
}

const BUILDING_TYPE_TAXONOMY: BuildingType[] = [
  // Religious
  { id: "temple", name: "Temple", category: "Religious", parentTypeId: "religious", description: "A structure dedicated to worship of deities", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["altar", "sanctuary", "processional axis"], culturalFunction: "Worship and ritual" },
  { id: "church", name: "Church", category: "Religious", parentTypeId: "religious", description: "Christian place of worship", historicalPeriod: "Late Antiquity to Modern", regions: ["Europe", "Americas", "Africa"], associatedStyles: [], structuralFeatures: ["nave", "apse", "bell tower"], culturalFunction: "Christian worship" },
  { id: "cathedral", name: "Cathedral", category: "Religious", parentTypeId: "church", description: "Principal church of a diocese containing the bishop's seat", historicalPeriod: "Medieval to Modern", regions: ["Europe", "Americas"], associatedStyles: [], structuralFeatures: ["nave", "transept", "choir", "flying buttresses"], culturalFunction: "Episcopal seat and worship" },
  { id: "mosque", name: "Mosque", category: "Religious", parentTypeId: "religious", description: "Islamic place of worship and community gathering", historicalPeriod: "7th century to Modern", regions: ["Middle East", "North Africa", "South Asia", "Southeast Asia"], associatedStyles: [], structuralFeatures: ["minaret", "mihrab", "courtyard", "dome"], culturalFunction: "Islamic worship and community" },
  { id: "synagogue", name: "Synagogue", category: "Religious", parentTypeId: "religious", description: "Jewish house of prayer and study", historicalPeriod: "Antiquity to Modern", regions: ["Middle East", "Europe", "Americas"], associatedStyles: [], structuralFeatures: ["ark", "bimah", "women's gallery"], culturalFunction: "Jewish worship and study" },
  { id: "stupa", name: "Stupa", category: "Religious", parentTypeId: "religious", description: "Hemispherical Buddhist memorial monument", historicalPeriod: "3rd century BCE to Modern", regions: ["South Asia", "East Asia", "Southeast Asia"], associatedStyles: [], structuralFeatures: ["dome", "harmika", "chattra", "torana"], culturalFunction: "Buddhist reliquary and meditation" },
  { id: "pagoda", name: "Pagoda", category: "Religious", parentTypeId: "religious", description: "Multi-tiered tower used in Buddhist and other traditions", historicalPeriod: "1st century to Modern", regions: ["East Asia", "Southeast Asia"], associatedStyles: [], structuralFeatures: ["tiered roofs", "central pillar", "bracket sets"], culturalFunction: "Buddhist devotion and landmark" },
  { id: "shrine", name: "Shrine", category: "Religious", parentTypeId: "religious", description: "Sacred site with a structure marking a holy place", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["torii gate", "haiden", "honden"], culturalFunction: "Veneration and pilgrimage" },
  { id: "monastery", name: "Monastery", category: "Religious", parentTypeId: "religious", description: "Residence and workplace for monastic communities", historicalPeriod: "4th century to Modern", regions: ["Europe", "South Asia", "East Asia"], associatedStyles: [], structuralFeatures: ["cloister", "refectory", "chapter house", "cells"], culturalFunction: "Monastic life and scholarship" },
  { id: "madrasa", name: "Madrasa", category: "Religious", parentTypeId: "religious", description: "Islamic educational institution", historicalPeriod: "10th century to Modern", regions: ["Middle East", "Central Asia", "North Africa"], associatedStyles: [], structuralFeatures: ["courtyard", "iwan", "student cells", "prayer hall"], culturalFunction: "Islamic education" },
  // Funerary
  { id: "pyramid", name: "Pyramid", category: "Funerary", parentTypeId: "funerary", description: "Monumental tomb with triangular or stepped profile", historicalPeriod: "Ancient", regions: ["North Africa", "Central America"], associatedStyles: [], structuralFeatures: ["massive stone blocks", "burial chamber", "processional causeway"], culturalFunction: "Royal burial and afterlife preparation" },
  { id: "tomb", name: "Tomb", category: "Funerary", parentTypeId: "funerary", description: "Structure for housing the remains of the dead", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["burial chamber", "sarcophagus", "memorial inscription"], culturalFunction: "Burial and commemoration" },
  { id: "mausoleum", name: "Mausoleum", category: "Funerary", parentTypeId: "tomb", description: "Grand above-ground tomb for prominent individuals", historicalPeriod: "Classical to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["dome", "memorial hall", "gardens"], culturalFunction: "Elite burial and commemoration" },
  // Civic & Government
  { id: "palace", name: "Palace", category: "Civic", parentTypeId: "civic", description: "Grand residence of a ruler or head of state", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["throne room", "audience hall", "gardens", "courtyards"], culturalFunction: "Seat of power and governance" },
  { id: "town-hall", name: "Town Hall", category: "Civic", parentTypeId: "civic", description: "Administrative center for local government", historicalPeriod: "Medieval to Modern", regions: ["Europe", "Americas"], associatedStyles: [], structuralFeatures: ["council chamber", "clock tower", "public square"], culturalFunction: "Municipal governance" },
  { id: "basilica", name: "Basilica", category: "Civic", parentTypeId: "civic", description: "Large public building for assemblies and law courts", historicalPeriod: "Roman to Modern", regions: ["Europe", "Americas"], associatedStyles: [], structuralFeatures: ["nave", "aisles", "apse", "clerestory"], culturalFunction: "Public assembly and later worship" },
  { id: "government-building", name: "Government Building", category: "Civic", parentTypeId: "civic", description: "Structure housing governmental functions", historicalPeriod: "Classical to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["portico", "rotunda", "legislative chamber"], culturalFunction: "State administration" },
  // Military
  { id: "castle", name: "Castle", category: "Military", parentTypeId: "military", description: "Fortified residence of a lord or noble", historicalPeriod: "Medieval", regions: ["Europe", "Middle East", "East Asia"], associatedStyles: [], structuralFeatures: ["keep", "curtain wall", "moat", "battlements"], culturalFunction: "Defense and lordly residence" },
  { id: "fortress", name: "Fortress", category: "Military", parentTypeId: "military", description: "Large military stronghold for defense", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["thick walls", "bastions", "gatehouse", "barracks"], culturalFunction: "Military defense" },
  { id: "fort", name: "Fort", category: "Military", parentTypeId: "fortress", description: "Smaller enclosed defensive structure", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["ramparts", "guard towers", "parade ground"], culturalFunction: "Garrison and defense" },
  // Entertainment & Cultural
  { id: "theater", name: "Theater", category: "Entertainment", parentTypeId: "entertainment", description: "Structure designed for dramatic performances", historicalPeriod: "Classical to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["stage", "auditorium", "orchestra pit", "proscenium"], culturalFunction: "Performing arts" },
  { id: "amphitheater", name: "Amphitheater", category: "Entertainment", parentTypeId: "theater", description: "Open-air venue with tiered seating surrounding a central arena", historicalPeriod: "Roman", regions: ["Europe", "North Africa"], associatedStyles: [], structuralFeatures: ["arena", "tiered seating", "vomitoria", "hypogeum"], culturalFunction: "Gladiatorial and public spectacles" },
  { id: "ball-court", name: "Ball Court", category: "Entertainment", parentTypeId: "entertainment", description: "Enclosed playing field for Mesoamerican ballgame", historicalPeriod: "Pre-Columbian", regions: ["Central America"], associatedStyles: [], structuralFeatures: ["I-shaped court", "sloping walls", "stone rings"], culturalFunction: "Ritual sport" },
  { id: "museum", name: "Museum", category: "Cultural", parentTypeId: "entertainment", description: "Institution for preserving and exhibiting artifacts", historicalPeriod: "18th century to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["galleries", "atrium", "conservation labs"], culturalFunction: "Cultural preservation and education" },
  // Residential
  { id: "house", name: "House", category: "Residential", parentTypeId: "residential", description: "Dwelling for a single family or household", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["rooms", "roof", "entrance"], culturalFunction: "Domestic habitation" },
  { id: "villa", name: "Villa", category: "Residential", parentTypeId: "house", description: "Luxurious country or suburban residence", historicalPeriod: "Roman to Modern", regions: ["Europe", "Americas"], associatedStyles: [], structuralFeatures: ["gardens", "portico", "courtyard"], culturalFunction: "Elite residence" },
  { id: "apartment", name: "Apartment Building", category: "Residential", parentTypeId: "residential", description: "Multi-unit residential building", historicalPeriod: "Roman to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["multiple floors", "shared entrance", "balconies"], culturalFunction: "Urban housing" },
  { id: "housing-block", name: "Housing Block", category: "Residential", parentTypeId: "apartment", description: "Large-scale multi-unit residential complex", historicalPeriod: "20th century", regions: ["Global"], associatedStyles: [], structuralFeatures: ["standardized units", "communal spaces", "elevator cores"], culturalFunction: "Mass housing" },
  { id: "tea-house", name: "Tea House", category: "Residential", parentTypeId: "residential", description: "Intimate structure for tea ceremony", historicalPeriod: "15th century to Modern", regions: ["East Asia"], associatedStyles: [], structuralFeatures: ["tatami", "tokonoma", "nijiriguchi"], culturalFunction: "Tea ceremony and social gathering" },
  // Commercial
  { id: "market", name: "Market Hall", category: "Commercial", parentTypeId: "commercial", description: "Covered structure for trade and commerce", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["stalls", "open plan", "large roof span"], culturalFunction: "Trade and commerce" },
  { id: "caravanserai", name: "Caravanserai", category: "Commercial", parentTypeId: "commercial", description: "Roadside inn for merchants and travelers along trade routes", historicalPeriod: "10th to 19th century", regions: ["Middle East", "Central Asia"], associatedStyles: [], structuralFeatures: ["courtyard", "stables", "rooms", "fortified walls"], culturalFunction: "Trade route hospitality" },
  { id: "skyscraper", name: "Skyscraper", category: "Commercial", parentTypeId: "commercial", description: "Tall multi-story building for offices or mixed use", historicalPeriod: "Late 19th century to Modern", regions: ["North America", "East Asia", "Middle East"], associatedStyles: [], structuralFeatures: ["steel frame", "elevator", "curtain wall", "setbacks"], culturalFunction: "Commerce and urban density" },
  // Infrastructure
  { id: "aqueduct", name: "Aqueduct", category: "Infrastructure", parentTypeId: "infrastructure", description: "Water conveyance structure using gravity flow", historicalPeriod: "Ancient", regions: ["Europe", "Middle East"], associatedStyles: [], structuralFeatures: ["arched spans", "channels", "settling basins"], culturalFunction: "Water supply" },
  { id: "bath", name: "Bathhouse", category: "Infrastructure", parentTypeId: "infrastructure", description: "Public bathing facility", historicalPeriod: "Roman to Modern", regions: ["Europe", "Middle East", "East Asia"], associatedStyles: [], structuralFeatures: ["hypocaust", "pools", "frigidarium", "tepidarium"], culturalFunction: "Hygiene and social gathering" },
  { id: "step-well", name: "Step Well", category: "Infrastructure", parentTypeId: "infrastructure", description: "Deep well with steps descending to water level", historicalPeriod: "3rd millennium BCE to Modern", regions: ["South Asia"], associatedStyles: [], structuralFeatures: ["stepped corridor", "ornamental galleries", "water storage"], culturalFunction: "Water access and community gathering" },
  // Educational
  { id: "university", name: "University", category: "Educational", parentTypeId: "educational", description: "Institution of higher learning with multiple buildings", historicalPeriod: "Medieval to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["quadrangle", "library", "lecture halls", "chapel"], culturalFunction: "Higher education and research" },
  { id: "library", name: "Library", category: "Educational", parentTypeId: "educational", description: "Building for storing and accessing written works", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["reading rooms", "stacks", "catalog system"], culturalFunction: "Knowledge preservation" },
  // Landscape & Garden
  { id: "garden", name: "Formal Garden", category: "Landscape", parentTypeId: "landscape", description: "Designed outdoor space with organized plantings", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["axial layout", "water features", "parterres"], culturalFunction: "Recreation and contemplation" },
  { id: "observatory", name: "Observatory", category: "Scientific", parentTypeId: "educational", description: "Structure designed for astronomical observation", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["dome", "sighting instruments", "elevated platform"], culturalFunction: "Astronomical observation" },
  // Transportation
  { id: "gate-tower", name: "Gate Tower", category: "Infrastructure", parentTypeId: "infrastructure", description: "Monumental entrance structure to a city or compound", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["archway", "guard chambers", "defensive features"], culturalFunction: "Access control and ceremony" },
  { id: "triumphal-arch", name: "Triumphal Arch", category: "Commemorative", parentTypeId: "civic", description: "Monumental arch celebrating military victory", historicalPeriod: "Roman to Modern", regions: ["Europe"], associatedStyles: [], structuralFeatures: ["barrel vault", "relief sculpture", "inscription"], culturalFunction: "Military commemoration" },
  // Agricultural
  { id: "granary", name: "Granary", category: "Agricultural", parentTypeId: "agricultural", description: "Structure for storing grain", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["elevated floor", "ventilation", "rodent barriers"], culturalFunction: "Food storage" },
  { id: "agricultural-terrace", name: "Agricultural Terrace", category: "Agricultural", parentTypeId: "agricultural", description: "Stepped landscape modification for farming on slopes", historicalPeriod: "Ancient to Modern", regions: ["South America", "Southeast Asia", "Mediterranean"], associatedStyles: [], structuralFeatures: ["retaining walls", "irrigation channels", "stepped platforms"], culturalFunction: "Hillside agriculture" },
  // Additional types referenced by existing architectural styles data
  { id: "agora", name: "Agora", category: "Civic", parentTypeId: "civic", description: "Open public space for assembly and commerce in Greek cities", historicalPeriod: "Classical", regions: ["Southern Europe"], associatedStyles: [], structuralFeatures: ["colonnade", "open space", "surrounding stoas"], culturalFunction: "Public assembly and commerce" },
  { id: "stoa", name: "Stoa", category: "Civic", parentTypeId: "civic", description: "Covered walkway or portico for public use", historicalPeriod: "Classical", regions: ["Southern Europe"], associatedStyles: [], structuralFeatures: ["colonnade", "covered walkway", "shops"], culturalFunction: "Public shelter and commerce" },
  { id: "obelisk", name: "Obelisk", category: "Commemorative", parentTypeId: "civic", description: "Tall, four-sided tapering monument topped by a pyramidion", historicalPeriod: "Ancient", regions: ["North Africa"], associatedStyles: [], structuralFeatures: ["monolithic stone", "pyramidal cap", "hieroglyphs"], culturalFunction: "Solar worship and commemoration" },
  { id: "pyramid-temple", name: "Pyramid-Temple", category: "Religious", parentTypeId: "pyramid", description: "Stepped pyramid with temple structure at the summit", historicalPeriod: "Pre-Columbian", regions: ["Central America"], associatedStyles: [], structuralFeatures: ["stepped platform", "summit temple", "staircase"], culturalFunction: "Religious ceremony" },
  { id: "civic-building", name: "Civic Building", category: "Civic", parentTypeId: "civic", description: "General public building serving civic functions", historicalPeriod: "Renaissance to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["public hall", "facade", "entrance portico"], culturalFunction: "Public administration" },
  { id: "compound", name: "Compound", category: "Residential", parentTypeId: "residential", description: "Enclosed cluster of buildings forming a household unit", historicalPeriod: "Ancient to Modern", regions: ["Africa", "South Asia"], associatedStyles: [], structuralFeatures: ["perimeter wall", "courtyard", "multiple structures"], culturalFunction: "Extended family dwelling" },
  { id: "hotel", name: "Hotel", category: "Commercial", parentTypeId: "commercial", description: "Building providing lodging for travelers", historicalPeriod: "18th century to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["lobby", "guest rooms", "dining hall"], culturalFunction: "Hospitality" },
  { id: "department-store", name: "Department Store", category: "Commercial", parentTypeId: "commercial", description: "Large retail establishment with multiple departments", historicalPeriod: "19th century to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["open floor plan", "display windows", "atrium"], culturalFunction: "Retail commerce" },
  { id: "metro-station", name: "Metro Station", category: "Infrastructure", parentTypeId: "infrastructure", description: "Underground or elevated station for urban rail transit", historicalPeriod: "Late 19th century to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["platform", "tunnel", "entrance canopy"], culturalFunction: "Urban transit" },
  { id: "office-tower", name: "Office Tower", category: "Commercial", parentTypeId: "skyscraper", description: "Tall building primarily for commercial offices", historicalPeriod: "20th century to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["steel frame", "elevator core", "curtain wall"], culturalFunction: "Commerce" },
  { id: "reservoir", name: "Reservoir", category: "Infrastructure", parentTypeId: "infrastructure", description: "Artificial body of water for storage and distribution", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["dam", "embankment", "sluice gates"], culturalFunction: "Water management" },
  { id: "causeway", name: "Causeway", category: "Infrastructure", parentTypeId: "infrastructure", description: "Raised path or road across water or low ground", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["elevated roadbed", "drainage", "retaining walls"], culturalFunction: "Transportation" },
  { id: "city", name: "City Plan", category: "Infrastructure", parentTypeId: "infrastructure", description: "Planned urban settlement layout", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["grid layout", "walls", "central plaza"], culturalFunction: "Urban habitation" },
  { id: "road-system", name: "Road System", category: "Infrastructure", parentTypeId: "infrastructure", description: "Network of engineered pathways for travel and trade", historicalPeriod: "Ancient to Modern", regions: ["Global"], associatedStyles: [], structuralFeatures: ["paved surface", "drainage", "bridges"], culturalFunction: "Transportation and trade" },
];

const BUILDING_CATEGORIES = [
  { id: "religious", name: "Religious", description: "Structures dedicated to worship and spiritual practice" },
  { id: "funerary", name: "Funerary", description: "Structures for burial and commemoration of the dead" },
  { id: "civic", name: "Civic & Government", description: "Buildings for governance and public administration" },
  { id: "military", name: "Military & Defensive", description: "Fortifications and defensive structures" },
  { id: "entertainment", name: "Entertainment & Cultural", description: "Venues for performance, sport, and culture" },
  { id: "residential", name: "Residential", description: "Domestic dwellings and living spaces" },
  { id: "commercial", name: "Commercial", description: "Structures for trade and business" },
  { id: "infrastructure", name: "Infrastructure", description: "Public works and utility structures" },
  { id: "educational", name: "Educational & Scientific", description: "Institutions of learning and research" },
  { id: "landscape", name: "Landscape & Garden", description: "Designed outdoor environments" },
  { id: "agricultural", name: "Agricultural", description: "Structures for farming and food production" },
];

export class ArchitecturalStylesScraper {
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

  getBuildingTypeTaxonomy(): BuildingType[] {
    return BUILDING_TYPE_TAXONOMY;
  }

  getBuildingCategories(): typeof BUILDING_CATEGORIES {
    return BUILDING_CATEGORIES;
  }

  getBuildingTypesByCategory(category: string): BuildingType[] {
    return BUILDING_TYPE_TAXONOMY.filter(
      (bt) => bt.category.toLowerCase() === category.toLowerCase()
    );
  }

  getBuildingTypeById(id: string): BuildingType | null {
    return BUILDING_TYPE_TAXONOMY.find((bt) => bt.id === id) ?? null;
  }

  getBuildingTypeChildren(parentId: string): BuildingType[] {
    return BUILDING_TYPE_TAXONOMY.filter((bt) => bt.parentTypeId === parentId);
  }

  async scrapeArchitecturalStyles(options: {
    jobId?: string;
    progressCallback?: (type: string, message: string) => void;
  } = {}): Promise<{ styles: ArchitecturalStyle[]; count: number }> {
    const { jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (ArchitecturalStylesScraper.isScraping) {
      throw new Error("Architectural styles scraping is already in progress");
    }

    ArchitecturalStylesScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      progressCallback?.("progress", "Discovering architectural styles with building type taxonomy...");

      const styles = await this.discoverStyles(progressCallback);

      progressCallback?.("progress", `Discovered ${styles.length} architectural styles, writing TSV...`);

      await this.writeStylesTSV(styles);
      await this.writeBuildingTypesTSV();

      this.updateJobStatus(jobId, {
        status: "completed",
        completedWords: styles.length,
        totalWords: styles.length,
        completedAt: new Date().toISOString(),
      });

      progressCallback?.("complete", `Scraped ${styles.length} architectural styles with building type taxonomy`);

      return { styles, count: styles.length };
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      ArchitecturalStylesScraper.isScraping = false;
    }
  }

  private async discoverStyles(
    progressCallback?: (type: string, message: string) => void
  ): Promise<ArchitecturalStyle[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const validBuildingTypes = BUILDING_TYPE_TAXONOMY.map((bt) => bt.id).join(", ");

    const prompt = `You are an expert architectural historian. Generate a comprehensive list of 50 distinct architectural styles from around the world, spanning from ancient civilizations to the 20th century.

For each style, provide:
- name: The common English name of the style
- stylePeriod: The broader period category (e.g., "Ancient Egyptian", "Classical", "Medieval", "Renaissance", "Baroque", "Colonial", "Modernist", "Art Deco", etc.)
- originDate: Year of emergence (negative for BCE)
- endDate: Year style declined or ended (negative for BCE)
- originLat: Latitude of primary origin
- originLng: Longitude of primary origin
- region: Geographic region (e.g., "Southern Europe", "East Asia", "South Asia", "Middle East")
- description: 1-2 sentence description of the style's key characteristics
- associatedCivilizations: Civilization(s) associated with this style
- associatedLanguages: Array of ISO 639 language codes associated with cultures that built in this style
- keyFeatures: Array of 4-6 distinctive architectural features
- notableExamples: Array of 3-5 famous buildings/structures
- buildingTypes: Array of building type IDs from this taxonomy: ${validBuildingTypes}

Include styles from ALL major world regions:
- Africa (Egyptian, Aksumite, Great Zimbabwe, Swahili, etc.)
- Americas (Mesoamerican, Andean, Colonial, etc.)
- Asia (Chinese, Japanese, Indian, Khmer, Persian, etc.)
- Europe (Greek, Roman, Byzantine, Gothic, Renaissance, Baroque, etc.)
- Middle East & Central Asia (Islamic, Ottoman, Timurid, etc.)
- Oceania (if applicable)

Do NOT duplicate these existing styles: Egyptian Monumental, Greek Classical, Roman Imperial, Byzantine, Romanesque, Gothic, Islamic, Indian Temple, Chinese Traditional, Japanese Traditional, Mesoamerican, Renaissance, Baroque, Mughal, Art Nouveau, Art Deco, Modernist, Khmer, Sub-Saharan African, Andean.

Generate 30 NEW styles not in the list above.`;

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            styles: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  stylePeriod: { type: SchemaType.STRING },
                  originDate: { type: SchemaType.NUMBER },
                  endDate: { type: SchemaType.NUMBER },
                  originLat: { type: SchemaType.NUMBER },
                  originLng: { type: SchemaType.NUMBER },
                  region: { type: SchemaType.STRING },
                  description: { type: SchemaType.STRING },
                  associatedCivilizations: { type: SchemaType.STRING },
                  associatedLanguages: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  keyFeatures: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  notableExamples: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  buildingTypes: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                },
                required: [
                  "name", "stylePeriod", "originDate", "endDate",
                  "originLat", "originLng", "region", "description",
                  "associatedCivilizations", "associatedLanguages",
                  "keyFeatures", "notableExamples", "buildingTypes",
                ],
              },
            },
          },
          required: ["styles"],
        },
      },
    });

    progressCallback?.("progress", "Calling Gemini API for architectural styles...");

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed || !Array.isArray(parsed.styles)) {
      throw new Error("Invalid response structure from Gemini");
    }

    progressCallback?.("progress", `Received ${parsed.styles.length} new styles from Gemini`);

    // Read existing styles to merge
    const existingStyles = await this.readExistingStyles();
    const maxExistingNum = existingStyles.reduce((max, s) => {
      const match = s.id.match(/^arch-(\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);

    const newStyles: ArchitecturalStyle[] = parsed.styles.map(
      (style: any, index: number) => {
        const num = maxExistingNum + index + 1;
        const id = `arch-${String(num).padStart(3, "0")}`;

        // Filter building types to only valid ones
        const validIds = new Set(BUILDING_TYPE_TAXONOMY.map((bt) => bt.id));
        const buildingTypes = (style.buildingTypes || []).filter((bt: string) =>
          validIds.has(bt)
        );

        return {
          id,
          name: style.name,
          stylePeriod: style.stylePeriod,
          originDate: style.originDate,
          endDate: style.endDate,
          originCoordinates: {
            lat: style.originLat,
            lng: style.originLng,
          },
          region: style.region,
          description: style.description,
          associatedCivilizations: style.associatedCivilizations,
          associatedLanguages: style.associatedLanguages || [],
          keyFeatures: style.keyFeatures || [],
          notableExamples: style.notableExamples || [],
          buildingTypes: buildingTypes,
        };
      }
    );

    return [...existingStyles, ...newStyles];
  }

  private async readExistingStyles(): Promise<ArchitecturalStyle[]> {
    const filePath = path.resolve("lexicons/architectural-styles.tsv");
    if (!fs.existsSync(filePath)) return [];

    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");
    if (lines.length <= 1) return [];

    const headers = lines[0].split("\t");
    const getIdx = (name: string) => headers.indexOf(name);

    return lines.slice(1).map((line) => {
      const cols = line.split("\t");
      const parseJsonArray = (val: string): string[] => {
        try {
          return JSON.parse(val);
        } catch {
          return [];
        }
      };
      const parseCoords = (val: string) => {
        try {
          return JSON.parse(val);
        } catch {
          return { lat: 0, lng: 0 };
        }
      };

      return {
        id: cols[getIdx("id")] || "",
        name: cols[getIdx("name")] || "",
        stylePeriod: cols[getIdx("style_period")] || "",
        originDate: parseInt(cols[getIdx("origin_date")] || "0", 10),
        endDate: parseInt(cols[getIdx("end_date")] || "0", 10),
        originCoordinates: parseCoords(cols[getIdx("origin_coordinates")] || "{}"),
        region: cols[getIdx("region")] || "",
        description: cols[getIdx("description")] || "",
        associatedCivilizations: cols[getIdx("associated_civilizations")] || "",
        associatedLanguages: parseJsonArray(cols[getIdx("associated_languages")] || "[]"),
        keyFeatures: parseJsonArray(cols[getIdx("key_features")] || "[]"),
        notableExamples: parseJsonArray(cols[getIdx("notable_examples")] || "[]"),
        buildingTypes: parseJsonArray(cols[getIdx("building_types")] || "[]"),
      };
    });
  }

  private async writeStylesTSV(styles: ArchitecturalStyle[]): Promise<void> {
    const headers = [
      "id", "name", "style_period", "origin_date", "end_date",
      "origin_coordinates", "region", "description", "associated_civilizations",
      "associated_languages", "key_features", "notable_examples", "building_types",
    ];

    const rows = styles.map((s) => [
      s.id,
      s.name,
      s.stylePeriod,
      s.originDate.toString(),
      s.endDate.toString(),
      JSON.stringify(s.originCoordinates),
      s.region,
      s.description,
      s.associatedCivilizations,
      JSON.stringify(s.associatedLanguages),
      JSON.stringify(s.keyFeatures),
      JSON.stringify(s.notableExamples),
      JSON.stringify(s.buildingTypes),
    ]);

    const filePath = path.resolve("lexicons/architectural-styles.tsv");
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${filePath}.tmp`;
    const headerLine = headers.join("\t");
    const dataLines = rows.map((row) => row.join("\t"));
    const tsvContent = [headerLine, ...dataLines].join("\n") + "\n";

    await fs.promises.writeFile(tempFile, tsvContent, "utf8");
    await fs.promises.rename(tempFile, filePath);

    console.log(`Wrote ${styles.length} architectural styles to ${filePath}`);
  }

  private async writeBuildingTypesTSV(): Promise<void> {
    const headers = [
      "id", "name", "category", "parent_type_id", "description",
      "historical_period", "regions", "associated_styles", "structural_features",
      "cultural_function",
    ];

    const rows = BUILDING_TYPE_TAXONOMY.map((bt) => [
      bt.id,
      bt.name,
      bt.category,
      bt.parentTypeId,
      bt.description,
      bt.historicalPeriod,
      JSON.stringify(bt.regions),
      JSON.stringify(bt.associatedStyles),
      JSON.stringify(bt.structuralFeatures),
      bt.culturalFunction,
    ]);

    const filePath = path.resolve("lexicons/building-types.tsv");
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const tempFile = `${filePath}.tmp`;
    const headerLine = headers.join("\t");
    const dataLines = rows.map((row) => row.join("\t"));
    const tsvContent = [headerLine, ...dataLines].join("\n") + "\n";

    await fs.promises.writeFile(tempFile, tsvContent, "utf8");
    await fs.promises.rename(tempFile, filePath);

    console.log(`Wrote ${BUILDING_TYPE_TAXONOMY.length} building types to ${filePath}`);
  }
}

export const architecturalStylesScraper = new ArchitecturalStylesScraper();
