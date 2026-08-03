/**
 * Parse a year-shaped string. Returns null when the input doesn't look like a year.
 *
 * Why: dataset TSVs store time inconsistently — "3500 BCE", "1100 CE", "-3000",
 * "Modern Era", "Bronze Age". Adapters call this for every column they treat as
 * temporal. If null, the adapter should drop the row from its temporal projection
 * rather than emit a garbage point.
 */
export function parseYear(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return null;

  const str = input.trim();
  if (!str) return null;

  // "-3000" or "1500"
  const signedNumeric = str.match(/^-?\d+$/);
  if (signedNumeric) return parseInt(str, 10);

  // "3500 BCE"
  const bce = str.match(/(\d+)\s*BCE/i);
  if (bce) return -parseInt(bce[1], 10);

  // "1100 CE" or "1100 AD"
  const ce = str.match(/(\d+)\s*(?:CE|AD)/i);
  if (ce) return parseInt(ce[1], 10);

  // "500-1100 CE" or "3000-1500 BCE" — take start year
  const range = str.match(/(-?\d+)\s*-\s*\d+\s*(BCE|CE|AD)?/i);
  if (range) {
    const year = parseInt(range[1], 10);
    return range[2]?.toUpperCase() === "BCE" ? -Math.abs(year) : year;
  }

  return null;
}

/**
 * Parse a "start to end" range string like "-3000 to 1500" or "-2000 to present".
 * Returns [startYear, endYear|null] or null if the input isn't parseable.
 */
export function parseYearRange(input: unknown): [number, number | null] | null {
  if (typeof input !== "string") return null;
  const str = input.trim();
  if (!str) return null;

  const parts = str.split(/\s+to\s+/i);
  if (parts.length !== 2) {
    const single = parseYear(str);
    return single === null ? null : [single, null];
  }

  const start = parseYear(parts[0]);
  if (start === null) return null;

  const endRaw = parts[1].trim();
  if (/^(present|now|current)$/i.test(endRaw)) return [start, null];

  const end = parseYear(endRaw);
  return [start, end];
}

/**
 * Build relational links from a list of items where each item exposes a list of
 * shared "tags" (e.g. trade routes, civilizations). Two items are connected when
 * they share at least one tag. Returns one link per pair (deduped).
 */
export function linksFromSharedTags<T>(
  items: T[],
  getId: (item: T) => string,
  getTags: (item: T) => string[],
  kind: string
): Array<{ source: string; target: string; kind: string; weight: number }> {
  const tagToItems = new Map<string, string[]>();
  for (const item of items) {
    const id = getId(item);
    for (const tag of getTags(item)) {
      const list = tagToItems.get(tag);
      if (list) list.push(id);
      else tagToItems.set(tag, [id]);
    }
  }

  const seen = new Set<string>();
  const links: Array<{ source: string; target: string; kind: string; weight: number }> = [];

  for (const ids of Array.from(tagToItems.values())) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const key = `${a}|${b}`;
        if (seen.has(key)) {
          const existing = links.find((l) => l.source === a && l.target === b);
          if (existing) existing.weight += 1;
        } else {
          seen.add(key);
          links.push({ source: a, target: b, kind, weight: 1 });
        }
      }
    }
  }

  return links;
}
