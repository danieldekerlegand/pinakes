export interface Innovation {
  id: string;
  name: string;
  category: string;
  cultureProfileIds: string[];
  yearInvented: number | null;
  regionOfOrigin: string;
  description: string;
  diffusionPath: string[];
  relatedInnovations: string[];
  associatedLanguages: string[];
  sources: string[];
}

export const INNOVATION_CATEGORY_COLORS: Record<string, string> = {
  writing: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  metallurgy: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  agriculture: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  water_management: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  transportation: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  astronomy: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  mathematics: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  medicine: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  military: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  construction: "bg-stone-200 text-stone-800 dark:bg-stone-800/50 dark:text-stone-300",
};

export function formatInnovationYear(year: number | null): string {
  if (year === null) return "Unknown";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function filterInnovationsByCulture(
  innovations: Innovation[],
  cultureProfileId: string | undefined,
): Innovation[] {
  if (!cultureProfileId) return innovations;
  return innovations.filter((i) => i.cultureProfileIds.includes(cultureProfileId));
}

export function getUniqueInnovationCategories(innovations: Innovation[]): string[] {
  return Array.from(new Set(innovations.map((i) => i.category))).sort();
}

export function sortInnovationsByYear(innovations: Innovation[]): Innovation[] {
  return [...innovations].sort((a, b) => {
    if (a.yearInvented === null && b.yearInvented === null) return 0;
    if (a.yearInvented === null) return 1;
    if (b.yearInvented === null) return -1;
    return a.yearInvented - b.yearInvented;
  });
}

export function formatCategoryLabel(category: string): string {
  return category
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
