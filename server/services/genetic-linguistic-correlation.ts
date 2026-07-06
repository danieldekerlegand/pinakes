/**
 * Genetic-Linguistic Correlation Service
 *
 * Computes correlation scores between haplogroup distributions and language family
 * distributions based on geographic overlap of their associated regions.
 */

import { TsvStorage } from "../tsv-storage";

// Region bounding polygons (approximate lat/lng rectangles for overlap computation)
const REGION_BOUNDS: Record<string, { lat: [number, number]; lng: [number, number] }> = {
  'Africa': { lat: [-35, 37], lng: [-18, 52] },
  'East Africa': { lat: [-12, 12], lng: [28, 52] },
  'West Africa': { lat: [0, 18], lng: [-18, 15] },
  'North Africa': { lat: [20, 37], lng: [-18, 35] },
  'South Africa': { lat: [-35, -15], lng: [15, 40] },
  'Central Africa': { lat: [-10, 10], lng: [8, 32] },
  'Europe': { lat: [35, 72], lng: [-12, 45] },
  'Western Europe': { lat: [36, 60], lng: [-12, 15] },
  'Eastern Europe': { lat: [42, 70], lng: [20, 45] },
  'Northern Europe': { lat: [55, 72], lng: [-12, 30] },
  'Southern Europe': { lat: [35, 48], lng: [-10, 30] },
  'Central Europe': { lat: [45, 55], lng: [5, 25] },
  'Middle East': { lat: [12, 42], lng: [25, 60] },
  'Near East': { lat: [30, 42], lng: [25, 45] },
  'Central Asia': { lat: [35, 55], lng: [50, 90] },
  'South Asia': { lat: [5, 38], lng: [60, 98] },
  'East Asia': { lat: [18, 55], lng: [95, 145] },
  'Southeast Asia': { lat: [-10, 25], lng: [95, 140] },
  'Northeast Asia': { lat: [40, 72], lng: [100, 170] },
  'Siberia': { lat: [50, 78], lng: [60, 180] },
  'Oceania': { lat: [-50, 0], lng: [110, 180] },
  'Americas': { lat: [-55, 72], lng: [-170, -35] },
  'North America': { lat: [15, 72], lng: [-170, -50] },
  'South America': { lat: [-55, 15], lng: [-82, -35] },
  'Arctic': { lat: [65, 90], lng: [-180, 180] },
};

// Known notable divergences between genetics and linguistics
const NOTABLE_DIVERGENCES: {
  haplogroupPattern: string;
  languageFamilyPattern: string;
  annotation: string;
}[] = [
  {
    haplogroupPattern: 'r1b',
    languageFamilyPattern: 'uralic',
    annotation: 'Hungarian: Uralic language but predominantly R1b genetics from surrounding Indo-European populations',
  },
  {
    haplogroupPattern: 'n',
    languageFamilyPattern: 'uralic',
    annotation: 'Finno-Ugric peoples carry high N haplogroup frequencies despite geographic proximity to R1a-dominant Slavic populations',
  },
  {
    haplogroupPattern: 'r1a',
    languageFamilyPattern: 'dravidian',
    annotation: 'R1a present in Dravidian-speaking South India suggests Indo-Aryan genetic admixture without full language replacement',
  },
  {
    haplogroupPattern: 'e1b1b',
    languageFamilyPattern: 'indo-european',
    annotation: 'E1b1b haplogroup found in Greek and Albanian speakers — African-origin haplogroup in Indo-European speakers',
  },
  {
    haplogroupPattern: 'j2',
    languageFamilyPattern: 'turkic',
    annotation: 'Turkish speakers carry high J2 frequencies from Anatolian populations despite Turkic language adoption',
  },
  {
    haplogroupPattern: 'o',
    languageFamilyPattern: 'austronesian',
    annotation: 'Haplogroup O dominant in both Austronesian and Sino-Tibetan speakers — shared genetic ancestry despite linguistic divergence',
  },
];

