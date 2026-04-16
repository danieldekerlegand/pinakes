export interface SocialStructure {
  id: string;
  cultureProfileId: string;
  structureType: string;
  name: string;
  description: string;
  keyRoles: string[];
  inheritancePattern: string;
  decisionMaking: string;
  relatedKinshipSystemId: string;
  timePeriodStart: string;
  timePeriodEnd: string;
  sources: string;
}

export interface HierarchyTier {
  id: string;
  label: string;
  description: string;
  color: string;
  roles: string[];
  /** Approximate population percentage (0-100) */
  populationPercent: number;
  /** Index in hierarchy, 0 = top */
  rank: number;
  /** Social class key used for cross-filtering daily-life entries */
  classKey: string;
}

export interface NetworkNodeData {
  id: string;
  label: string;
  category: string;
  color: string;
  rank: number;
}

export interface NetworkEdgeData {
  source: string;
  target: string;
  type: "patronage" | "authority";
}

export type VisualizationMode = "pyramid" | "circles" | "org-chart" | "network";

const CLASS_COLORS: Record<string, string> = {
  ruler: "#7c2d12",
  noble: "#b91c1c",
  priest: "#9333ea",
  warrior: "#dc2626",
  official: "#2563eb",
  merchant: "#d97706",
  artisan: "#ea580c",
  farmer: "#16a34a",
  commoner: "#65a30d",
  peasant: "#84cc16",
  serf: "#a16207",
  slave: "#6b7280",
  freedman: "#0891b2",
  foreigner: "#0284c7",
};

const ROLE_CLASS_MAP: Array<{ pattern: RegExp; classKey: string; label: string }> = [
  { pattern: /emperor|pharaoh|king|queen|sultan|caliph|shogun|tsar|caesar|chief|ruler/i, classKey: "ruler", label: "Ruler" },
  { pattern: /prince|princess|duke|noble|aristocrat|patrician|daimyo|boyar|satrap|mandarin|consul|senator|vizier/i, classKey: "noble", label: "Nobility" },
  { pattern: /priest|bishop|pontifex|brahmin|shaman|druid|monk|rabbi|imam|vestal|oracle|hiereus|flamen/i, classKey: "priest", label: "Priesthood" },
  { pattern: /soldier|warrior|legionary|samurai|knight|hoplite|cavalry|general|centurion|legatus|legate|tribune|polemarch|lochagos/i, classKey: "warrior", label: "Warriors" },
  { pattern: /scribe|bureaucrat|official|magistrate|praetor|prefect|archon|censor|quaestor|aedile|governor|advocate|judge|logograph|dikastes|iudex|grammaticus|rhetor/i, classKey: "official", label: "Officials & Scribes" },
  { pattern: /merchant|trader|banker|moneylender/i, classKey: "merchant", label: "Merchants" },
  { pattern: /artisan|craftsman|smith|potter|weaver|stonemason|guild/i, classKey: "artisan", label: "Artisans" },
  { pattern: /farmer|peasant|plebeian|zeugitai|thetes|helot/i, classKey: "farmer", label: "Farmers & Commoners" },
  { pattern: /slave|serf|bondsman|mothax|perioikos/i, classKey: "slave", label: "Enslaved & Bonded" },
  { pattern: /freedman|metic|foreigner|barbarian/i, classKey: "freedman", label: "Freedmen & Foreigners" },
];

export function classifyRole(role: string): { classKey: string; label: string } {
  for (const { pattern, classKey, label } of ROLE_CLASS_MAP) {
    if (pattern.test(role)) return { classKey, label };
  }
  return { classKey: "commoner", label: "Other Roles" };
}

export function getClassColor(classKey: string): string {
  return CLASS_COLORS[classKey] || "#6b7280";
}

/**
 * Ordered ranks for pyramid/circles display: top of hierarchy first.
 */
const CLASS_RANK_ORDER: string[] = [
  "ruler",
  "noble",
  "priest",
  "official",
  "warrior",
  "merchant",
  "artisan",
  "farmer",
  "commoner",
  "freedman",
  "slave",
];

/**
 * Approximate demographic share for each class in a stratified pre-industrial society.
 * Values sum to 100 when all classes are present, but are normalized otherwise.
 */
const CLASS_POPULATION_WEIGHT: Record<string, number> = {
  ruler: 0.1,
  noble: 2,
  priest: 3,
  official: 5,
  warrior: 10,
  merchant: 8,
  artisan: 12,
  farmer: 45,
  commoner: 10,
  freedman: 2,
  slave: 15,
};

