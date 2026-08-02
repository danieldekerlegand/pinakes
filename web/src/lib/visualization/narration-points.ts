import type { NarrationPoint } from './geospatial-types';

/**
 * Default narration points for the timeline playback.
 * These mark historically significant moments that pause playback
 * and display an info card to the user.
 */
export const DEFAULT_NARRATION_POINTS: NarrationPoint[] = [
  {
    id: 'sumerian-writing',
    year: -3200,
    title: 'Invention of Cuneiform Writing',
    description: 'The Sumerians in Mesopotamia develop cuneiform, one of the earliest known writing systems, enabling record-keeping and literary expression.',
    category: 'cultural',
  },
  {
    id: 'pyramid-age',
    year: -2600,
    title: 'Age of the Great Pyramids',
    description: 'The Egyptian Old Kingdom reaches its architectural zenith with the construction of the Great Pyramids at Giza.',
    category: 'cultural',
  },
  {
    id: 'indus-valley-peak',
    year: -2500,
    title: 'Indus Valley Civilization at Its Peak',
    description: 'Harappa and Mohenjo-daro flourish with advanced urban planning, standardized weights, and undeciphered script.',
    category: 'cultural',
  },
  {
    id: 'bronze-age-collapse',
    year: -1200,
    title: 'Bronze Age Collapse',
    description: 'A cascading systems collapse destroys multiple civilizations across the Eastern Mediterranean, including the Hittites and Mycenaeans.',
    category: 'political',
  },
  {
    id: 'phoenician-alphabet',
    year: -1050,
    title: 'Phoenician Alphabet Spreads',
    description: 'The Phoenician alphabet, ancestor of Greek, Latin, Arabic, and Hebrew scripts, spreads across the Mediterranean through trade networks.',
    category: 'linguistic',
  },
  {
    id: 'classical-athens',
    year: -480,
    title: 'Classical Athens & Greek Golden Age',
    description: 'After defeating Persia at Salamis, Athens enters its golden age of democracy, philosophy, drama, and architecture.',
    category: 'cultural',
  },
  {
    id: 'alexander-empire',
    year: -323,
    title: 'Death of Alexander the Great',
    description: 'Alexander\'s empire stretches from Greece to India. His death fractures the Hellenistic world, spreading Greek language and culture across vast territories.',
    category: 'political',
  },
  {
    id: 'qin-unification',
    year: -221,
    title: 'Qin Unification of China',
    description: 'Qin Shi Huang unifies China, standardizing writing, weights, measures, and currency — shaping Chinese civilization for millennia.',
    category: 'political',
  },
  {
    id: 'roman-peak',
    year: 117,
    title: 'Roman Empire at Greatest Extent',
    description: 'Under Trajan, the Roman Empire reaches its maximum territorial extent, spanning from Britain to Mesopotamia. Latin spreads as the lingua franca of the West.',
    category: 'political',
  },
  {
    id: 'western-rome-falls',
    year: 476,
    title: 'Fall of the Western Roman Empire',
    description: 'Romulus Augustulus, the last Western Roman Emperor, is deposed. Latin fragments into the Romance languages across former Roman territories.',
    category: 'political',
  },
  {
    id: 'islamic-golden-age',
    year: 800,
    title: 'Islamic Golden Age Begins',
    description: 'The Abbasid Caliphate fosters a flowering of science, mathematics, medicine, and philosophy. Arabic becomes the language of scholarship across a vast domain.',
    category: 'scientific',
  },
  {
    id: 'mongol-empire',
    year: 1206,
    title: 'Rise of the Mongol Empire',
    description: 'Genghis Khan unites the Mongol tribes, launching conquests that create the largest contiguous land empire in history and reshape Eurasian demographics.',
    category: 'military',
  },
  {
    id: 'black-death',
    year: 1347,
    title: 'The Black Death Reaches Europe',
    description: 'The bubonic plague kills an estimated third of Europe\'s population, triggering massive social, economic, and linguistic upheaval.',
    category: 'cultural',
  },
  {
    id: 'gutenberg-press',
    year: 1440,
    title: 'Gutenberg\'s Printing Press',
    description: 'The movable-type printing press revolutionizes the spread of knowledge, standardizes vernacular languages, and accelerates the Renaissance.',
    category: 'scientific',
  },
  {
    id: 'columbian-exchange',
    year: 1492,
    title: 'Columbian Exchange Begins',
    description: 'Columbus reaches the Americas, initiating a massive exchange of crops, animals, diseases, and languages between the Old and New Worlds.',
    category: 'cultural',
  },
  {
    id: 'industrial-revolution',
    year: 1760,
    title: 'Industrial Revolution Begins',
    description: 'Mechanization transforms British manufacturing, urbanizing populations and spreading English as the dominant language of industry and commerce.',
    category: 'scientific',
  },
  {
    id: 'ww1',
    year: 1914,
    title: 'World War I',
    description: 'The Great War redraws the map of Europe and the Middle East, dissolving empires and creating new nation-states with redrawn linguistic boundaries.',
    category: 'military',
  },
  {
    id: 'ww2-end',
    year: 1945,
    title: 'End of World War II',
    description: 'The deadliest conflict in history ends, reshaping global power structures. The post-war order accelerates decolonization and the spread of English as a global language.',
    category: 'military',
  },
  {
    id: 'internet-age',
    year: 1991,
    title: 'The World Wide Web Goes Public',
    description: 'Tim Berners-Lee\'s invention transforms global communication, creating new digital lingua francas and accelerating language contact at unprecedented scale.',
    category: 'scientific',
  },
];

/**
 * Find narration points within a year range (inclusive).
 */
export function findNarrationPointsInRange(
  points: NarrationPoint[],
  startYear: number,
  endYear: number,
): NarrationPoint[] {
  return points.filter((p) => p.year >= startYear && p.year <= endYear);
}

/**
 * Find the next narration point after a given year.
 * Returns undefined if no narration point exists after the given year.
 */
export function findNextNarrationPoint(
  points: NarrationPoint[],
  currentYear: number,
): NarrationPoint | undefined {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  return sorted.find((p) => p.year > currentYear);
}

/**
 * Find the previous narration point before a given year.
 */
export function findPreviousNarrationPoint(
  points: NarrationPoint[],
  currentYear: number,
): NarrationPoint | undefined {
  const sorted = [...points].sort((a, b) => b.year - a.year);
  return sorted.find((p) => p.year < currentYear);
}

/**
 * Calculate the position of a narration point on the timeline as a percentage (0-100).
 */
export function narrationPointPosition(
  year: number,
  minYear: number,
  maxYear: number,
): number {
  if (maxYear === minYear) return 0;
  return ((year - minYear) / (maxYear - minYear)) * 100;
}