export interface GeneticLinguisticCorrelation {
  haplogroupId: string;
  haplogroupName: string;
  haplogroupType: string;
  languageFamilyId: string;
  languageFamilyName: string;
  overlapScore: number; // 0-1
  sharedRegions: string[];
  divergence: string | null; // Notable divergence annotation
}

export interface GeneticLinguisticCorrelationResult {
  correlations: GeneticLinguisticCorrelation[];
  divergences: {
    haplogroupName: string;
    languageFamilyName: string;
    annotation: string;
  }[];
  summary: string;
}

function regionOverlap(regionA: string, regionB: string): number {
  const boundsA = findRegionBounds(regionA);
  const boundsB = findRegionBounds(regionB);
  if (!boundsA || !boundsB) return 0;

  const latOverlap = Math.max(0,
    Math.min(boundsA.lat[1], boundsB.lat[1]) - Math.max(boundsA.lat[0], boundsB.lat[0])
  );
  const lngOverlap = Math.max(0,
    Math.min(boundsA.lng[1], boundsB.lng[1]) - Math.max(boundsA.lng[0], boundsB.lng[0])
  );

  if (latOverlap === 0 || lngOverlap === 0) return 0;

  const overlapArea = latOverlap * lngOverlap;
  const areaA = (boundsA.lat[1] - boundsA.lat[0]) * (boundsA.lng[1] - boundsA.lng[0]);
  const areaB = (boundsB.lat[1] - boundsB.lat[0]) * (boundsB.lng[1] - boundsB.lng[0]);
  const unionArea = areaA + areaB - overlapArea;

  return unionArea > 0 ? overlapArea / unionArea : 0;
}