export function getPopulationPercent(classKey: string, presentClasses: string[]): number {
  const weight = CLASS_POPULATION_WEIGHT[classKey] ?? 1;
  const total = presentClasses.reduce((sum, k) => sum + (CLASS_POPULATION_WEIGHT[k] ?? 1), 0);
  if (total === 0) return 0;
  return Math.round((weight / total) * 1000) / 10;
}

/**
 * Aggregate all class-hierarchy / government structures into pyramid tiers.
 * Groups roles by inferred social class and orders them top-down.
 */
export function buildHierarchyTiers(structures: SocialStructure[]): HierarchyTier[] {
  const relevant = structures.filter((s) =>
    ["class_hierarchy", "government", "military_organization", "religious_hierarchy"].includes(s.structureType)
  );
  const source = relevant.length > 0 ? relevant : structures;

  const byClass = new Map<string, { label: string; roles: Set<string>; descriptions: Set<string> }>();

  for (const s of source) {
    for (const role of s.keyRoles) {
      const { classKey, label } = classifyRole(role);
      if (!byClass.has(classKey)) {
        byClass.set(classKey, { label, roles: new Set(), descriptions: new Set() });
      }
      byClass.get(classKey)!.roles.add(role);
      if (s.description) byClass.get(classKey)!.descriptions.add(s.description);
    }
  }

  const presentClasses = Array.from(byClass.keys());

  const tiers: HierarchyTier[] = [];
  CLASS_RANK_ORDER.forEach((classKey, idx) => {
    const entry = byClass.get(classKey);
    if (!entry) return;
    tiers.push({
      id: classKey,
      label: entry.label,
      description: Array.from(entry.descriptions).slice(0, 2).join(" "),
      color: getClassColor(classKey),
      roles: Array.from(entry.roles),
      populationPercent: getPopulationPercent(classKey, presentClasses),
      rank: idx,
      classKey,
    });
  });

  return tiers.map((tier, idx) => ({ ...tier, rank: idx }));
}

/**
 * Build organizational chart nodes/edges for a single structure
 * (e.g., a specific government's hierarchy of roles).
 */
export function buildOrgChart(
  structure: SocialStructure
): { nodes: Array<{ id: string; label: string; rank: number }>; edges: Array<{ source: string; target: string }> } {
  const nodes = structure.keyRoles.map((role, idx) => ({
    id: `${structure.id}:${role}`,
    label: role,
    rank: idx,
  }));
  const edges: Array<{ source: string; target: string }> = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({ source: nodes[0].id, target: nodes[i].id });
  }
  return { nodes, edges };
}

/**
 * Build a patron-client network graph where higher classes connect to
 * lower classes they traditionally patronized.
 */
export function buildPatronNetwork(
  tiers: HierarchyTier[]
): { nodes: NetworkNodeData[]; edges: NetworkEdgeData[] } {
  const nodes: NetworkNodeData[] = tiers.map((t) => ({
    id: t.id,
    label: t.label,
    category: t.classKey,
    color: t.color,
    rank: t.rank,
  }));

  const edges: NetworkEdgeData[] = [];
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const upper = tiers[i];
      const lower = tiers[j];
      const isAuthority = i === 0 || upper.classKey === "noble" || upper.classKey === "ruler";
      const isPatronage = (upper.classKey === "noble" && ["warrior", "artisan", "farmer"].includes(lower.classKey)) ||
        (upper.classKey === "merchant" && lower.classKey === "artisan");
      if (isAuthority || isPatronage) {
        edges.push({
          source: upper.id,
          target: lower.id,
          type: isAuthority && !isPatronage ? "authority" : "patronage",
        });
      }
    }
  }
  return { nodes, edges };
}

/**
 * Pyramid layout: each tier is a trapezoid. Returns widths (0-100) for each tier.
 */
export function pyramidWidths(tierCount: number): number[] {
  if (tierCount <= 0) return [];
  const min = 25;
  const max = 100;
  if (tierCount === 1) return [max];
  const step = (max - min) / (tierCount - 1);
  return Array.from({ length: tierCount }, (_, i) => min + step * i);
}

/**
 * Concentric-circle layout: inner = center (ruler), outer rings = lower classes.
 * Returns radius (0-100) for each ring.
 */
export function concentricRadii(tierCount: number): number[] {
  if (tierCount <= 0) return [];
  const step = 100 / tierCount;
  return Array.from({ length: tierCount }, (_, i) => Math.round((i + 1) * step));
}
