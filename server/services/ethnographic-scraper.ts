import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { tsvWriter } from "./tsv-writer";
import { jobStore } from "./job-store";
import fs from "node:fs";

export interface KinshipSystemEntry {
  id: string;
  systemType: string;
  languageIds: string[];
  terminology: Record<string, string>;
  descentRule: string;
  residenceRule: string;
  associatedCivilizations: string;
}

export interface SocialOrganizationEntry {
  id: string;
  name: string;
  cultureOrLanguage: string;
  region: string;
  politicalStructure: string;
  stratificationType: string;
  subsistencePattern: string;
  marriageSystem: string;
  descentSystem: string;
  residencePattern: string;
  kinshipTerminology: string;
  propertyInheritance: string;
  genderRoles: string;
  ageGrades: string;
  clanOrMoietySystem: string;
  timeOrigin: string;
  timeEnd: string;
  notes: string;
}

export class EthnographicScraper {
  private static isScraping = false;

  private updateJobStatus(
    jobId: string | undefined,
    updates: Record<string, unknown>
  ): void {
    if (!jobId) return;
    try {
      jobStore.updateJob(jobId, updates as any);
    } catch (error) {
      console.error("Failed to update job status:", error);
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  async scrapeKinshipSystems(options: {
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  } = {}): Promise<KinshipSystemEntry[]> {
    const { jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (EthnographicScraper.isScraping) {
      throw new Error("Ethnographic scraping is already in progress");
    }

    EthnographicScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, { status: "running", startedAt: new Date().toISOString() });
      progressCallback?.("progress", "Loading existing kinship systems...");

      const existingIds = await this.getExistingKinshipIds();
      progressCallback?.("progress", `Found ${existingIds.size} existing kinship systems, scraping new ones...`);

      const regions = [
        "Sub-Saharan Africa",
        "North Africa and Middle East",
        "South Asia",
        "East Asia",
        "Southeast Asia",
        "Central Asia",
        "Europe",
        "Oceania and Pacific Islands",
        "North America (Indigenous)",
        "Central and South America (Indigenous)",
        "Arctic and Subarctic peoples",
      ];

      const allSystems: KinshipSystemEntry[] = [];
      this.updateJobStatus(jobId, { totalWords: regions.length });

      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        progressCallback?.("progress", `Scraping kinship systems for ${region} (${i + 1}/${regions.length})...`);

        try {
          const systems = await this.scrapeKinshipForRegion(region, existingIds);
          allSystems.push(...systems);
          this.updateJobStatus(jobId, { completedWords: i + 1 });
        } catch (error) {
          console.error(`Failed to scrape kinship for ${region}:`, error);
          progressCallback?.("error", `Failed to scrape ${region}: ${error}`);
        }
      }

      progressCallback?.("progress", `Writing ${allSystems.length} kinship systems to TSV...`);
      await this.appendKinshipSystemsTSV(allSystems);

      this.updateJobStatus(jobId, { status: "completed", completedAt: new Date().toISOString() });
      progressCallback?.("completed", `Scraped ${allSystems.length} kinship systems`);

      return allSystems;
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });
      progressCallback?.("error", `Scraping failed: ${error}`);
      throw error;
    } finally {
      EthnographicScraper.isScraping = false;
    }
  }

  async scrapeSocialOrganization(options: {
    jobId?: string;
    progressCallback?: (type: string, message: string, data?: any) => void;
  } = {}): Promise<SocialOrganizationEntry[]> {
    const { jobId, progressCallback } = options;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required for scraping");
    }

    if (EthnographicScraper.isScraping) {
      throw new Error("Ethnographic scraping is already in progress");
    }

    EthnographicScraper.isScraping = true;

    try {
      this.updateJobStatus(jobId, { status: "running", startedAt: new Date().toISOString() });
      progressCallback?.("progress", "Loading existing social organization data...");

      const existingIds = await this.getExistingSocialOrgIds();
      progressCallback?.("progress", `Found ${existingIds.size} existing entries, scraping new ones...`);

      const categories = [
        "Hunter-gatherer bands and foraging societies",
        "Pastoral nomadic societies",
        "Horticultural and shifting cultivation societies",
        "Agrarian state societies and empires",
        "Chiefdoms and ranked societies",
        "Segmentary lineage societies",
        "Age-set and age-grade organized societies",
        "Matrilineal and matrilocal societies",
        "Caste-stratified societies",
        "Maritime and trading societies",
      ];

      const allOrgs: SocialOrganizationEntry[] = [];
      this.updateJobStatus(jobId, { totalWords: categories.length });

      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        progressCallback?.("progress", `Scraping social organization: ${category} (${i + 1}/${categories.length})...`);

        try {
          const orgs = await this.scrapeSocialOrgForCategory(category, existingIds);
          allOrgs.push(...orgs);
          this.updateJobStatus(jobId, { completedWords: i + 1 });
        } catch (error) {
          console.error(`Failed to scrape social org for ${category}:`, error);
          progressCallback?.("error", `Failed to scrape ${category}: ${error}`);
        }
      }

      progressCallback?.("progress", `Writing ${allOrgs.length} social organization entries to TSV...`);
      await this.writeSocialOrganizationTSV(allOrgs);

      this.updateJobStatus(jobId, { status: "completed", completedAt: new Date().toISOString() });
      progressCallback?.("completed", `Scraped ${allOrgs.length} social organization entries`);

      return allOrgs;
    } catch (error) {
      this.updateJobStatus(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });
      progressCallback?.("error", `Scraping failed: ${error}`);
      throw error;
    } finally {
      EthnographicScraper.isScraping = false;
    }
  }

  private async scrapeKinshipForRegion(
    region: string,
    existingIds: Set<string>
  ): Promise<KinshipSystemEntry[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            systems: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  cultureName: { type: SchemaType.STRING },
                  systemType: { type: SchemaType.STRING },
                  languageCodes: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                  },
                  terminology: {
                    type: SchemaType.OBJECT,
                    properties: {
                      mother: { type: SchemaType.STRING },
                      father: { type: SchemaType.STRING },
                      motherBrother: { type: SchemaType.STRING },
                      fatherSister: { type: SchemaType.STRING },
                      fatherBrother: { type: SchemaType.STRING },
                      motherSister: { type: SchemaType.STRING },
                      brother: { type: SchemaType.STRING },
                      sister: { type: SchemaType.STRING },
                      son: { type: SchemaType.STRING },
                      daughter: { type: SchemaType.STRING },
                    },
                    required: ["mother", "father", "brother", "sister"],
                  },
                  descentRule: { type: SchemaType.STRING },
                  residenceRule: { type: SchemaType.STRING },
                  associatedCivilizations: { type: SchemaType.STRING },
                },
                required: [
                  "cultureName",
                  "systemType",
                  "languageCodes",
                  "terminology",
                  "descentRule",
                  "residenceRule",
                  "associatedCivilizations",
                ],
              },
            },
          },
          required: ["systems"],
        },
      },
    });

    const prompt = `You are a cultural anthropologist. Generate 5-8 distinct kinship systems from ${region}.

For each society/culture, provide:
- cultureName: The culture/ethnic group name
- systemType: One of: Eskimo, Hawaiian, Sudanese, Omaha, Crow, Iroquois, Dravidian
- languageCodes: ISO 639-2/3 codes for languages spoken by this group
- terminology: Kinship terms in the native language (mother, father, motherBrother, fatherSister, fatherBrother, motherSister, brother, sister, son, daughter)
- descentRule: One of: patrilineal, matrilineal, bilateral, ambilineal, double
- residenceRule: One of: patrilocal, matrilocal, neolocal, avunculocal, ambilocal
- associatedCivilizations: Brief description of associated civilization/culture area

Focus on well-documented ethnographic cases. Use accurate native-language kinship terms.
Do NOT include cultures that are already covered by these IDs: ${Array.from(existingIds).slice(0, 30).join(", ")}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed?.systems || !Array.isArray(parsed.systems)) {
      throw new Error("Invalid response structure from Gemini");
    }

    return parsed.systems.map((sys: any) => {
      const id = `kin-${this.slugify(sys.cultureName)}`;
      if (existingIds.has(id)) return null;
      existingIds.add(id);

      return {
        id,
        systemType: sys.systemType,
        languageIds: sys.languageCodes || [],
        terminology: sys.terminology || {},
        descentRule: sys.descentRule,
        residenceRule: sys.residenceRule,
        associatedCivilizations: sys.associatedCivilizations,
      };
    }).filter(Boolean) as KinshipSystemEntry[];
  }

  private async scrapeSocialOrgForCategory(
    category: string,
    existingIds: Set<string>
  ): Promise<SocialOrganizationEntry[]> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            societies: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  name: { type: SchemaType.STRING },
                  cultureOrLanguage: { type: SchemaType.STRING },
                  region: { type: SchemaType.STRING },
                  politicalStructure: { type: SchemaType.STRING },
                  stratificationType: { type: SchemaType.STRING },
                  subsistencePattern: { type: SchemaType.STRING },
                  marriageSystem: { type: SchemaType.STRING },
                  descentSystem: { type: SchemaType.STRING },
                  residencePattern: { type: SchemaType.STRING },
                  kinshipTerminology: { type: SchemaType.STRING },
                  propertyInheritance: { type: SchemaType.STRING },
                  genderRoles: { type: SchemaType.STRING },
                  ageGrades: { type: SchemaType.STRING },
                  clanOrMoietySystem: { type: SchemaType.STRING },
                  timeOrigin: { type: SchemaType.STRING },
                  timeEnd: { type: SchemaType.STRING },
                  notes: { type: SchemaType.STRING },
                },
                required: [
                  "name",
                  "cultureOrLanguage",
                  "region",
                  "politicalStructure",
                  "stratificationType",
                  "subsistencePattern",
                  "marriageSystem",
                  "descentSystem",
                  "residencePattern",
                  "kinshipTerminology",
                  "propertyInheritance",
                  "notes",
                ],
              },
            },
          },
          required: ["societies"],
        },
      },
    });

    const prompt = `You are a cultural anthropologist specializing in social organization. Generate 6-10 well-documented examples of: ${category}.

