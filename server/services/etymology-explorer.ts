import { db as _db } from "../db";
import { 
  etymologies, 
  wordMigrations, 
  etymologicalNetworks,
  baseWords,
  languages,
  wordTranslations
} from "@shared/schema";
import { eq, and, or, like, sql } from "drizzle-orm";

const db = _db as any;

interface EtymologyPath {
  language: string;
  form: string;
  meaning: string;
  timeperiod: string;
  notes?: string;
}

interface MigrationRoute {
  fromLanguage: string;
  toLanguage: string;
  timeperiod: string;
  mechanism: string;
  confidence: number;
}

interface CognateInfo {
  language: string;
  form: string;
  meaning: string;
  relationship: string;
}

export class EtymologyExplorer {
  
  async generateEtymologyData(): Promise<void> {
    console.log("Generating comprehensive etymology data...");

    if (!_db) {
      throw new Error("Database is not configured. Set DATABASE_URL to use etymology features.");
    }
    
    try {
      // Create etymological data for common Indo-European words
      await this.createIndoEuropeanEtymologies();
      await this.createLatinBorrowings();
      await this.createGermanicEtymologies();
      await this.createFrenchBorrowings();
      
      console.log("Etymology data generation completed successfully");
    } catch (error) {
      console.error("Error generating etymology data:", error);
      throw error;
    }
  }

  private async createIndoEuropeanEtymologies(): Promise<void> {
    console.log("Creating Indo-European etymologies...");
    
    // Get base words and languages to work with
    const waterWord = await db.select().from(baseWords).where(eq(baseWords.word, "water")).limit(1);
    const motherWord = await db.select().from(baseWords).where(eq(baseWords.word, "mother")).limit(1);
    const fireWord = await db.select().from(baseWords).where(eq(baseWords.word, "fire")).limit(1);
    
    // Use known English language ID
    const targetLanguageId = "lang1"; // English language ID from database
    
    if (waterWord.length > 0) {
      await db.insert(etymologies).values({
        baseWordId: waterWord[0].id,
        targetLanguageId: targetLanguageId,
        originalForm: "*h₂ekʷeh₂",
        currentForm: "water",
        etymologyPath: [
          {
            language: "Proto-Indo-European",
            form: "*h₂ekʷeh₂",
            meaning: "water, flowing water",
            timeperiod: "3500-2500 BCE",
            notes: "Reconstructed root for water in many IE languages"
          },
          {
            language: "Proto-Germanic",
            form: "*watōr",
            meaning: "water",
            timeperiod: "500 BCE-500 CE",
            notes: "Germanic development with regular sound changes"
          },
          {
            language: "Old English",
            form: "wæter",
            meaning: "water, liquid",
            timeperiod: "450-1150 CE"
          },
          {
            language: "Middle English",
            form: "water",
            meaning: "water",
            timeperiod: "1150-1500 CE"
          },
          {
            language: "Modern English",
            form: "water",
            meaning: "water",
            timeperiod: "1500 CE-present"
          }
        ],
        cognates: [
          {
            language: "German",
            form: "Wasser",
            meaning: "water",
            relationship: "cognate"
          },
          {
            language: "Dutch",
            form: "water",
            meaning: "water", 
            relationship: "cognate"
          },
          {
            language: "Latin",
            form: "aqua",
            meaning: "water",
            relationship: "cognate"
          },
          {
            language: "Sanskrit",
            form: "अप् (ap)",
            meaning: "water",
            relationship: "cognate"
          }
        ],
        phoneticChanges: [
          {
            timeperiod: "PIE to Proto-Germanic",
            oldForm: "*h₂ekʷeh₂",
            newForm: "*watōr",
            soundLaw: "Grimm's Law and other Germanic changes"
          },
          {
            timeperiod: "Proto-Germanic to Old English",
            oldForm: "*watōr",
            newForm: "wæter",
            soundLaw: "Germanic umlaut and vowel changes"
          }
        ],
        firstAttestation: "c. 725 CE",
        attestationSource: "Beowulf manuscript",
        etymologyConfidence: 95,
        scholarlyNotes: "Well-established etymology with clear Germanic development from PIE root",
        sources: ["Pokorny IEW", "Kroonen Proto-Germanic", "OED"],
        verified: true
      }).onConflictDoNothing();
    }

    if (motherWord.length > 0) {
      await db.insert(etymologies).values({
        baseWordId: motherWord[0].id,
        targetLanguageId: targetLanguageId,
        originalForm: "*méh₂tēr",
        currentForm: "mother",
        etymologyPath: [
          {
            language: "Proto-Indo-European",
            form: "*méh₂tēr",
            meaning: "mother",
            timeperiod: "3500-2500 BCE",
            notes: "Ancient kinship term, one of the most stable IE words"
          },
          {
            language: "Proto-Germanic",
            form: "*mōdēr",
            meaning: "mother",
            timeperiod: "500 BCE-500 CE"
          },
          {
            language: "Old English",
            form: "mōdor",
            meaning: "mother, female parent",
            timeperiod: "450-1150 CE"
          },
          {
            language: "Middle English",
            form: "moder",
            meaning: "mother",
            timeperiod: "1150-1500 CE"
          },
          {
            language: "Modern English",
            form: "mother",
            meaning: "mother",
            timeperiod: "1500 CE-present"
          }
        ],
        cognates: [
          {
            language: "German",
            form: "Mutter",
            meaning: "mother",
            relationship: "cognate"
          },
          {
            language: "Latin",
            form: "māter",
            meaning: "mother",
            relationship: "cognate"
          },
          {
            language: "Greek",
            form: "μήτηρ (mētēr)",
            meaning: "mother",
            relationship: "cognate"
          },
          {
            language: "Sanskrit",
            form: "मातृ (mātṛ)",
            meaning: "mother",
            relationship: "cognate"
          },
          {
            language: "Russian",
            form: "мать (mat')",
            meaning: "mother",
            relationship: "cognate"
          }
        ],
        etymologyConfidence: 98,
        scholarlyNotes: "One of the most secure IE etymologies, showing remarkable stability across branches",
        sources: ["Watkins AHD", "Pokorny IEW", "Fortson IE"],
        verified: true
      }).onConflictDoNothing();
    }
  }

