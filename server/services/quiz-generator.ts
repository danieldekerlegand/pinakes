import { storage } from "../storage";
import type { Language, LanguageFamily } from "@contracts/types";

export type QuestionType = "multiple_choice" | "drag_sort" | "map_click";
export type Difficulty = "easy" | "medium" | "hard";
export type QuizCategory = "languages" | "families" | "grammar" | "writing_systems" | "geography" | "cuisine" | "civilizations";

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  category: QuizCategory;
  difficulty: Difficulty;
  question: string;
  /** For multiple_choice: array of option strings */
  options?: string[];
  /** For multiple_choice: index of correct option; for map_click: {lat, lng} */
  answer: number | string[] | { lat: number; lng: number };
  /** Hint shown after wrong answer */
  hint?: string;
  /** Explanation shown after answering */
  explanation?: string;
}

export interface QuizSession {
  questions: QuizQuestion[];
  category: QuizCategory | "mixed";
  difficulty: Difficulty;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  return shuffleArray(arr).slice(0, count);
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// --- Question generators ---

async function generateLanguageFamilyQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const languages = await storage.getLanguages();
  const families = await storage.getLanguageFamilies();
  const familyMap = new Map(families.map(f => [f.id, f]));

  const candidates = languages.filter(l => familyMap.has(l.familyId) && !l.isDialect && !l.isHistoricalVariant);
  if (candidates.length < 4) return null;

  const target = pickRandom(candidates, 1)[0];
  const correctFamily = familyMap.get(target.familyId);
  if (!correctFamily) return null;

  const wrongFamilies = pickRandom(
    families.filter(f => f.id !== target.familyId),
    3
  );

  const options = shuffleArray([correctFamily, ...wrongFamilies].map(f => f.name));
  const correctIndex = options.indexOf(correctFamily.name);

  return {
    id: makeId(),
    type: "multiple_choice",
    category: "families",
    difficulty,
    question: `Which language family does ${target.name} belong to?`,
    options,
    answer: correctIndex,
    hint: target.region ? `It is spoken in ${target.region}.` : undefined,
    explanation: `${target.name} belongs to the ${correctFamily.name} family.`,
  };
}

async function generateSpeakerCountQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const languages = await storage.getLanguages();
  const withSpeakers = languages.filter(l => l.totalSpeakers && l.totalSpeakers > 0 && !l.isDialect && !l.isHistoricalVariant);
  if (withSpeakers.length < 4) return null;

  const selected = pickRandom(withSpeakers, 4);
  selected.sort((a, b) => (b.totalSpeakers || 0) - (a.totalSpeakers || 0));

  const correctOrder = selected.map(l => l.name);

  return {
    id: makeId(),
    type: "drag_sort",
    category: "languages",
    difficulty,
    question: "Sort these languages by number of total speakers (most to fewest):",
    options: shuffleArray([...correctOrder]),
    answer: correctOrder,
    explanation: selected.map(l => `${l.name}: ${(l.totalSpeakers || 0).toLocaleString()} speakers`).join(", "),
  };
}

async function generateMapClickQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const languages = await storage.getLanguages();
  const withCoords = languages.filter(l => l.coordinates && !l.isDialect && !l.isHistoricalVariant);
  if (withCoords.length === 0) return null;

  const target = pickRandom(withCoords, 1)[0];
  const coords = target.coordinates!;

  // Tolerance in degrees based on difficulty
  const tolerance = difficulty === "easy" ? 15 : difficulty === "medium" ? 8 : 4;

  return {
    id: makeId(),
    type: "map_click",
    category: "geography",
    difficulty,
    question: `Click on the map where ${target.name} is primarily spoken.`,
    answer: { lat: coords.lat, lng: coords.lng },
    hint: target.region ? `It is spoken in the ${target.region} region.` : undefined,
    explanation: `${target.name} is spoken in ${target.countries?.join(", ") || target.region || "its region"}.`,
  };
}

function hasValidCoords(coords: { lat: number; lng: number } | undefined | null): coords is { lat: number; lng: number } {
  if (!coords) return false;
  const { lat, lng } = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Reject the {lat:0,lng:0} sentinel used for missing/unparseable coordinates.
  return !(lat === 0 && lng === 0);
}

