export interface GalleryImage {
  id: string;
  url: string;
  title: string;
  description?: string;
  source?: string;
  license?: string;
  attribution?: string;
  mediaType?: string;
  tags?: string[];
  dateAdded?: string;
  width?: number | null;
  height?: number | null;
}

export type GallerySortOrder = "relevance" | "date" | "title";

export const MEDIA_TYPE_COLORS: Record<string, string> = {
  image: "#3b82f6",
  illustration: "#8b5cf6",
  reconstruction: "#f59e0b",
  map: "#10b981",
  diagram: "#6366f1",
  "3d_model": "#ec4899",
  video: "#ef4444",
};

export const LICENSE_LABELS: Record<string, string> = {
  public_domain: "Public Domain",
  "cc-0": "CC0",
  "cc0": "CC0",
  "cc by": "CC BY",
  "cc by 2.0": "CC BY 2.0",
  "cc by 3.0": "CC BY 3.0",
  "cc by 4.0": "CC BY 4.0",
  "cc by-sa": "CC BY-SA",
  "cc by-sa 2.0": "CC BY-SA 2.0",
  "cc by-sa 3.0": "CC BY-SA 3.0",
  "cc by-sa 4.0": "CC BY-SA 4.0",
  cc_by: "CC BY",
  cc_by_sa: "CC BY-SA",
  fair_use: "Fair Use",
  generated: "AI Generated",
};

export function normalizeLicense(license: string | undefined): string {
  if (!license) return "Unknown";
  const key = license.trim().toLowerCase();
  return LICENSE_LABELS[key] || license;
}

export function getMediaTypeColor(mediaType: string | undefined): string {
  if (!mediaType) return "#6b7280";
  return MEDIA_TYPE_COLORS[mediaType.toLowerCase()] || "#6b7280";
}

export function getUniqueTags(images: GalleryImage[]): string[] {
  const set = new Set<string>();
  for (const img of images) {
    for (const tag of img.tags ?? []) {
      if (tag.trim()) set.add(tag.trim());
    }
  }
  return Array.from(set).sort();
}

export function filterByTag(
  images: GalleryImage[],
  tag: string | null,
): GalleryImage[] {
  if (!tag || tag === "all") return images;
  return images.filter((img) => (img.tags ?? []).includes(tag));
}

export function filterByMediaType(
  images: GalleryImage[],
  mediaType: string | null,
): GalleryImage[] {
  if (!mediaType || mediaType === "all") return images;
  return images.filter(
    (img) => (img.mediaType ?? "").toLowerCase() === mediaType.toLowerCase(),
  );
}

export function sortImages(
  images: GalleryImage[],
  order: GallerySortOrder,
): GalleryImage[] {
  const copy = [...images];
  if (order === "date") {
    copy.sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? ""));
  } else if (order === "title") {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  return copy;
}

export function getAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): number | null {
  if (!width || !height || height === 0) return null;
  return width / height;
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function nextIndex(current: number, length: number): number {
  return clampIndex(current + 1, length);
}

export function prevIndex(current: number, length: number): number {
  return clampIndex(current - 1, length);
}

export function clampZoom(zoom: number, min = 1, max = 5): number {
  if (zoom < min) return min;
  if (zoom > max) return max;
  return zoom;
}