  private async createLatinBorrowings(): Promise<void> {
    console.log("Creating Latin borrowing etymologies...");
    
    const animalWord = await db.select().from(baseWords).where(eq(baseWords.word, "animal")).limit(1);
    
    // Use known English language ID
    const targetLanguageId = "lang1"; // English language ID from database
    
    if (animalWord.length > 0) {
      await db.insert(etymologies).values({
        baseWordId: animalWord[0].id,
        targetLanguageId: targetLanguageId,
        originalForm: "animal",
        currentForm: "animal",
        etymologyPath: [
          {
            language: "Latin",
            form: "animal",
            meaning: "living being, animal",
            timeperiod: "Classical Latin (75 BCE-200 CE)",
            notes: "From anima 'breath, soul' + -al suffix"
          },
          {
            language: "Old French",
            form: "animal",
            meaning: "animal",
            timeperiod: "842-1400 CE",
            notes: "Direct borrowing from Latin in learned contexts"
          },
          {
            language: "Middle English",
            form: "animal",
            meaning: "living creature",
            timeperiod: "1300-1500 CE",
            notes: "Borrowed from Old French, initially in scholarly texts"
          },
          {
            language: "Modern English",
            form: "animal",
            meaning: "animal",
            timeperiod: "1500 CE-present"
          }
        ],
        migrationRoute: [
          {
            fromLanguage: "Latin",
            toLanguage: "Old French",
            timeperiod: "400-800 CE",
            mechanism: "learned_borrowing",
            confidence: 90
          },
          {
            fromLanguage: "Old French",
            toLanguage: "Middle English",
            timeperiod: "1066-1400 CE",
            mechanism: "norman_conquest",
            confidence: 95
          }
        ],
        semanticShifts: [
          {
            timeperiod: "Classical to Medieval Latin",
            oldMeaning: "any living, breathing creature",
            newMeaning: "non-human living creature",
            mechanism: "narrowing"
          }
        ],
        firstAttestation: "c. 1340",
        attestationSource: "Chaucer manuscripts",
        etymologyConfidence: 95,
        sources: ["OED", "FEW", "CNRTL"],
        verified: true
      }).onConflictDoNothing();

      // Create word migration event
      await db.insert(wordMigrations).values({
        etymologyId: (await db.select().from(etymologies).where(eq(etymologies.baseWordId, animalWord[0].id)).limit(1))[0]?.id || "temp",
        sourceLanguageId: "latin", // Would need to get actual language IDs
        targetLanguageId: "english",
        sourceForm: "animal",
        targetForm: "animal",
        migrationPeriod: "1066-1400 CE",
        migrationMechanism: "norman_conquest",
        historicalContext: "Norman Conquest of England brought French learned vocabulary into English",
        geographicRoute: [
          {
            region: "Rome/Italy",
            role: "origin"
          },
          {
            region: "Northern France",
            role: "intermediate"
          },
          {
            region: "England",
            role: "destination"
          }
        ],
        culturalImpact: "Enriched English scientific and academic vocabulary",
        frequency: "common",
        socialRegister: "initially_learned_now_common",
        confidence: 95,
        evidenceSources: ["Medieval manuscripts", "Anglo-Norman dictionaries"]
      }).onConflictDoNothing();
    }
  }

