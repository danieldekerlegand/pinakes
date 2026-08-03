// Pure utility functions for heatmap components (no JSX)

export interface HeatmapCell {
  row: number;
  col: number;
  value: number;
  label?: string;
}

// Build a color scale from threshold stops
export function makeColorScale(
  stops: Array<{ at: number; color: string }>
): (value: number) => string {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  return (value: number) => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (value >= sorted[i].at) return sorted[i].color;
    }
    return sorted[0]?.color ?? "bg-gray-100";
  };
}

// Canonical values for categorical typological features
const FEATURE_VALUES: Record<string, string[]> = {
  wordOrder: ["SVO", "SOV", "VSO", "VOS", "OVS", "OSV", "V2", "free"],
  morphologicalType: ["isolating", "agglutinative", "fusional", "polysynthetic"],
  ergativity: ["nominative-accusative", "ergative-absolutive", "split-ergative", "none"],
};

// Encode a typological feature value to a 0-1 numeric scale
export function encodeFeatureValue(feature: string, value: string | string[] | number): number {
  if (typeof value === "number") {
    return Math.min(value / 20, 1);
  }
  if (Array.isArray(value)) {
    return Math.min(value.length / 10, 1);
  }
  const canonical = FEATURE_VALUES[feature];
  if (canonical) {
    const idx = canonical.indexOf(value);
    if (idx >= 0) return (idx + 1) / canonical.length;
  }
  return value ? 0.5 : 0;
}

// Get a human-readable label for a feature value
export function formatFeatureValue(feature: string, value: string | string[] | number): string {
  if (typeof value === "number") return value.toString();
  if (Array.isArray(value)) return value.join(", ");
  return value || "N/A";
}
