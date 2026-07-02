// ── Tour data types ──────────────────────────────────────────────────

export interface TourStep {
  narration: string;
  center: [number, number]; // [lat, lng]
  zoom: number;
  bearing: number; // degrees, 0 = north
  timeYear: number;
  layers: string[];
  highlightedFeatures: string[];
}

export interface HistoricalTour {
  id: string;
  title: string;
  description: string;
  coverRegion: string;
  timeSpan: [number, number]; // [startYear, endYear]
  steps: TourStep[];
}

// ── Tour catalog ─────────────────────────────────────────────────────

export const CURATED_TOURS: HistoricalTour[] = [
  {
    id: 'mesopotamia-rise',
    title: 'Rise of Civilization in Mesopotamia',
    description:
      'Witness the birth of urban civilization between the Tigris and Euphrates — from the first cities to the great empires that shaped the ancient world.',
    coverRegion: 'Mesopotamia',
    timeSpan: [-5000, -539],
    steps: [
      {
        narration:
          'Around 5000 BCE, the Ubaid culture spread across southern Mesopotamia. Irrigation agriculture along the Tigris and Euphrates enabled the first permanent settlements, laying the groundwork for urban civilization.',
        center: [31.0, 46.0],
        zoom: 6,
        bearing: 0,
        timeYear: -5000,
        layers: ['archaeological-sites', 'settlements'],
        highlightedFeatures: ['eridu'],
      },
      {
        narration:
          'By 3500 BCE, the Sumerian city-states of Uruk, Ur, and Eridu had emerged. Uruk became the world\'s first true city, with a population exceeding 40,000. Cuneiform writing was invented here to track temple economies.',
        center: [31.3, 45.6],
        zoom: 7,
        bearing: 0,
        timeYear: -3500,
        layers: ['settlements', 'civilizations', 'archaeological-sites'],
        highlightedFeatures: ['uruk', 'ur', 'eridu'],
      },
      {
        narration:
          'Sargon of Akkad united the city-states around 2334 BCE, creating history\'s first empire. The Akkadian language — a Semitic tongue — became the region\'s lingua franca, while Sumerian persisted as a scholarly language, much like Latin in medieval Europe.',
        center: [33.0, 44.5],
        zoom: 6,
        bearing: 0,
        timeYear: -2334,
        layers: ['civilizations', 'settlements', 'language-ranges'],
        highlightedFeatures: ['akkad', 'babylon'],
      },
      {
        narration:
          'The Third Dynasty of Ur (2112–2004 BCE) saw a Sumerian renaissance. King Shulgi standardized weights, measures, and the cuneiform writing system. The Ziggurat of Ur, a massive stepped pyramid, was built during this golden age.',
        center: [30.96, 46.1],
        zoom: 7,
        bearing: 0,
        timeYear: -2100,
        layers: ['civilizations', 'settlements', 'archaeological-sites'],
        highlightedFeatures: ['ur'],
      },
      {
        narration:
          'Hammurabi of Babylon (r. 1792–1750 BCE) created one of history\'s earliest law codes and made Babylon the region\'s cultural capital. Old Babylonian became the diplomatic language of the entire Near East, used even by Egyptian pharaohs.',
        center: [32.5, 44.4],
        zoom: 6,
        bearing: 0,
        timeYear: -1750,
        layers: ['civilizations', 'settlements', 'routes'],
        highlightedFeatures: ['babylon'],
      },
      {
        narration:
          'The Neo-Assyrian Empire (911–612 BCE) built the ancient world\'s largest state, stretching from Egypt to Iran. Ashurbanipal\'s library at Nineveh preserved thousands of cuneiform tablets, including the Epic of Gilgamesh — humanity\'s oldest surviving literary work.',
        center: [36.4, 43.1],
        zoom: 5,
        bearing: 0,
        timeYear: -700,
        layers: ['civilizations', 'settlements', 'battles', 'routes'],
        highlightedFeatures: ['nineveh', 'assur'],
      },
      {
        narration:
          'Nebuchadnezzar II\'s Neo-Babylonian Empire (626–539 BCE) was Mesopotamia\'s last great indigenous power. His Hanging Gardens became one of the Seven Wonders. In 539 BCE, Cyrus the Great of Persia conquered Babylon, ending 3,000 years of Mesopotamian independence.',
        center: [32.5, 44.4],
        zoom: 5,
        bearing: 0,
        timeYear: -539,
        layers: ['civilizations', 'settlements', 'battles'],
        highlightedFeatures: ['babylon', 'nineveh'],
      },
    ],
  },
  {
    id: 'indo-european-expansion',
    title: 'The Indo-European Expansion',
    description:
      'Follow the most successful language family in history as it spread from the Pontic Steppe to dominate Europe, Iran, and India over thousands of years.',
    coverRegion: 'Eurasia',
    timeSpan: [-4500, 0],
    steps: [
      {
        narration:
          'Around 4500 BCE on the Pontic-Caspian Steppe, speakers of Proto-Indo-European herded cattle and domesticated horses. Their language would become the ancestor of nearly half the world\'s spoken languages today.',
        center: [48.0, 38.0],
        zoom: 5,
        bearing: 0,
        timeYear: -4500,
        layers: ['archaeological-sites', 'urheimat-hypotheses'],
        highlightedFeatures: [],
      },
      {
        narration:
          'The Yamnaya culture (3300–2600 BCE) spread westward into Europe and eastward toward Central Asia. Horse-drawn wheeled vehicles gave them unprecedented mobility. DNA evidence confirms massive population movements across Europe during this period.',
        center: [47.0, 40.0],
        zoom: 4,
        bearing: 0,
        timeYear: -3000,
        layers: ['archaeological-sites', 'haplogroups', 'urheimat-hypotheses'],
        highlightedFeatures: [],
      },
      {
        narration:
          'The Anatolian branch diverged first, establishing the Hittite Empire in modern Turkey by 1600 BCE. Hittite, written in cuneiform, is the oldest attested Indo-European language — deciphered only in 1915.',
        center: [39.5, 34.0],
        zoom: 5,
        bearing: 0,
        timeYear: -1600,
        layers: ['civilizations', 'language-ranges', 'archaeological-sites'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Indo-Iranian speakers moved southeast, splitting into Iranian and Indo-Aryan branches. The Rigveda, composed 1500–1200 BCE in Vedic Sanskrit, preserves some of the most archaic Indo-European poetry and mythology.',
        center: [30.0, 70.0],
        zoom: 4,
        bearing: 0,
        timeYear: -1500,
        layers: ['language-ranges', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Celtic, Italic, Germanic, Slavic, and Baltic branches diversified across Europe. By the classical period, Indo-European languages dominated the continent, with Latin spreading through Roman conquest to create the Romance language family.',
        center: [45.0, 12.0],
        zoom: 4,
        bearing: 0,
        timeYear: -200,
        layers: ['language-ranges', 'civilizations', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'By the turn of the millennium, Indo-European languages stretched from Britain to Bengal. This single family\'s 4,500-year expansion is the most successful linguistic spread in human history, now spoken by over 3.2 billion people.',
        center: [40.0, 50.0],
        zoom: 3,
        bearing: 0,
        timeYear: 0,
        layers: ['language-ranges'],
        highlightedFeatures: [],
      },
    ],
  },
  {
    id: 'silk-road',
    title: 'The Silk Road',
    description:
      'Travel the ancient trade networks that connected China to Rome, exchanging not just silk and spices but languages, religions, and entire writing systems.',
    coverRegion: 'Central Asia',
    timeSpan: [-200, 1400],
    steps: [
      {
        narration:
          'The Silk Road begins at Chang\'an (modern Xi\'an), capital of the Han Dynasty. Chinese traders set out westward around 200 BCE carrying silk, paper, and lacquerware. Zhang Qian\'s diplomatic mission in 138 BCE opened the route.',
        center: [34.3, 108.9],
        zoom: 5,
        bearing: 0,
        timeYear: -200,
        layers: ['routes', 'settlements', 'civilizations'],
        highlightedFeatures: [],
      },
      {
        narration:
          'In the Tarim Basin oases, Tocharian languages — now-extinct Indo-European tongues spoken in western China — served as intermediaries. Buddhist texts were translated through multiple languages as they traveled eastward.',
        center: [40.5, 80.0],
        zoom: 5,
        bearing: 0,
        timeYear: 200,
        layers: ['routes', 'archaeological-sites', 'language-ranges'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Sogdian merchants from Samarkand became the Silk Road\'s great intermediaries. Their Iranian language served as the trade lingua franca from China to Persia, leaving loanwords in Chinese, Turkic, and Mongolian.',
        center: [39.6, 66.9],
        zoom: 5,
        bearing: 0,
        timeYear: 500,
        layers: ['routes', 'settlements', 'language-ranges'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Buddhism spread eastward along the Silk Road, carrying Sanskrit terminology into Chinese, Tibetan, and Mongolian. Islam later traveled the same routes westward to east, converting the Turkic peoples of Central Asia.',
        center: [35.0, 70.0],
        zoom: 4,
        bearing: 0,
        timeYear: 700,
        layers: ['routes', 'religions', 'language-ranges'],
        highlightedFeatures: [],
      },
      {
        narration:
          'At the Silk Road\'s western terminus, goods and words reached the Roman and Byzantine empires. Latin "sericum" (silk) came from Chinese "si" (丝) via an intermediary language — the word itself a product of the route it named.',
        center: [41.0, 29.0],
        zoom: 5,
        bearing: 0,
        timeYear: 500,
        layers: ['routes', 'civilizations', 'settlements'],
        highlightedFeatures: [],
      },
      {
        narration:
          'The Mongol Empire (1206–1368) brought the Silk Road\'s peak connectivity. Pax Mongolica made travel safe across the entire route. Persian became the administrative language, while the Mongol postal system connected China to Hungary.',
        center: [47.0, 100.0],
        zoom: 3,
        bearing: 0,
        timeYear: 1250,
        layers: ['civilizations', 'routes', 'settlements'],
        highlightedFeatures: [],
      },
    ],
  },
  {
    id: 'austronesian-migration',
    title: 'Austronesian Migration',
    description:
      'Follow the greatest maritime expansion in human history — Austronesian-speaking peoples colonized half the planet\'s longitude, from Madagascar to Easter Island.',
    coverRegion: 'Pacific & Indian Ocean',
    timeSpan: [-3000, 1300],
    steps: [
      {
        narration:
          'Around 3000 BCE, Austronesian-speaking peoples from Taiwan began history\'s most remarkable maritime expansion. These Neolithic farmers and master sailors would eventually settle islands spanning more than half the Earth\'s circumference.',
        center: [23.5, 121.0],
        zoom: 6,
        bearing: 0,
        timeYear: -3000,
        layers: ['language-ranges', 'archaeological-sites'],
        highlightedFeatures: [],
      },
      {
        narration:
          'By 2000 BCE, Austronesians reached the Philippines and Indonesia. Shared vocabulary for outrigger canoes, sails, and navigation reveals their maritime focus. These languages would become Tagalog, Malay, Javanese, and hundreds more.',
        center: [5.0, 120.0],
        zoom: 4,
        bearing: 0,
        timeYear: -2000,
        layers: ['language-ranges', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'The Lapita culture carried Austronesian languages into Oceania around 1500 BCE, reaching Fiji, Tonga, and Samoa. These became the Polynesian homeland — "Hawaiki" in oral traditions — where the Polynesian branch crystallized.',
        center: [-15.0, 175.0],
        zoom: 4,
        bearing: 0,
        timeYear: -1500,
        layers: ['language-ranges', 'archaeological-sites', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'In an astonishing western voyage, Austronesians crossed the entire Indian Ocean to settle Madagascar around 500 CE. Malagasy is not African but Austronesian — more closely related to languages in Borneo than to any language on the African mainland.',
        center: [-18.9, 47.5],
        zoom: 5,
        bearing: 0,
        timeYear: 500,
        layers: ['language-ranges', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Polynesians reached Hawai\'i (c. 800 CE), Aotearoa/New Zealand (c. 1250 CE), and Rapa Nui/Easter Island (c. 1200 CE). Navigating by stars, ocean swells, and bird flight paths, they settled the most remote inhabited islands on Earth.',
        center: [-10.0, -160.0],
        zoom: 3,
        bearing: 0,
        timeYear: 1200,
        layers: ['language-ranges', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'The Austronesian family now includes over 1,200 languages spoken by 400 million people. From Madagascar to Easter Island, a single family\'s voyaging legacy spans 206 degrees of longitude — the widest of any pre-modern language expansion.',
        center: [0.0, 140.0],
        zoom: 2,
        bearing: 0,
        timeYear: 1300,
        layers: ['language-ranges'],
        highlightedFeatures: [],
      },
    ],
  },
  {
    id: 'mediterranean-world',
    title: 'The Mediterranean World',
    description:
      'Explore the inland sea that connected three continents — where Phoenician alphabets, Greek philosophy, Roman law, and Arabic science shaped the foundations of Western civilization.',
    coverRegion: 'Mediterranean Basin',
    timeSpan: [-1200, 1200],
    steps: [
      {
        narration:
          'The Bronze Age Collapse (c. 1200 BCE) destroyed the Mycenaean, Hittite, and Egyptian empires. From the ashes, new peoples emerged: Phoenicians, Greeks, and Etruscans would reshape the Mediterranean.',
        center: [35.0, 30.0],
        zoom: 5,
        bearing: 0,
        timeYear: -1200,
        layers: ['civilizations', 'settlements', 'battles'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Phoenician merchants from Tyre and Sidon created the first alphabet around 1050 BCE and founded trading colonies across the western Mediterranean. Carthage, their greatest colony, would rival Rome. Their alphabet became the ancestor of Greek, Latin, Arabic, and Hebrew scripts.',
        center: [34.1, 35.6],
        zoom: 5,
        bearing: 0,
        timeYear: -800,
        layers: ['civilizations', 'routes', 'settlements'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Classical Greece (5th century BCE) gave the Mediterranean its intellectual language. Greek became the lingua franca of philosophy, science, and commerce. Alexander\'s conquests later spread it from Egypt to Afghanistan.',
        center: [37.9, 23.7],
        zoom: 5,
        bearing: 0,
        timeYear: -450,
        layers: ['civilizations', 'language-ranges', 'settlements'],
        highlightedFeatures: [],
      },
      {
        narration:
          'Rome unified the Mediterranean politically by 100 BCE. Latin became the administrative language from Britain to Syria. Roman roads, law, and urban planning created a shared culture across three continents.',
        center: [41.9, 12.5],
        zoom: 4,
        bearing: 0,
        timeYear: -100,
        layers: ['civilizations', 'routes', 'language-ranges', 'settlements'],
        highlightedFeatures: [],
      },
      {
        narration:
          'After Rome\'s fall (476 CE), the Mediterranean split. Latin fractured into Romance languages in the west, while Greek survived in the Byzantine east. Germanic kingdoms inherited Roman infrastructure but transformed its culture.',
        center: [41.0, 20.0],
        zoom: 4,
        bearing: 0,
        timeYear: 500,
        layers: ['civilizations', 'language-ranges'],
        highlightedFeatures: [],
      },
      {
        narration:
          'The Arab conquests (7th–8th century) brought Arabic, Islam, and a new golden age of scholarship to the Mediterranean\'s southern shore. For the next 500 years, Arabic scholars preserved Greek knowledge and advanced mathematics, medicine, and astronomy.',
        center: [33.0, 35.0],
        zoom: 4,
        bearing: 0,
        timeYear: 800,
        layers: ['civilizations', 'religions', 'language-ranges', 'routes'],
        highlightedFeatures: [],
      },
      {
        narration:
          'By 1200 CE, the Mediterranean was a trilingual world: Latin in the west, Greek in the east, Arabic in the south. Trade cities like Venice, Constantinople, and Cairo became multilingual crossroads where ideas flowed freely between civilizations.',
        center: [38.0, 22.0],
        zoom: 4,
        bearing: 0,
        timeYear: 1200,
        layers: ['civilizations', 'language-ranges', 'routes', 'settlements'],
        highlightedFeatures: [],
      },
    ],
  },
];

// ── Helper functions ─────────────────────────────────────────────────

export function formatTourYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function getTourTimeSpanLabel(tour: HistoricalTour): string {
  return `${formatTourYear(tour.timeSpan[0])} \u2013 ${formatTourYear(tour.timeSpan[1])}`;
}

export function getTourStepCount(tour: HistoricalTour): number {
  return tour.steps.length;
}

export function getTourById(id: string): HistoricalTour | undefined {
  return CURATED_TOURS.find((t) => t.id === id);
}