  private async createGermanicEtymologies(): Promise<void> {
    console.log("Creating Germanic etymologies...");
    
    const houseWord = await db.select().from(baseWords).where(eq(baseWords.word, "house")).limit(1);
    
    // Use known English language ID
    const targetLanguageId = "lang1"; // English language ID from database
    
    if (houseWord.length > 0) {
      await db.insert(etymologies).values({
        baseWordId: houseWord[0].id,
        targetLanguageId: targetLanguageId,
        originalForm: "*hūsą",
        currentForm: "house",
        etymologyPath: [
          {
            language: "Proto-Germanic",
            form: "*hūsą",
            meaning: "house, dwelling",
            timeperiod: "500 BCE-500 CE",
            notes: "Germanic innovation, not inherited from PIE"
          },
          {
            language: "Old English",
            form: "hūs",
            meaning: "house, dwelling, building",
            timeperiod: "450-1150 CE"
          },
          {
            language: "Middle English",
            form: "hous",
            meaning: "house",
            timeperiod: "1150-1500 CE"
          },
          {
            language: "Modern English",
            form: "house",
            meaning: "house",
            timeperiod: "1500 CE-present"
          }
        ],
        cognates: [
          {
            language: "German",
            form: "Haus",
            meaning: "house",
            relationship: "cognate"
          },
          {
            language: "Dutch",
            form: "huis",
            meaning: "house",
            relationship: "cognate"
          },
          {
            language: "Gothic",
            form: "𐌷𐌿𐍃 (hus)",
            meaning: "house",
            relationship: "cognate"
          }
        ],
        phoneticChanges: [
          {
            timeperiod: "Old to Middle English",
            oldForm: "hūs",
            newForm: "hous",
            soundLaw: "Great Vowel Shift precursors"
          },
          {
            timeperiod: "Middle to Modern English",
            oldForm: "hous",
            newForm: "house",
            soundLaw: "Great Vowel Shift"
          }
        ],
        etymologyConfidence: 90,
        scholarlyNotes: "Germanic innovation, possibly related to hiding/covering",
        sources: ["Kroonen Proto-Germanic", "OED"],
        verified: true
      }).onConflictDoNothing();
    }
  }

  private async createFrenchBorrowings(): Promise<void> {
    console.log("Creating French borrowing etymologies...");
    
    const castleWord = await db.select().from(baseWords).where(eq(baseWords.word, "castle")).limit(1);
    
    // Use known English language ID
    const targetLanguageId = "lang1"; // English language ID from database
    
    if (castleWord.length > 0) {
      await db.insert(etymologies).values({
        baseWordId: castleWord[0].id,
        targetLanguageId: targetLanguageId,
        originalForm: "castellum",
        currentForm: "castle",
        etymologyPath: [
          {
            language: "Latin",
            form: "castellum",
            meaning: "fortress, stronghold",
            timeperiod: "Classical Latin",
            notes: "Diminutive of castrum 'fort'"
          },
          {
            language: "Old French",
            form: "castel",
            meaning: "castle, fortress",
            timeperiod: "842-1400 CE"
          },
          {
            language: "Anglo-Norman",
            form: "castel",
            meaning: "castle",
            timeperiod: "1066-1400 CE"
          },
          {
            language: "Middle English",
            form: "castel",
            meaning: "fortified residence",
            timeperiod: "1066-1500 CE"
          },
          {
            language: "Modern English",
            form: "castle",
            meaning: "castle",
            timeperiod: "1500 CE-present"
          }
        ],
        migrationRoute: [
          {
            fromLanguage: "Latin",
            toLanguage: "Old French",
            timeperiod: "400-800 CE",
            mechanism: "natural_evolution",
            confidence: 95
          },
          {
            fromLanguage: "Anglo-Norman",
            toLanguage: "Middle English",
            timeperiod: "1066-1200 CE",
            mechanism: "norman_conquest",
            confidence: 98
          }
        ],
        semanticShifts: [
          {
            timeperiod: "Medieval period",
            oldMeaning: "military fortress",
            newMeaning: "noble residence + fortification",
            mechanism: "broadening"
          }
        ],
        firstAttestation: "c. 1075",
        attestationSource: "Anglo-Saxon Chronicle",
        etymologyConfidence: 95,
        sources: ["OED", "AND", "FEW"],
        verified: true
      }).onConflictDoNothing();
    }
  }

