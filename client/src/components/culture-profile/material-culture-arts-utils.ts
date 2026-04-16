export function formatYear(year: number | null): string {
  if (year === null) return "present";
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export const CATEGORY_COLORS: Record<string, string> = {
  pottery: "#d97706",
  metallurgy: "#0891b2",
  tools: "#6366f1",
  agriculture: "#16a34a",
  textiles: "#db2777",
  architecture: "#2563eb",
  sculpture: "#7c3aed",
  painting: "#dc2626",
  ceramics: "#d97706",
  calligraphy: "#4f46e5",
  music: "#c026d3",
  dance: "#ea580c",
  string: "#e11d48",
  percussion: "#f59e0b",
  wind: "#0d9488",
  keyboard: "#6366f1",
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] || "#6b7280";
}

export function filterByCategory<T extends { category: string }>(
  items: T[],
  category: string
): T[] {
  if (category === "all") return items;
  return items.filter((i) => i.category === category);
}

export function filterByFamily<T extends { instrumentFamily: string }>(
  items: T[],
  family: string
): T[] {
  if (family === "all") return items;
  return items.filter((i) => i.instrumentFamily === family);
}

export function getUniqueCategories(items: { category: string }[]): string[] {
  return Array.from(new Set(items.map((i) => i.category))).sort();
}

export function getUniqueFamilies(items: { instrumentFamily: string }[]): string[] {
  return Array.from(new Set(items.map((i) => i.instrumentFamily))).sort();
}