async function generateDishOriginQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const cuisines = await storage.getCuisines();
  const dishes = await storage.getCuisineItems();

  // Only cuisines with real origin coordinates can anchor a map-click answer.
  const cuisineMap = new Map(cuisines.filter(c => hasValidCoords(c.coordinates)).map(c => [c.id, c]));

  const candidates = dishes.filter(d => d.name && cuisineMap.has(d.cuisineId));
  if (candidates.length === 0) return null;

  const dish = pickRandom(candidates, 1)[0];
  const cuisine = cuisineMap.get(dish.cuisineId)!;
  const coords = cuisine.coordinates;

  return {
    id: makeId(),
    type: "map_click",
    category: "cuisine",
    difficulty,
    question: `Click on the map where the dish "${dish.name}" (${cuisine.name} cuisine) originated.`,
    answer: { lat: coords.lat, lng: coords.lng },
    hint: cuisine.region ? `It comes from the ${cuisine.region} culinary tradition.` : undefined,
    explanation: `${dish.name} originated in ${cuisine.region || cuisine.name} (${cuisine.name} cuisine).`,
  };
}

async function generateWordOrderQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const grammarFeatures = await storage.getGrammarFeatures();
  if (grammarFeatures.length < 4) return null;

  const languages = await storage.getLanguages();
  const langMap = new Map(languages.map(l => [l.id, l]));

  const withWordOrder = grammarFeatures.filter(g => g.wordOrder && langMap.has(g.languageId));
  if (withWordOrder.length < 4) return null;

  const target = pickRandom(withWordOrder, 1)[0];
  const lang = langMap.get(target.languageId);
  if (!lang) return null;

  const wordOrders = ["SOV", "SVO", "VSO", "VOS", "OVS", "OSV", "Free"];
  const wrongOptions = pickRandom(
    wordOrders.filter(wo => wo !== target.wordOrder),
    3
  );

  const options = shuffleArray([target.wordOrder, ...wrongOptions]);
  const correctIndex = options.indexOf(target.wordOrder);

  return {
    id: makeId(),
    type: "multiple_choice",
    category: "grammar",
    difficulty,
    question: `What is the basic word order of ${lang.name}?`,
    options,
    answer: correctIndex,
    explanation: `${lang.name} uses ${target.wordOrder} (${target.wordOrder === "SVO" ? "Subject-Verb-Object" : target.wordOrder === "SOV" ? "Subject-Object-Verb" : target.wordOrder === "VSO" ? "Verb-Subject-Object" : target.wordOrder}) word order.`,
  };
}

async function generateWritingSystemQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const writingSystems = await storage.getWritingSystems();
  if (writingSystems.length < 4) return null;

  const active = writingSystems.filter(ws => ws.isActive);
  if (active.length < 4) return null;

  const target = pickRandom(active, 1)[0];
  const wrongOptions = pickRandom(
    active.filter(ws => ws.id !== target.id).map(ws => ws.type),
    3
  );

  // Make options unique
  const uniqueOptions = [...new Set([target.type, ...wrongOptions])];
  if (uniqueOptions.length < 4) {
    const allTypes = ["alphabet", "abjad", "abugida", "syllabary", "logographic", "featural"];
    while (uniqueOptions.length < 4) {
      const extra = allTypes.find(t => !uniqueOptions.includes(t));
      if (extra) uniqueOptions.push(extra);
      else break;
    }
  }

  const options = shuffleArray(uniqueOptions.slice(0, 4));
  const correctIndex = options.indexOf(target.type);

  return {
    id: makeId(),
    type: "multiple_choice",
    category: "writing_systems",
    difficulty,
    question: `What type of writing system is ${target.name}?`,
    options,
    answer: correctIndex,
    hint: target.sampleCharacters ? `Sample characters: ${target.sampleCharacters}` : undefined,
    explanation: `${target.name} is a ${target.type} writing system${target.originRegion ? `, originating from ${target.originRegion}` : ""}.`,
  };
}

async function generateRegionQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const languages = await storage.getLanguages();
  const withRegion = languages.filter(l => l.region && !l.isDialect && !l.isHistoricalVariant);
  if (withRegion.length < 4) return null;

  const target = pickRandom(withRegion, 1)[0];
  const regions = [...new Set(withRegion.map(l => l.region!))];
  const wrongRegions = pickRandom(
    regions.filter(r => r !== target.region),
    3
  );

  const options = shuffleArray([target.region!, ...wrongRegions]);
  const correctIndex = options.indexOf(target.region!);

  return {
    id: makeId(),
    type: "multiple_choice",
    category: "geography",
    difficulty,
    question: `In which region is ${target.name} primarily spoken?`,
    options,
    answer: correctIndex,
    explanation: `${target.name} is spoken in ${target.region}${target.countries?.length ? ` (${target.countries.join(", ")})` : ""}.`,
  };
}

/** A civilization with a usable founding year, used by the chronology quiz. */
export interface ChronologyCivItem {
  name: string;
  /** Founding year; negative = BCE (e.g. -800 = 800 BCE). */
  year: number;
}

