export interface CultureEvent {
  id: string;
  cultureProfileId: string;
  year: number;
  lane: string;
  eventType: string;
  title: string;
  description: string;
  magnitude: string;
  sources: string[];
}

export type LaneKey =
  | "political"
  | "territory"
  | "urbanism"
  | "technology"
  | "religion"
  | "language"
  | "economy";

export interface LaneDefinition {
  key: LaneKey;
  label: string;
  color: string;
}

export const LANE_ORDER: LaneDefinition[] = [
  { key: "political", label: "Political", color: "#dc2626" },
  { key: "territory", label: "Territory", color: "#f97316" },
  { key: "urbanism", label: "Urbanism", color: "#d97706" },
  { key: "technology", label: "Technology", color: "#2563eb" },
  { key: "religion", label: "Religion", color: "#7c3aed" },
  { key: "language", label: "Language", color: "#0891b2" },
  { key: "economy", label: "Economy", color: "#16a34a" },
];

export const MAGNITUDE_RADIUS: Record<string, number> = {
  major: 7,
  moderate: 5,
  minor: 3,
};

export function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function formatYearRange(start: number, end: number): string {
  return `${formatYear(start)} \u2013 ${formatYear(end)}`;
}

export function getLaneDefinition(lane: string): LaneDefinition {
  const match = LANE_ORDER.find((l) => l.key === lane.toLowerCase());
  return match ?? { key: "political", label: lane, color: "#6b7280" };
}

export function getEventRadius(magnitude: string): number {
  return MAGNITUDE_RADIUS[magnitude.toLowerCase()] ?? 4;
}

export function groupEventsByLane(events: CultureEvent[]): Map<LaneKey, CultureEvent[]> {
  const map = new Map<LaneKey, CultureEvent[]>();
  for (const lane of LANE_ORDER) map.set(lane.key, []);
  for (const event of events) {
    const key = (event.lane.toLowerCase() as LaneKey);
    if (map.has(key)) {
      map.get(key)!.push(event);
    }
  }
  return map;
}

export function getUsedLanes(events: CultureEvent[]): LaneDefinition[] {
  const usedKeys = new Set(events.map((e) => e.lane.toLowerCase()));
  return LANE_ORDER.filter((l) => usedKeys.has(l.key));
}

export function getTimeBounds(
  profileStart: number,
  profileEnd: number,
  events: CultureEvent[]
): { start: number; end: number } {
  const years = events.map((e) => e.year);
  const start = Math.min(profileStart, ...(years.length ? years : [profileStart]));
  const end = Math.max(profileEnd, ...(years.length ? years : [profileEnd]));
  const span = Math.max(1, end - start);
  const pad = Math.round(span * 0.02);
  return { start: start - pad, end: end + pad };
}

export function yearToX(
  year: number,
  bounds: { start: number; end: number },
  width: number
): number {
  const span = bounds.end - bounds.start;
  if (span <= 0) return 0;
  return ((year - bounds.start) / span) * width;
}

export function xToYear(
  x: number,
  bounds: { start: number; end: number },
  width: number
): number {
  const span = bounds.end - bounds.start;
  if (width <= 0) return bounds.start;
  return Math.round(bounds.start + (x / width) * span);
}

export function getAxisTicks(
  bounds: { start: number; end: number },
  targetCount: number = 6
): number[] {
  const span = bounds.end - bounds.start;
  if (span <= 0) return [bounds.start];
  const rawStep = span / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 5, 10];
  const step = niceSteps.find((s) => s * magnitude >= rawStep)! * magnitude;
  const first = Math.ceil(bounds.start / step) * step;
  const ticks: number[] = [];
  for (let y = first; y <= bounds.end; y += step) ticks.push(y);
  return ticks;
}

export function activeEventsAtYear(
  events: CultureEvent[],
  year: number,
  windowYears: number = 50
): CultureEvent[] {
  return events.filter((e) => Math.abs(e.year - year) <= windowYears);
}

export function summarizeStateAtYear(
  events: CultureEvent[],
  year: number
): Record<LaneKey, CultureEvent | null> {
  const state: Record<string, CultureEvent | null> = {};
  for (const lane of LANE_ORDER) state[lane.key] = null;
  for (const event of events) {
    if (event.year > year) continue;
    const key = event.lane.toLowerCase();
    const current = state[key];
    if (!current || event.year >= current.year) {
      state[key] = event;
    }
  }
  return state as Record<LaneKey, CultureEvent | null>;
}
