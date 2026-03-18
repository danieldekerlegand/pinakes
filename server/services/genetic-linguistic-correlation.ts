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
