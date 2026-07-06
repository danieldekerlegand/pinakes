/**
 * Y-chromosome haplogroup inference (US-001).
 *
 * Given the SNP calls parsed from a raw-DNA export, assign a **Y-DNA haplogroup** by
 * walking a simplified ISOGG-style phylogenetic tree of defining markers. The corpus
 * (`lexicons/haplogroups.tsv`) is Y-chromosome only, so this focuses on the paternal
 * line; a sample with no Y calls (e.g. a female profile, or a chip without Y coverage)
 * yields `hasYData: false` and the UI explains why.
 *
 * This is deliberately an **educational approximation**, not a clinical caller: real
 * haplogroup assignment weighs thousands of hierarchical SNPs. Here each haplogroup has
 * one defining marker (an rsid + its derived allele) and a parent, from which we derive
 * the lineage path. We pick the **most specific** haplogroup whose own defining marker is
 * derived in the sample, and score confidence by how much of its ancestral path is also
 * confirmed derived. The `haplogroupId`s match the corpus so the server can map them to
 * languages/cultures. All caveats about this being probabilistic live in the UI.
 */

import type { ParsedDna } from "./dna-parser";

interface YMarker {
  /** Corpus haplogroup id (matches `lexicons/haplogroups.tsv`). */
  id: string;
  /** Human label. */
  label: string;
  /** ISOGG mutation name (documentation only). */
  marker: string;
  /** dbSNP identifier of the defining SNP. */
  rsid: string;
  /** Derived allele — its presence in the call marks this branch. */
  derived: string;
  /** Parent haplogroup id in the (simplified) tree, or null at the root. */
  parent: string | null;
}

/**
 * Simplified Y-DNA phylogeny mapped onto corpus haplogroup ids. Ordered roughly
 * root → tips; `parent` links define the lineage path used for confidence scoring.
 * rsids are the dbSNP ids for each ISOGG marker where known; the tree is intentionally
 * coarse. Kept internally consistent so a call at a tip implies its ancestors.
 */
const Y_MARKERS: YMarker[] = [
  { id: "a", label: "A", marker: "M91", rsid: "rs2032597", derived: "T", parent: null },
  { id: "b", label: "B", marker: "M60", rsid: "rs13447352", derived: "A", parent: null },
  { id: "ct", label: "CT", marker: "M168", rsid: "rs2032658", derived: "T", parent: null },
  { id: "c", label: "C", marker: "M130", rsid: "rs35284970", derived: "T", parent: "ct" },
  { id: "c2", label: "C2", marker: "M217", rsid: "rs2032668", derived: "A", parent: "c" },
  { id: "d", label: "D", marker: "M174", rsid: "rs2032602", derived: "C", parent: "ct" },
  { id: "e", label: "E", marker: "M96", rsid: "rs9306841", derived: "C", parent: "ct" },
  { id: "f", label: "F", marker: "M89", rsid: "rs2032652", derived: "T", parent: "ct" },
  { id: "g", label: "G", marker: "M201", rsid: "rs2032636", derived: "T", parent: "f" },
  { id: "g2", label: "G2", marker: "P287", rsid: "rs9786139", derived: "C", parent: "g" },
  { id: "g2a", label: "G2A", marker: "P15", rsid: "rs9786599", derived: "A", parent: "g2" },
  { id: "h", label: "H", marker: "M69", rsid: "rs2033003", derived: "C", parent: "f" },
  { id: "i", label: "I", marker: "M170", rsid: "rs2032604", derived: "A", parent: "f" },
  { id: "i1", label: "I1", marker: "M253", rsid: "rs17222573", derived: "A", parent: "i" },
  { id: "i2", label: "I2", marker: "P215", rsid: "rs17307677", derived: "C", parent: "i" },
  { id: "j", label: "J", marker: "M304", rsid: "rs13447354", derived: "C", parent: "f" },
  { id: "j1", label: "J1", marker: "M267", rsid: "rs9341296", derived: "T", parent: "j" },
  { id: "j2", label: "J2", marker: "M172", rsid: "rs2032605", derived: "G", parent: "j" },
  { id: "k", label: "K", marker: "M9", rsid: "rs3900", derived: "C", parent: "f" },
  { id: "l", label: "L", marker: "M20", rsid: "rs3911", derived: "T", parent: "k" },
  { id: "t", label: "T", marker: "M184", rsid: "rs9786714", derived: "C", parent: "k" },
  { id: "m", label: "M", marker: "P256", rsid: "rs17842387", derived: "C", parent: "k" },
  { id: "s", label: "S", marker: "M230", rsid: "rs17250121", derived: "A", parent: "k" },
  { id: "n", label: "N", marker: "M231", rsid: "rs9341278", derived: "A", parent: "k" },
  { id: "o", label: "O", marker: "M175", rsid: "rs3852672", derived: "C", parent: "k" },
  { id: "o1", label: "O1", marker: "M119", rsid: "rs2032678", derived: "C", parent: "o" },
  { id: "o2", label: "O2", marker: "M95", rsid: "rs2032680", derived: "T", parent: "o" },
  { id: "o3", label: "O3", marker: "M122", rsid: "rs2032684", derived: "C", parent: "o" },
  { id: "p", label: "P", marker: "M45", rsid: "rs2032631", derived: "A", parent: "k" },
  { id: "q", label: "Q", marker: "M242", rsid: "rs8179021", derived: "T", parent: "p" },
  { id: "r", label: "R", marker: "M207", rsid: "rs2032658b", derived: "G", parent: "p" },
  { id: "r1a", label: "R1a", marker: "M17", rsid: "rs3908", derived: "G", parent: "r" },
  { id: "r1b", label: "R1b", marker: "M269", rsid: "rs9786153", derived: "C", parent: "r" },
  { id: "r2", label: "R2", marker: "M124", rsid: "rs3915", derived: "A", parent: "r" },
];

