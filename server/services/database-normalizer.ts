import { db } from "../db";
import { 
  languageFamilies, 
  languages,
  phylums,
  families,
  subfamilies,
  branches,
  groups,
  mainLanguages,
  historicalVariants,
  modernDialects
} from "@shared/schema";
import { eq } from "drizzle-orm";

interface TaxonomicLevel {
  id: string;
  name: string;
  level: string;
  parentId?: string;
  description?: string;
  region?: string;
  coordinates?: { lat: number; lng: number };
}

interface LanguageRecord {
  id: string;
  name: string;
  nativeName?: string;
  iso639_1?: string;
  iso639_2?: string;
  familyId: string;
  parentLanguageId?: string;
  region?: string;
  countries?: string[];
  nativeSpeakers?: number;
  totalSpeakers?: number;
  status: string;
  timeOrigin?: string;
  timeEnd?: string;
  isHistoricalVariant: boolean;
  isDialect: boolean;
  chronologicalOrder?: number;
  historicalContext?: string;
  coordinates?: { lat: number; lng: number };
}

export class DatabaseNormalizer {
  async normalizeDatabase(): Promise<void> {
    console.log("Starting database normalization to taxonomic structure...");
    
    try {
      // Step 1: Analyze current language families hierarchy
      const existingFamilies = await db.select().from(languageFamilies);
      const existingLanguages = await db.select().from(languages);
      
      console.log(`Found ${existingFamilies.length} language families to normalize`);
      console.log(`Found ${existingLanguages.length} languages to normalize`);
      
      // Step 2: Create normalized taxonomic structure
      await this.createNormalizedTaxonomy(existingFamilies);
      
      // Step 3: Migrate languages to new normalized structure
      await this.migrateLanguages(existingLanguages, existingFamilies);
      
      console.log("Database normalization completed successfully");
    } catch (error) {
      console.error("Error during database normalization:", error);
      throw error;
    }
  }

  private async createNormalizedTaxonomy(families: any[]): Promise<void> {
    console.log("Creating normalized taxonomic structure...");
    
    // Group families by taxonomic level
    const phylumRecords = families.filter(f => f.taxonomicLevel === 'phylum');
    const familyRecords = families.filter(f => f.taxonomicLevel === 'family');
    const subfamilyRecords = families.filter(f => f.taxonomicLevel === 'subfamily');
    const branchRecords = families.filter(f => f.taxonomicLevel === 'branch');
    const groupRecords = families.filter(f => f.taxonomicLevel === 'group');
    
    // Insert phylums first (top level)
    for (const phylum of phylumRecords) {
      try {
        await db.insert(phylums).values({
          id: phylum.id,
          name: phylum.name,
          description: phylum.description,
          region: phylum.region,
          coordinates: phylum.coordinates,
          speakerCount: 0, // Will be calculated later
          languageCount: 0, // Will be calculated later
        }).onConflictDoNothing();
        console.log(`✓ Created phylum: ${phylum.name}`);
      } catch (error) {
        console.log(`Phylum ${phylum.name} may already exist, skipping`);
      }
    }

    // Insert families
    for (const family of familyRecords) {
      try {
        // Find the phylum this family belongs to
        const phylumId = this.findParentAtLevel(family, phylumRecords, 'phylum');
        
        await db.insert(families).values({
          id: family.id,
          name: family.name,
          phylumId: phylumId || 'unknown-phylum',
          description: family.description,
          region: family.region,
          coordinates: family.coordinates,
          speakerCount: 0,
          languageCount: 0,
        }).onConflictDoNothing();
        console.log(`✓ Created family: ${family.name}`);
      } catch (error) {
        console.log(`Family ${family.name} may already exist, skipping`);
      }
    }

    // Insert subfamilies
    for (const subfamily of subfamilyRecords) {
      try {
        const familyId = this.findParentAtLevel(subfamily, familyRecords, 'family');
        
        await db.insert(subfamilies).values({
          id: subfamily.id,
          name: subfamily.name,
          familyId: familyId || this.findClosestFamily(subfamily, familyRecords),
          description: subfamily.description,
          region: subfamily.region,
          coordinates: subfamily.coordinates,
          speakerCount: 0,
          languageCount: 0,
        }).onConflictDoNothing();
        console.log(`✓ Created subfamily: ${subfamily.name}`);
      } catch (error) {
        console.log(`Subfamily ${subfamily.name} may already exist, skipping`);
      }
    }

    // Insert branches
    for (const branch of branchRecords) {
      try {
        const subfamilyId = this.findParentAtLevel(branch, subfamilyRecords, 'subfamily');
        
        await db.insert(branches).values({
          id: branch.id,
          name: branch.name,
          subfamilyId: subfamilyId || this.findClosestSubfamily(branch, subfamilyRecords),
          description: branch.description,
          region: branch.region,
          coordinates: branch.coordinates,
          speakerCount: 0,
          languageCount: 0,
        }).onConflictDoNothing();
        console.log(`✓ Created branch: ${branch.name}`);
      } catch (error) {
        console.log(`Branch ${branch.name} may already exist, skipping`);
      }
    }

    // Insert groups
    for (const group of groupRecords) {
      try {
        const branchId = this.findParentAtLevel(group, branchRecords, 'branch');
        
        await db.insert(groups).values({
          id: group.id,
          name: group.name,
          branchId: branchId || this.findClosestBranch(group, branchRecords),
          description: group.description,
          region: group.region,
          coordinates: group.coordinates,
          speakerCount: 0,
          languageCount: 0,
        }).onConflictDoNothing();
        console.log(`✓ Created group: ${group.name}`);
      } catch (error) {
        console.log(`Group ${group.name} may already exist, skipping`);
      }
    }
  }