For each society, provide:
- name: Society/culture name (e.g., "Nuer", "Trobriand Islanders", "Maasai")
- cultureOrLanguage: Primary language or language family
- region: Geographic region
- politicalStructure: e.g., acephalous, chiefdom, state, band, segmentary
- stratificationType: e.g., egalitarian, ranked, stratified, caste
- subsistencePattern: e.g., foraging, pastoralism, horticulture, agriculture, mixed
- marriageSystem: e.g., monogamy, polygyny, polyandry, group marriage
- descentSystem: e.g., patrilineal, matrilineal, bilateral, ambilineal, double
- residencePattern: e.g., patrilocal, matrilocal, neolocal, avunculocal
- kinshipTerminology: System type (Eskimo, Hawaiian, Sudanese, Omaha, Crow, Iroquois, Dravidian)
- propertyInheritance: How property/resources are transmitted
- genderRoles: Brief description of gender division of labor and status
- ageGrades: Whether age-grades/age-sets are present and their role
- clanOrMoietySystem: Clan, moiety, or phratry organization if applicable
- timeOrigin: Approximate start date (negative for BCE)
- timeEnd: End date or "present" if still extant
- notes: Key ethnographic observations or notable features

Focus on ethnographically well-documented cases from the Human Relations Area Files (HRAF) or classic anthropological literature.
Do NOT include societies already covered by these IDs: ${Array.from(existingIds).slice(0, 30).join(", ")}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed?.societies || !Array.isArray(parsed.societies)) {
      throw new Error("Invalid response structure from Gemini");
    }

    return parsed.societies.map((soc: any) => {
      const id = `soc-${this.slugify(soc.name)}`;
      if (existingIds.has(id)) return null;
      existingIds.add(id);

      return {
        id,
        name: soc.name,
        cultureOrLanguage: soc.cultureOrLanguage || "",
        region: soc.region || "",
        politicalStructure: soc.politicalStructure || "",
        stratificationType: soc.stratificationType || "",
        subsistencePattern: soc.subsistencePattern || "",
        marriageSystem: soc.marriageSystem || "",
        descentSystem: soc.descentSystem || "",
        residencePattern: soc.residencePattern || "",
        kinshipTerminology: soc.kinshipTerminology || "",
        propertyInheritance: soc.propertyInheritance || "",
        genderRoles: soc.genderRoles || "",
        ageGrades: soc.ageGrades || "",
        clanOrMoietySystem: soc.clanOrMoietySystem || "",
        timeOrigin: soc.timeOrigin || "",
        timeEnd: soc.timeEnd || "",
        notes: soc.notes || "",
      };
    }).filter(Boolean) as SocialOrganizationEntry[];
  }

  private async getExistingKinshipIds(): Promise<Set<string>> {
    const filePath = "data/source/lexicons/kinship-systems.tsv";
    const ids = new Set<string>();

    if (!fs.existsSync(filePath)) return ids;

    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");

    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split("\t");
      if (columns[0]) ids.add(columns[0]);
    }

    return ids;
  }

  private async getExistingSocialOrgIds(): Promise<Set<string>> {
    const filePath = "data/source/lexicons/social-organization.tsv";
    const ids = new Set<string>();

    if (!fs.existsSync(filePath)) return ids;

    const content = await fs.promises.readFile(filePath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim() !== "");

    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split("\t");
      if (columns[0]) ids.add(columns[0]);
    }

    return ids;
  }

  private async appendKinshipSystemsTSV(systems: KinshipSystemEntry[]): Promise<void> {
    const filePath = "data/source/lexicons/kinship-systems.tsv";
    const fileExists = fs.existsSync(filePath);

    const rows = systems.map((sys) =>
      [
        sys.id,
        sys.systemType,
        JSON.stringify(sys.languageIds),
        JSON.stringify(sys.terminology),
        sys.descentRule,
        sys.residenceRule,
        sys.associatedCivilizations,
      ].join("\t")
    );

    if (!fileExists) {
      const header = "id\tsystem_type\tlanguage_ids\tterminology\tdescent_rule\tresidence_rule\tassociated_civilizations";
      const content = [header, ...rows].join("\n") + "\n";
      await fs.promises.writeFile(filePath, content, "utf8");
    } else {
      const content = rows.join("\n") + "\n";
      await fs.promises.appendFile(filePath, content, "utf8");
    }

    console.log(`Wrote ${systems.length} kinship systems to ${filePath}`);
  }

  async writeSocialOrganizationTSV(orgs: SocialOrganizationEntry[]): Promise<void> {
    const filePath = "data/source/lexicons/social-organization.tsv";
    const fileExists = fs.existsSync(filePath);

    const headers = [
      "id", "name", "culture_or_language", "region", "political_structure",
      "stratification_type", "subsistence_pattern", "marriage_system",
      "descent_system", "residence_pattern", "kinship_terminology",
      "property_inheritance", "gender_roles", "age_grades",
      "clan_or_moiety_system", "time_origin", "time_end", "notes",
    ];

    const rows = orgs.map((org) =>
      [
        org.id,
        org.name,
        org.cultureOrLanguage,
        org.region,
        org.politicalStructure,
        org.stratificationType,
        org.subsistencePattern,
        org.marriageSystem,
        org.descentSystem,
        org.residencePattern,
        org.kinshipTerminology,
        org.propertyInheritance,
        org.genderRoles,
        org.ageGrades,
        org.clanOrMoietySystem,
        org.timeOrigin,
        org.timeEnd,
        org.notes,
      ].join("\t")
    );

    if (!fileExists) {
      const content = [headers.join("\t"), ...rows].join("\n") + "\n";
      await fs.promises.writeFile(filePath, content, "utf8");
    } else {
      const content = rows.join("\n") + "\n";
      await fs.promises.appendFile(filePath, content, "utf8");
    }

    console.log(`Wrote ${orgs.length} social organization entries to ${filePath}`);
  }

  static get isCurrentlyScraping(): boolean {
    return EthnographicScraper.isScraping;
  }
}

export const ethnographicScraper = new EthnographicScraper();