/** Number of items to order, per difficulty (more items = harder). */
export function chronologyItemCount(difficulty: Difficulty): number {
  return difficulty === "easy" ? 3 : difficulty === "medium" ? 4 : 5;
}

/**
 * Order civilizations chronologically by founding year (earliest first).
 * Pure + deterministic — the correct answer for a drag-sort question.
 */
export function orderCivilizationsChronologically(items: ChronologyCivItem[]): string[] {
  return [...items].sort((a, b) => a.year - b.year).map(i => i.name);
}

/**
 * Pick `count` civilizations to order, scaling *closeness* by difficulty.
 * `sorted` must be pre-sorted ascending by year. Harder difficulties draw from
 * a tighter window of adjacent foundings (closer years ⇒ harder to distinguish);
 * `hard` uses a fully contiguous run. Returns the chosen items sorted by year.
 */
export function selectChronologyItems(
  sorted: ChronologyCivItem[],
  count: number,
  difficulty: Difficulty,
): ChronologyCivItem[] | null {
  const n = sorted.length;
  if (n < count) return null;

  const windowSize = difficulty === "hard"
    ? count // contiguous run — closest possible foundings
    : difficulty === "medium"
      ? Math.min(n, count * 3)
      : n; // easy — draw from the whole span (widest gaps)

  const start = Math.floor(Math.random() * (n - windowSize + 1));
  const window = sorted.slice(start, start + windowSize);
  const chosen = windowSize === count ? window : pickRandom(window, count);
  return [...chosen].sort((a, b) => a.year - b.year);
}

function formatFoundingYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

async function generateCivilizationChronologyQuestion(difficulty: Difficulty): Promise<QuizQuestion | null> {
  const civs = await storage.getCivilizations();

  // A founding year of 0 is the missing-data sentinel in the loader — filter it out.
  const byName = new Map<string, ChronologyCivItem>();
  for (const c of civs) {
    const name = c.properties?.name;
    const year = c.properties?.timePeriod?.start;
    if (!name || typeof year !== "number" || Number.isNaN(year) || year === 0) continue;
    if (!byName.has(name)) byName.set(name, { name, year });
  }

  const items = Array.from(byName.values()).sort((a, b) => a.year - b.year);
  const count = chronologyItemCount(difficulty);

  const selected = selectChronologyItems(items, count, difficulty);
  if (!selected) return null;

  const correctOrder = orderCivilizationsChronologically(selected);

  return {
    id: makeId(),
    type: "drag_sort",
    category: "civilizations",
    difficulty,
    question: "Arrange these civilizations in chronological order (earliest founding first):",
    options: shuffleArray([...correctOrder]),
    answer: correctOrder,
    explanation: selected
      .map(i => `${i.name}: founded ${formatFoundingYear(i.year)}`)
      .join(", "),
  };
}

const generators: Record<QuizCategory, Array<(d: Difficulty) => Promise<QuizQuestion | null>>> = {
  languages: [generateSpeakerCountQuestion],
  families: [generateLanguageFamilyQuestion],
  grammar: [generateWordOrderQuestion],
  writing_systems: [generateWritingSystemQuestion],
  geography: [generateMapClickQuestion, generateRegionQuestion],
  cuisine: [generateDishOriginQuestion],
  civilizations: [generateCivilizationChronologyQuestion],
};

export async function generateQuiz(
  count: number,
  category: QuizCategory | "mixed",
  difficulty: Difficulty,
): Promise<QuizSession> {
  const questions: QuizQuestion[] = [];
  const maxAttempts = count * 3;
  let attempts = 0;

  const activeGenerators = category === "mixed"
    ? Object.values(generators).flat()
    : generators[category] || [];

  if (activeGenerators.length === 0) {
    return { questions: [], category, difficulty };
  }

  while (questions.length < count && attempts < maxAttempts) {
    attempts++;
    const gen = activeGenerators[Math.floor(Math.random() * activeGenerators.length)];
    const q = await gen(difficulty);
    if (q) {
      questions.push(q);
    }
  }

  return { questions, category, difficulty };
}

export function scoreMapClick(
  answer: { lat: number; lng: number },
  guess: { lat: number; lng: number },
  difficulty: Difficulty,
): { correct: boolean; distanceKm: number } {
  const R = 6371; // Earth radius km
  const dLat = (guess.lat - answer.lat) * Math.PI / 180;
  const dLng = (guess.lng - answer.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(answer.lat * Math.PI / 180) * Math.cos(guess.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  const thresholdKm = difficulty === "easy" ? 1500 : difficulty === "medium" ? 800 : 400;
  return { correct: distanceKm <= thresholdKm, distanceKm };
}