const MARKER_BY_ID = new Map(Y_MARKERS.map((m) => [m.id, m]));

/** Ordered lineage path from a haplogroup up to (and including) the root. */
function lineagePath(id: string): YMarker[] {
  const path: YMarker[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const marker = MARKER_BY_ID.get(current);
    if (!marker) break;
    path.push(marker);
    current = marker.parent;
  }
  return path;
}

/** A marker is "derived" when the sample's genotype at its rsid contains the derived allele. */
function isDerived(parsed: ParsedDna, marker: YMarker): boolean {
  const snp = parsed.byRsid.get(marker.rsid);
  if (!snp || !snp.genotype) return false;
  // Only trust Y-chromosome calls for Y markers (guards against rsid collisions).
  if (snp.chromosome && snp.chromosome !== "Y") return false;
  return snp.genotype.toUpperCase().includes(marker.derived);
}

export interface InferredHaplogroup {
  /** Corpus haplogroup id (e.g. "r1b"). */
  haplogroupId: string;
  label: string;
  /** 0..1 — proportion of the lineage path confirmed derived; deeper = more certain. */
  confidence: number;
  /** ISOGG marker names on the path confirmed derived, tip-first (evidence trail). */
  derivedMarkers: string[];
}

export interface HaplogroupInference {
  yHaplogroup: InferredHaplogroup | null;
  hasYData: boolean;
  markersTested: number;
  markersDerived: number;
}

/**
 * Infer the most specific Y-DNA haplogroup supported by the sample. Returns `null`
 * for `yHaplogroup` when there is no Y-chromosome data, or when no defining marker is
 * derived (an unassignable sample), so callers can message that honestly.
 */
export function inferHaplogroups(parsed: ParsedDna): HaplogroupInference {
  const hasYData = parsed.counts.yChromosome > 0;

  let derivedCount = 0;
  const derivedIds = new Set<string>();
  for (const marker of Y_MARKERS) {
    if (isDerived(parsed, marker)) {
      derivedCount += 1;
      derivedIds.add(marker.id);
    }
  }

  // Most specific = longest lineage path among haplogroups whose own marker is derived.
  let best: InferredHaplogroup | null = null;
  let bestDepth = -1;
  for (const marker of Y_MARKERS) {
    if (!derivedIds.has(marker.id)) continue;
    const path = lineagePath(marker.id);
    const derivedOnPath = path.filter((p) => derivedIds.has(p.id));
    const confidence = path.length > 0 ? derivedOnPath.length / path.length : 0;
    if (path.length > bestDepth) {
      bestDepth = path.length;
      best = {
        haplogroupId: marker.id,
        label: marker.label,
        confidence: Math.round(confidence * 100) / 100,
        derivedMarkers: derivedOnPath.map((p) => p.marker),
      };
    }
  }

  return {
    yHaplogroup: best,
    hasYData,
    markersTested: Y_MARKERS.length,
    markersDerived: derivedCount,
  };
}

/** Exposed for tests / documentation: the defining rsid of a corpus haplogroup. */
export function definingRsid(haplogroupId: string): string | null {
  return MARKER_BY_ID.get(haplogroupId)?.rsid ?? null;
}