function findRegionBounds(region: string): { lat: [number, number]; lng: [number, number] } | null {
  if (REGION_BOUNDS[region]) return REGION_BOUNDS[region];
  for (const [key, bounds] of Object.entries(REGION_BOUNDS)) {
    if (region.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(region.toLowerCase())) {
      return bounds;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DNA-to-culture ancestry mapping (US-001)
// ---------------------------------------------------------------------------
//
// Given the Y-DNA haplogroup ids a user's raw-DNA export was reduced to *in the
// browser* (only the haplogroup ids — never the raw genotypes — reach the server),
// map them to the cultures, languages, and cuisines their deep paternal ancestry is
// associated with, using `Haplogroup.associatedLanguageFamilyIds` /
// `associatedCivilizationIds`. This is deliberately exploratory: confidence is modest
// and the result always carries clear caveats (see `ANCESTRY_CAVEATS`).

/** Minimal, storage-agnostic data the mapper reads (kept small so it is easy to test). */
export interface AncestryMapperData {
  haplogroups: {
    id: string;
    name: string;
    geographicOrigin: string;
    timeOrigin: number | null;
    associatedLanguageFamilyIds: string[];
    associatedCivilizationIds: string[];
  }[];
  families: { id: string; name: string; region?: string | null }[];
  languages: { id: string; name: string; familyId: string }[];
  civilizations: { id: string; name: string }[];
  cuisines: { id: string; name: string; region: string; associatedLanguageIds: string[] }[];
}

export interface AncestryLanguageResult {
  familyId: string;
  familyName: string;
  region: string | null;
  confidence: number; // 0-1
  sampleLanguages: string[];
  viaHaplogroups: string[]; // haplogroup names supporting this association
}

export interface AncestryCultureResult {
  civilizationId: string;
  name: string;
  confidence: number;
  viaHaplogroups: string[];
}

export interface AncestryCuisineResult {
  cuisineId: string;
  name: string;
  region: string;
  confidence: number;
}

export interface AncestryMappingResult {
  matchedHaplogroups: { id: string; name: string; geographicOrigin: string; timeOrigin: number | null }[];
  unmatchedHaplogroupIds: string[];
  spoke: AncestryLanguageResult[];
  livedAmong: AncestryCultureResult[];
  ate: AncestryCuisineResult[];
  divergences: { haplogroupName: string; languageFamilyName: string; annotation: string }[];
  caveats: string[];
  summary: string;
}

/** Fixed, always-shown caveats — heritage is probabilistic and mostly learned, not genetic. */
export const ANCESTRY_CAVEATS: string[] = [
  "Your raw genetic data was processed entirely in your browser and was never uploaded or stored.",
  "Haplogroups trace only your deep paternal (Y-DNA) line — a single thread of your ancestry, not your whole genome or recent family history.",
  "A shared haplogroup reflects broad population-genetic patterns; it does not mean you descend directly from, or belong to, any of these cultures.",
  "Language, cuisine, and culture are learned and shared, not inherited in DNA — these associations are exploratory prompts for research, not statements about your identity.",
  "Genetics and language often diverge (populations adopt new languages without replacing their genes), so treat every match as a starting point for further reading.",
];

/** Normalize a name/id to a comparable slug ("Italo-Celtic" → "italo-celtic"). */
function normalizeAssocKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Confidence for an association supported by `n` matched haplogroups, from a base. */
function supportConfidence(base: number, n: number, cap: number): number {
  const value = base + 0.1 * Math.max(0, n - 1);
  return Math.round(Math.min(cap, value) * 100) / 100;
}

/**
 * Map a set of inferred haplogroup ids to the languages, cultures, and cuisines their
 * carriers are associated with. Pure over `data` (no storage/clock), so it is unit-tested
 * directly on synthetic fixtures.
 */
export function mapHaplogroupsToAncestry(
  haplogroupIds: string[],
  data: AncestryMapperData,
): AncestryMappingResult {
  const wanted = new Set(haplogroupIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
  const haploById = new Map(data.haplogroups.map((h) => [h.id.toLowerCase(), h]));

  // Haplogroup rows reference families/civilizations by bare name-slug (e.g. "germanic",
  // "celts"), whereas the corpus keys them by namespaced id (e.g. `indo_european__germanic`).
  // Resolve by exact id first, then by a normalized-name fallback so the real data maps.
  const familyById = new Map(data.families.map((f) => [f.id, f]));
  const familyByName = new Map<string, AncestryMapperData["families"][number]>();
  for (const f of data.families) {
    const key = normalizeAssocKey(f.name);
    if (key && !familyByName.has(key)) familyByName.set(key, f);
  }
  const civById = new Map(data.civilizations.map((c) => [c.id, c]));
  const civByName = new Map<string, AncestryMapperData["civilizations"][number]>();
  for (const c of data.civilizations) {
    const key = normalizeAssocKey(c.name);
    if (key && !civByName.has(key)) civByName.set(key, c);
  }
  const resolveFamily = (raw: string) => familyById.get(raw) ?? familyByName.get(normalizeAssocKey(raw)) ?? null;
  const resolveCiv = (raw: string) => civById.get(raw) ?? civByName.get(normalizeAssocKey(raw)) ?? null;

  const matched = Array.from(wanted)
    .map((id) => haploById.get(id))
    .filter((h): h is AncestryMapperData["haplogroups"][number] => Boolean(h));
  const matchedIds = new Set(matched.map((h) => h.id.toLowerCase()));
  const unmatchedHaplogroupIds = Array.from(wanted).filter((id) => !matchedIds.has(id));

  // Aggregate language families → supporting haplogroups (keyed by resolved corpus id).
  const familySupport = new Map<string, Set<string>>(); // familyId → haplogroup names
  const resolvedFamilyById = new Map<string, AncestryMapperData["families"][number]>();
  const civSupport = new Map<string, Set<string>>();
  const resolvedCivById = new Map<string, AncestryMapperData["civilizations"][number]>();
  for (const h of matched) {
    for (const rawFid of h.associatedLanguageFamilyIds) {
      const family = resolveFamily(rawFid);
      if (!family) continue;
      resolvedFamilyById.set(family.id, family);
      (familySupport.get(family.id) ?? familySupport.set(family.id, new Set()).get(family.id)!).add(h.name);
    }
    for (const rawCid of h.associatedCivilizationIds) {
      const civ = resolveCiv(rawCid);
      if (!civ) continue;
      resolvedCivById.set(civ.id, civ);
      (civSupport.get(civ.id) ?? civSupport.set(civ.id, new Set()).get(civ.id)!).add(h.name);
    }
  }

  // Languages grouped by family for the "spoke" sample list.
  const languagesByFamily = new Map<string, string[]>();
  for (const lang of data.languages) {
    const list = languagesByFamily.get(lang.familyId) ?? languagesByFamily.set(lang.familyId, []).get(lang.familyId)!;
    if (list.length < 5) list.push(lang.name);
  }

  const spoke: AncestryLanguageResult[] = Array.from(familySupport.entries()).map(([fid, support]) => {
    const family = resolvedFamilyById.get(fid)!;
    return {
      familyId: fid,
      familyName: family.name,
      region: family.region ?? null,
      confidence: supportConfidence(0.4, support.size, 0.85),
      sampleLanguages: languagesByFamily.get(fid) ?? [],
      viaHaplogroups: Array.from(support).sort(),
    };
  });
  spoke.sort((a, b) => b.confidence - a.confidence || a.familyName.localeCompare(b.familyName));

  const livedAmong: AncestryCultureResult[] = Array.from(civSupport.entries()).map(([cid, support]) => ({
    civilizationId: cid,
    name: resolvedCivById.get(cid)!.name,
    confidence: supportConfidence(0.4, support.size, 0.85),
    viaHaplogroups: Array.from(support).sort(),
  }));
  livedAmong.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  // Cuisine ("ate") is an *indirect* chain: family → its languages → cuisines that cite
  // those languages, so its confidence is capped lower than the direct associations.
  const familyLanguageIds = new Set<string>();
  const supportedFamilyIds = Array.from(familySupport.keys());
  for (const fid of supportedFamilyIds) {
    for (const lang of data.languages) {
      if (lang.familyId === fid) familyLanguageIds.add(lang.id);
    }
  }
  const ate: AncestryCuisineResult[] = [];
  for (const cuisine of data.cuisines) {
    const overlap = cuisine.associatedLanguageIds.filter((id) => familyLanguageIds.has(id));
    if (overlap.length === 0) continue;
    ate.push({
      cuisineId: cuisine.id,
      name: cuisine.name,
      region: cuisine.region,
      confidence: supportConfidence(0.3, overlap.length, 0.65),
    });
  }
  ate.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  // Notable genetics ↔ language divergences relevant to the matched haplogroups.
  const divergences: { haplogroupName: string; languageFamilyName: string; annotation: string }[] = [];
  for (const h of matched) {
    for (const div of NOTABLE_DIVERGENCES) {
      if (!h.id.toLowerCase().includes(div.haplogroupPattern)) continue;
      const family = data.families.find(
        (f) =>
          f.id.toLowerCase().includes(div.languageFamilyPattern) ||
          normalizeAssocKey(f.name).includes(div.languageFamilyPattern),
      );
      if (!family) continue;
      if (divergences.some((d) => d.haplogroupName === h.name && d.languageFamilyName === family.name)) continue;
      divergences.push({ haplogroupName: h.name, languageFamilyName: family.name, annotation: div.annotation });
    }
  }

  const summary =
    matched.length === 0
      ? "None of the supplied haplogroups matched the reference dataset, so no cultural associations could be drawn."
      : `Your ${matched.length === 1 ? "haplogroup is" : "haplogroups are"} associated with ${spoke.length} language ${spoke.length === 1 ? "family" : "families"}, ${livedAmong.length} historical ${livedAmong.length === 1 ? "culture" : "cultures"}, and ${ate.length} ${ate.length === 1 ? "cuisine" : "cuisines"}. These are exploratory associations — see the caveats.`;

  return {
    matchedHaplogroups: matched.map((h) => ({
      id: h.id,
      name: h.name,
      geographicOrigin: h.geographicOrigin,
      timeOrigin: h.timeOrigin,
    })),
    unmatchedHaplogroupIds,
    spoke,
    livedAmong,
    ate,
    divergences,
    caveats: ANCESTRY_CAVEATS,
    summary,
  };
}

export class GeneticLinguisticCorrelationService {
  constructor(private storage: TsvStorage) {}

  async computeCorrelations(haplogroupType?: string): Promise<GeneticLinguisticCorrelationResult> {
    let haplogroups = await this.storage.getHaplogroups();
    const families = await this.storage.getLanguageFamilies();

    // Filter by haplogroup type if specified
    if (haplogroupType) {
      haplogroups = haplogroups.filter(h =>
        h.haplogroupType.toLowerCase().replace('-', '') === haplogroupType.toLowerCase().replace('-', '')
      );
    }

    // Only use haplogroups that have associated language families
    const haploWithFamilies = haplogroups.filter(h => h.associatedLanguageFamilyIds.length > 0);

    // Build family ID → family map
    const familyMap = new Map(families.map(f => [f.id, f]));

    const correlations: GeneticLinguisticCorrelation[] = [];
    const seenDivergences: {
      haplogroupName: string;
      languageFamilyName: string;
      annotation: string;
    }[] = [];

    for (const haplo of haploWithFamilies) {
      for (const familyId of haplo.associatedLanguageFamilyIds) {
        const family = familyMap.get(familyId);
        if (!family) continue;

        // Compute geographic overlap score
        const hapRegion = haplo.geographicOrigin;
        const famRegion = family.region || '';
        let overlapScore = 0;
        const sharedRegions: string[] = [];

        if (hapRegion && famRegion) {
          // Check direct region overlap
          overlapScore = regionOverlap(hapRegion, famRegion);

          // If explicit association exists in data, boost the score
          if (overlapScore > 0) {
            sharedRegions.push(`${hapRegion} / ${famRegion}`);
          }
          // Even if regions don't overlap geographically, the explicit association in data
          // means there's a real correlation — give minimum score
          if (overlapScore === 0) {
            overlapScore = 0.3; // baseline for data-associated pairs
            sharedRegions.push(`${hapRegion} (associated)`);
          }
        } else {
          overlapScore = 0.2;
          sharedRegions.push('Association in data');
        }

        // Check for known divergences
        let divergence: string | null = null;
        for (const div of NOTABLE_DIVERGENCES) {
          if (
            haplo.id.toLowerCase().includes(div.haplogroupPattern) &&
            familyId.toLowerCase().includes(div.languageFamilyPattern)
          ) {
            divergence = div.annotation;
            seenDivergences.push({
              haplogroupName: haplo.name,
              languageFamilyName: family.name,
              annotation: div.annotation,
            });
          }
        }

        correlations.push({
          haplogroupId: haplo.id,
          haplogroupName: haplo.name,
          haplogroupType: haplo.haplogroupType,
          languageFamilyId: familyId,
          languageFamilyName: family.name,
          overlapScore: Math.round(overlapScore * 100) / 100,
          sharedRegions,
          divergence,
        });
      }
    }

    // Sort by overlap score descending
    correlations.sort((a, b) => b.overlapScore - a.overlapScore);

    // Also check for divergences involving haplogroups NOT associated with a family
    for (const haplo of haplogroups) {
      for (const div of NOTABLE_DIVERGENCES) {
        if (haplo.id.toLowerCase().includes(div.haplogroupPattern)) {
          // Check if this divergence is about a family NOT in associatedLanguageFamilyIds
          const matchingFamilyId = Array.from(familyMap.keys()).find(
            fid => fid.toLowerCase().includes(div.languageFamilyPattern)
          );
          if (matchingFamilyId && !haplo.associatedLanguageFamilyIds.includes(matchingFamilyId)) {
            const family = familyMap.get(matchingFamilyId);
            if (family && !seenDivergences.some(d =>
              d.haplogroupName === haplo.name && d.languageFamilyName === family.name
            )) {
              seenDivergences.push({
                haplogroupName: haplo.name,
                languageFamilyName: family.name,
                annotation: div.annotation,
              });
            }
          }
        }
      }
    }

    return {
      correlations,
      divergences: seenDivergences,
      summary: `Found ${correlations.length} genetic-linguistic correlations across ${haploWithFamilies.length} haplogroups and ${new Set(correlations.map(c => c.languageFamilyId)).size} language families. ${seenDivergences.length} notable divergences identified.`,
    };
  }
}