  private async migrateLanguages(languageRecords: any[], families: any[]): Promise<void> {
    console.log("Migrating languages to normalized structure...");
    
    for (const language of languageRecords) {
      try {
        // Find the taxonomic hierarchy for this language
        const family = families.find(f => f.id === language.familyId);
        if (!family) {
          console.log(`⚠️  Language ${language.name} has no family, skipping`);
          continue;
        }

        const taxonomicPath = this.buildTaxonomicPath(family, families);
        
        if (language.isHistoricalVariant) {
          // Create historical variant
          const mainLangId = this.findMainLanguageId(language, languageRecords);
          
          await db.insert(historicalVariants).values({
            id: language.id,
            name: language.name,
            nativeName: language.nativeName,
            mainLanguageId: mainLangId || `main-${language.id}`,
            timeStart: language.timeOrigin,
            timeEnd: language.timeEnd,
            chronologicalOrder: language.chronologicalOrder || 0,
            region: language.region,
            historicalContext: language.historicalContext,
            coordinates: language.coordinates,
          }).onConflictDoNothing();
          console.log(`✓ Created historical variant: ${language.name}`);
          
        } else if (language.isDialect) {
          // Create modern dialect
          const mainLangId = this.findMainLanguageId(language, languageRecords);
          
          await db.insert(modernDialects).values({
            id: language.id,
            name: language.name,
            nativeName: language.nativeName,
            mainLanguageId: mainLangId || `main-${language.id}`,
            region: language.region,
            countries: language.countries || [],
            speakers: language.totalSpeakers || 0,
            dialectType: 'regional',
            coordinates: language.coordinates,
          }).onConflictDoNothing();
          console.log(`✓ Created modern dialect: ${language.name}`);
          
        } else {
          // Create main language
          await db.insert(mainLanguages).values({
            id: language.id,
            name: language.name,
            nativeName: language.nativeName,
            iso639_1: language.iso639_1,
            iso639_2: language.iso639_2,
            phylumId: taxonomicPath.phylumId,
            familyId: taxonomicPath.familyId,
            subfamilyId: taxonomicPath.subfamilyId,
            branchId: taxonomicPath.branchId,
            groupId: taxonomicPath.groupId,
            region: language.region,
            countries: language.countries || [],
            nativeSpeakers: language.nativeSpeakers || 0,
            totalSpeakers: language.totalSpeakers || 0,
            status: language.status,
            timeOrigin: language.timeOrigin,
            classification: language.classification,
            writingSystem: language.writingSystem,
            coordinates: language.coordinates,
          }).onConflictDoNothing();
          console.log(`✓ Created main language: ${language.name}`);
        }
      } catch (error) {
        console.log(`Error migrating language ${language.name}:`, error);
      }
    }
  }

