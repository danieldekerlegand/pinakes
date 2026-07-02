export type CultureDataCardVariant = "compact" | "standard" | "detailed";

export interface RelatedEntity {
  id: string;
  label: string;
  href?: string;
  type?: string;
}

export interface CultureDataCardImage {
  url: string;
  alt?: string;
}

export interface CultureDataCardData {
  id: string;
  title: string;
  category?: string;
  timePeriodStart?: number | string | null;
  timePeriodEnd?: number | string | null;
  description?: string;
  image?: CultureDataCardImage;
  tags?: string[];
  relatedEntities?: RelatedEntity[];
  accentColor?: string;
}

export function formatTimePeriod(
  start?: number | string | null,
  end?: number | string | null,
): string {
  const s = normalizeYear(start);
  const e = normalizeYear(end);
  if (s === null && e === null) return "";
  if (s !== null && e !== null) return `${s} – ${e}`;
  return (s ?? e) as string;
}

function normalizeYear(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (trimmed.toLowerCase() === "present") return "present";
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return trimmed;
    return yearLabel(parsed);
  }
  return yearLabel(value);
}

function yearLabel(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function moveCard<T extends { id: string }>(
  cards: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (fromIndex === toIndex) return cards.slice();
  if (fromIndex < 0 || fromIndex >= cards.length) return cards.slice();
  if (toIndex < 0 || toIndex >= cards.length) return cards.slice();
  const next = cards.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function reorderCards<T extends { id: string }>(
  cards: T[],
  fromId: string,
  toId: string,
): T[] {
  if (fromId === toId) return cards.slice();
  const fromIndex = cards.findIndex((c) => c.id === fromId);
  const toIndex = cards.findIndex((c) => c.id === toId);
  if (fromIndex === -1 || toIndex === -1) return cards.slice();
  return moveCard(cards, fromIndex, toIndex);
}

export function getVariantClasses(variant: CultureDataCardVariant): {
  root: string;
  body: string;
  title: string;
  description: string;
  image: string;
} {
  switch (variant) {
    case "compact":
      return {
        root: "flex items-center gap-3 p-2 rounded-md border border-gray-200 dark:border-gray-700",
        body: "flex-1 min-w-0",
        title: "text-sm font-medium text-gray-900 dark:text-gray-100 truncate",
        description: "text-xs text-gray-500 dark:text-gray-400 truncate",
        image: "h-8 w-8 rounded object-cover flex-shrink-0",
      };
    case "detailed":
      return {
        root: "flex flex-col gap-4 p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm",
        body: "space-y-3",
        title: "text-lg font-semibold text-gray-900 dark:text-gray-100",
        description: "text-sm text-gray-600 dark:text-gray-300 leading-relaxed",
        image: "w-full h-48 rounded-lg object-cover",
      };
    case "standard":
    default:
      return {
        root: "flex flex-col gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900",
        body: "space-y-1.5",
        title: "text-sm font-semibold text-gray-900 dark:text-gray-100",
        description: "text-xs text-gray-600 dark:text-gray-300 leading-relaxed",
        image: "w-full h-32 rounded-md object-cover",
      };
  }
}

export interface CultureDataCardValidationError {
  field: string;
  message: string;
}

export function validateCardData(
  data: Partial<CultureDataCardData>,
): CultureDataCardValidationError[] {
  const errors: CultureDataCardValidationError[] = [];
  if (!data.id || String(data.id).trim() === "") {
    errors.push({ field: "id", message: "id is required" });
  }
  if (!data.title || String(data.title).trim() === "") {
    errors.push({ field: "title", message: "title is required" });
  }
  if (data.image && !data.image.url) {
    errors.push({ field: "image.url", message: "image.url is required when image is provided" });
  }
  return errors;
}

export function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