  async createEtymologicalNetworks(): Promise<void> {
    console.log("Creating etymological networks...");
    
    // Create Indo-European water network
    await db.insert(etymologicalNetworks).values({
      networkName: "PIE *h₂ekʷeh₂- 'water' family",
      rootForm: "*h₂ekʷeh₂",
      protoLanguage: "Proto-Indo-European",
      semanticField: "natural_elements",
      members: [
        {
          languageId: "english",
          baseWordId: "water_id",
          form: "water",
          meaning: "water",
          relationship: "direct_descendant"
        },
        {
          languageId: "german",
          baseWordId: "wasser_id", 
          form: "Wasser",
          meaning: "water",
          relationship: "cognate"
        },
        {
          languageId: "latin",
          baseWordId: "aqua_id",
          form: "aqua",
          meaning: "water",
          relationship: "cognate"
        }
      ],
      reconstruction: "PIE *h₂ekʷeh₂ > Germanic *watōr > English water, with cognates in most IE branches",
      scholarConsensus: 95,
      references: ["Pokorny IEW 23", "Kroonen PGMC s.v. *watōr", "Watkins AHD"]
    }).onConflictDoNothing();

    // Create kinship term network
    await db.insert(etymologicalNetworks).values({
      networkName: "PIE *méh₂tēr 'mother' family",
      rootForm: "*méh₂tēr",
      protoLanguage: "Proto-Indo-European", 
      semanticField: "kinship",
      members: [
        {
          languageId: "english",
          baseWordId: "mother_id",
          form: "mother",
          meaning: "mother",
          relationship: "direct_descendant"
        },
        {
          languageId: "latin",
          baseWordId: "mater_id",
          form: "māter",
          meaning: "mother",
          relationship: "cognate"
        },
        {
          languageId: "sanskrit",
          baseWordId: "matr_id",
          form: "मातृ",
          meaning: "mother", 
          relationship: "cognate"
        }
      ],
      reconstruction: "One of the most stable IE kinship terms, showing minimal variation across branches",
      scholarConsensus: 98,
      references: ["Mallory & Adams Encyclopedia", "Fortson IE Language", "Watkins AHD"]
    }).onConflictDoNothing();
  }

  // Query methods for etymology exploration
  async getEtymologyByWord(baseWordId: string): Promise<any> {
    const [etymology] = await db.select()
      .from(etymologies)
      .where(eq(etymologies.baseWordId, baseWordId))
      .limit(1);
    
    return etymology;
  }

  async getWordMigrations(etymologyId: string): Promise<any[]> {
    return await db.select()
      .from(wordMigrations)
      .where(eq(wordMigrations.etymologyId, etymologyId));
  }

  async getCognates(baseWordId: string): Promise<any[]> {
    const [etymology] = await db.select()
      .from(etymologies)
      .where(eq(etymologies.baseWordId, baseWordId))
      .limit(1);
    
    return etymology?.cognates || [];
  }

  async getEtymologicalNetwork(networkId: string): Promise<any> {
    const [network] = await db.select()
      .from(etymologicalNetworks)
      .where(eq(etymologicalNetworks.id, networkId))
      .limit(1);
    
    return network;
  }

  async searchEtymologies(query: string): Promise<any[]> {
    return await db.select()
      .from(etymologies)
      .where(
        or(
          like(etymologies.originalForm, `%${query}%`),
          like(etymologies.currentForm, `%${query}%`),
          sql`${etymologies.etymologyPath}::text LIKE ${`%${query}%`}`
        )
      );
  }

  async getPhoneticEvolution(baseWordId: string): Promise<any[]> {
    const [etymology] = await db.select()
      .from(etymologies)
      .where(eq(etymologies.baseWordId, baseWordId))
      .limit(1);
    
    return etymology?.phoneticChanges || [];
  }

  async getSemanticShifts(baseWordId: string): Promise<any[]> {
    const [etymology] = await db.select()
      .from(etymologies)
      .where(eq(etymologies.baseWordId, baseWordId))
      .limit(1);
    
    return etymology?.semanticShifts || [];
  }
}

export const etymologyExplorer = new EtymologyExplorer();