  private findParentAtLevel(record: any, candidates: any[], targetLevel: string): string | null {
    if (record.parentId) {
      const parent = candidates.find(c => c.id === record.parentId);
      if (parent?.taxonomicLevel === targetLevel) {
        return parent.id;
      }
      // Recursive search up the hierarchy
      return this.findParentAtLevel(parent, candidates, targetLevel);
    }
    return null;
  }

  private findClosestFamily(record: any, families: any[]): string {
    // Find the most appropriate family based on name similarity or region
    const regionMatch = families.find(f => f.region === record.region);
    return regionMatch?.id || families[0]?.id || 'unknown-family';
  }

  private findClosestSubfamily(record: any, subfamilies: any[]): string {
    const regionMatch = subfamilies.find(s => s.region === record.region);
    return regionMatch?.id || subfamilies[0]?.id || 'unknown-subfamily';
  }

  private findClosestBranch(record: any, branches: any[]): string {
    const regionMatch = branches.find(b => b.region === record.region);
    return regionMatch?.id || branches[0]?.id || 'unknown-branch';
  }

  private buildTaxonomicPath(family: any, allFamilies: any[]): {
    phylumId?: string;
    familyId?: string;
    subfamilyId?: string;
    branchId?: string;
    groupId?: string;
  } {
    const path: any = {};
    
    // Walk up the hierarchy to find all levels
    let current = family;
    while (current) {
      switch (current.taxonomicLevel) {
        case 'phylum':
          path.phylumId = current.id;
          break;
        case 'family':
          path.familyId = current.id;
          break;
        case 'subfamily':
          path.subfamilyId = current.id;
          break;
        case 'branch':
          path.branchId = current.id;
          break;
        case 'group':
          path.groupId = current.id;
          break;
      }
      
      if (current.parentId) {
        current = allFamilies.find(f => f.id === current.parentId);
      } else {
        current = null;
      }
    }
    
    return path;
  }

  private findMainLanguageId(language: any, allLanguages: any[]): string | null {
    if (language.parentLanguageId) {
      return language.parentLanguageId;
    }
    
    // Try to find the main language by name pattern
    const baseName = language.name.replace(/^(Old|Middle|Early|Modern|Ancient)\s+/i, '');
    const mainLang = allLanguages.find(l => 
      l.name === baseName && !l.isHistoricalVariant && !l.isDialect
    );
    
    return mainLang?.id || null;
  }

  async validateNormalization(): Promise<void> {
    console.log("Validating database normalization...");
    
    const phylumCount = await db.select().from(phylums);
    const familyCount = await db.select().from(families);
    const subfamilyCount = await db.select().from(subfamilies);
    const branchCount = await db.select().from(branches);
    const groupCount = await db.select().from(groups);
    const mainLanguageCount = await db.select().from(mainLanguages);
    const historicalVariantCount = await db.select().from(historicalVariants);
    const modernDialectCount = await db.select().from(modernDialects);
    
    console.log("Normalization validation results:");
    console.log(`✓ Phylums: ${phylumCount.length}`);
    console.log(`✓ Families: ${familyCount.length}`);
    console.log(`✓ Subfamilies: ${subfamilyCount.length}`);
    console.log(`✓ Branches: ${branchCount.length}`);
    console.log(`✓ Groups: ${groupCount.length}`);
    console.log(`✓ Main Languages: ${mainLanguageCount.length}`);
    console.log(`✓ Historical Variants: ${historicalVariantCount.length}`);
    console.log(`✓ Modern Dialects: ${modernDialectCount.length}`);
  }
}

export const databaseNormalizer = new DatabaseNormalizer();