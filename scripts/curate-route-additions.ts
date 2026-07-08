/**
 * Curate hand-authored migration & trade route additions into committed TSVs for
 * write-back into `lexicons/migration-routes.tsv` and `lexicons/trade-routes.tsv`
 * (US-003, data-population at scale).
 *
 * Unlike the sites/cultures acquire scripts, migration & trade routes are NOT bulk-acquired
 * from a Wikidata class — the class modelling is too inconsistent (Q131569 "human migration"
 * is polluted with treaties) and, crucially, routes need real *geometry* (a GeoJSON
 * `LineString` of waypoints) that Wikidata does not carry. So each route below is
 * hand-curated from a well-documented migration/trade concept, and anchored to a **verified
 * Wikidata QID** (resolved via `wbsearchentities` and confirmed against the entity
 * description) so every row carries genuine provenance (`wikidata_qid` / `source_url` /
 * `retrieved_at` / `confidence` / `sources`) and reconciles against the corpus.
 *
 * This file is the network-free source of truth (like the acquired additions TSVs): running
 * it re-emits the committed additions TSVs deterministically; the write-back + QA gate then
 * operate on those. Waypoint coordinates are `[lng, lat]` approximations of the documented
 * corridor — sensible for the atlas, not survey-grade.
 *
 * Run:  npx tsx scripts/curate-route-additions.ts
 */

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");

/** Retrieval timestamp for the verified-QID lookups (kept fixed for a deterministic file). */
const RETRIEVED_AT = "2026-07-08T00:00:00Z";
/** Confidence for curated, QID-anchored rows on the 0–1 scale (export leaves ≤1 as-is). */
const CONFIDENCE = "0.8";
const SOURCES = '["Wikidata","Wikipedia"]';

/** Build a GeoJSON LineString cell from `[lng, lat]` pairs. */
function line(coords: readonly [number, number][]): string {
  return JSON.stringify({ type: "LineString", coordinates: coords });
}

/** A curated migration route (mirrors migration-routes.tsv columns + provenance). */
interface MigrationRow {
  id: string;
  name: string;
  qid: string;
  route_type: string;
  waypoints: string;
  start_date: string;
  end_date: string;
  peoples: string[];
  languages: string[];
  description: string;
  consequences: string;
}

const MIGRATIONS: MigrationRow[] = [
  { id: "sea-peoples-migration", name: "Sea Peoples Migration", qid: "Q193850", route_type: "invasion",
    waypoints: line([[23, 38], [28, 36], [32, 35], [34, 33], [31, 31]]), start_date: "-1200", end_date: "-1150",
    peoples: ["Sea Peoples"], languages: [],
    description: "Movements of the seafaring Sea Peoples across the eastern Mediterranean, raiding Anatolia, the Levant, and Egypt at the close of the Bronze Age.",
    consequences: "Contributed to the Late Bronze Age collapse; destruction of Hittite and Levantine cities" },
  { id: "hunnic-migration", name: "Hunnic Migration", qid: "Q45813", route_type: "invasion",
    waypoints: line([[70, 45], [55, 47], [40, 47], [30, 47], [20, 47]]), start_date: "370", end_date: "469",
    peoples: ["Huns"], languages: [],
    description: "Westward movement of the nomadic Huns from the Central Asian steppe into the Pontic region and Pannonia, displacing Gothic and other Germanic peoples.",
    consequences: "Triggered the Migration Period; pressured the Western Roman Empire" },
  { id: "vandal-migration", name: "Vandal Migration", qid: "Q42211", route_type: "invasion",
    waypoints: line([[15, 50], [5, 47], [-3, 40], [0, 36], [10, 37]]), start_date: "400", end_date: "435",
    peoples: ["Vandals"], languages: ["got"],
    description: "Migration of the Vandals from Central Europe through Gaul and Iberia into Roman North Africa, where they founded a kingdom centred on Carthage.",
    consequences: "Sack of Rome (455 CE); disruption of Roman grain supply" },
  { id: "lombard-migration", name: "Lombard Migration", qid: "Q130900", route_type: "invasion",
    waypoints: line([[18, 47], [14, 46], [11, 45], [10, 45]]), start_date: "568", end_date: "572",
    peoples: ["Lombards"], languages: [],
    description: "Movement of the Lombards from Pannonia into the Italian peninsula, establishing the Lombard Kingdom in the Po Valley.",
    consequences: "Fragmentation of Byzantine Italy; foundation of the Kingdom of the Lombards" },
  { id: "avar-migration", name: "Avar Migration", qid: "Q68962", route_type: "invasion",
    waypoints: line([[60, 45], [45, 46], [30, 47], [19, 47]]), start_date: "557", end_date: "568",
    peoples: ["Pannonian Avars"], languages: [],
    description: "Migration of the Pannonian Avars from the Eurasian steppe into the Carpathian Basin, where they established the Avar Khaganate.",
    consequences: "Reshaped Central European politics; pressure on Byzantium and the Franks" },
  { id: "bulgar-migration", name: "Bulgar Migration", qid: "Q110117", route_type: "migration",
    waypoints: line([[45, 47], [37, 46], [30, 45], [25, 43]]), start_date: "630", end_date: "681",
    peoples: ["Bulgars"], languages: [],
    description: "Dispersal of the Turkic Bulgars from Old Great Bulgaria on the Pontic steppe into the Balkans and the Volga region.",
    consequences: "Foundation of the First Bulgarian Empire and Volga Bulgaria" },
  { id: "alan-migration", name: "Alan Migration", qid: "Q178054", route_type: "migration",
    waypoints: line([[45, 44], [35, 46], [20, 47], [5, 45], [-4, 40]]), start_date: "370", end_date: "409",
    peoples: ["Alans"], languages: [],
    description: "Westward migration of the Iranian-speaking Alans, driven by the Huns, across Europe with the Vandals into Gaul and Iberia.",
    consequences: "Alanic settlement in Iberia and Gaul; contribution to later Iberian populations" },
  { id: "cuman-kipchak-migration", name: "Cuman-Kipchak Migration", qid: "Q1035516", route_type: "migration",
    waypoints: line([[70, 48], [55, 48], [40, 48], [25, 47]]), start_date: "1000", end_date: "1240",
    peoples: ["Cumans", "Kipchaks"], languages: [],
    description: "Migration of the Turkic Cuman-Kipchak confederation across the Eurasian steppe into the Pontic region and, after the Mongol conquest, into Hungary.",
    consequences: "Dominance of the Cuman steppe (Desht-i Qipchaq); settlement in the Kingdom of Hungary" },
  { id: "pecheneg-migration", name: "Pecheneg Migration", qid: "Q181752", route_type: "migration",
    waypoints: line([[60, 47], [45, 47], [32, 46], [28, 45]]), start_date: "860", end_date: "1091",
    peoples: ["Pechenegs"], languages: [],
    description: "Westward movement of the Turkic Pechenegs from Central Asia across the Pontic steppe to the frontiers of Kievan Rus and Byzantium.",
    consequences: "Long conflict with Rus and Byzantium until defeat at Levounion" },
  { id: "scythian-migration", name: "Scythian Migration", qid: "Q131802", route_type: "migration",
    waypoints: line([[70, 48], [55, 48], [40, 47], [32, 47]]), start_date: "-800", end_date: "-600",
    peoples: ["Scythians"], languages: [],
    description: "Westward migration of the Iranian-speaking Scythians across the Eurasian steppe into the Pontic-Caspian region.",
    consequences: "Formation of Scythian dominance over the Pontic steppe; contact with Greek colonies" },
  { id: "dorian-invasion", name: "Dorian Invasion", qid: "Q987129", route_type: "invasion",
    waypoints: line([[21, 40], [22, 39], [22.5, 37.5]]), start_date: "-1100", end_date: "-1000",
    peoples: ["Dorians"], languages: ["grc"],
    description: "Traditional account of the southward movement of Dorian Greeks into the Peloponnese after the Mycenaean collapse.",
    consequences: "Redistribution of Greek dialects; Dorian settlement of Sparta and Crete" },
  { id: "phrygian-migration", name: "Phrygian Migration", qid: "Q32579", route_type: "migration",
    waypoints: line([[24, 41], [27, 40], [30, 39], [32, 39]]), start_date: "-1200", end_date: "-900",
    peoples: ["Phrygians"], languages: [],
    description: "Migration of the Phrygians from the southern Balkans across the straits into west-central Anatolia.",
    consequences: "Foundation of the Kingdom of Phrygia centred on Gordion" },
  { id: "aramean-migration", name: "Aramean Migration", qid: "Q175064", route_type: "migration",
    waypoints: line([[42, 34], [40, 35], [38, 35], [36, 36]]), start_date: "-1200", end_date: "-900",
    peoples: ["Arameans"], languages: ["arc"],
    description: "Spread of the Semitic-speaking Arameans out of the Syrian steppe into the Levant and Mesopotamia.",
    consequences: "Aramaic became the lingua franca of the Near East" },
  { id: "amorite-migration", name: "Amorite Migration", qid: "Q203507", route_type: "migration",
    waypoints: line([[37, 34], [40, 35], [44, 33], [45, 32]]), start_date: "-2100", end_date: "-1900",
    peoples: ["Amorites"], languages: [],
    description: "Movement of the Semitic-speaking Amorites from the Levant and Syria into Mesopotamia at the end of the third millennium BCE.",
    consequences: "Amorite dynasties across Mesopotamia, including Old Babylon under Hammurabi" },
  { id: "hyksos-migration", name: "Hyksos Migration", qid: "Q192319", route_type: "invasion",
    waypoints: line([[35, 33], [34, 32], [32, 31], [31, 31]]), start_date: "-1800", end_date: "-1650",
    peoples: ["Hyksos"], languages: [],
    description: "Infiltration and settlement of West Semitic Hyksos peoples into the eastern Nile Delta, culminating in their rule as Egypt's Fifteenth Dynasty.",
    consequences: "Introduced the composite bow and horse-drawn chariot to Egypt" },
  { id: "mfecane-migration", name: "Mfecane", qid: "Q865081", route_type: "migration",
    waypoints: line([[31, -29], [29, -27], [28, -30], [26, -26]]), start_date: "1815", end_date: "1840",
    peoples: ["Zulu", "Nguni", "Sotho"], languages: ["zul", "xho"],
    description: "Period of widespread upheaval and forced migration among southern African peoples associated with the rise of the Zulu kingdom.",
    consequences: "Depopulation and reorganisation of the interior; formation of new states (Sotho, Ndebele, Swazi)" },
  { id: "fulani-expansion", name: "Fulani Expansion", qid: "Q202575", route_type: "migration",
    waypoints: line([[-15, 15], [-5, 14], [5, 13], [14, 12]]), start_date: "1200", end_date: "1800",
    peoples: ["Fula"], languages: ["ful"],
    description: "Eastward pastoral expansion of the Fula (Fulani) people across the Sahel from Senegambia toward Lake Chad.",
    consequences: "Spread of Islam and pastoralism; Fulani jihad states of the 18th–19th centuries" },
  { id: "malagasy-settlement", name: "Austronesian Settlement of Madagascar", qid: "Q310983", route_type: "maritime",
    waypoints: line([[114, -2], [95, -5], [73, -5], [50, -15], [47, -19]]), start_date: "400", end_date: "900",
    peoples: ["Malagasy"], languages: ["mlg"],
    description: "Trans-Indian Ocean voyage of Austronesian seafarers from Borneo to Madagascar, the westernmost Austronesian settlement.",
    consequences: "Austronesian language and crops (rice, banana) established off the African coast" },
  { id: "guanche-settlement", name: "Guanche Settlement of the Canary Islands", qid: "Q219995", route_type: "maritime",
    waypoints: line([[-9, 30], [-14, 28.5], [-16, 28.3]]), start_date: "-1000", end_date: "100",
    peoples: ["Guanches"], languages: ["ber"],
    description: "Settlement of the Canary Islands by Berber Guanche peoples from northwest Africa.",
    consequences: "Isolated Neolithic-level society encountered by Europeans in the 14th–15th centuries" },
  { id: "nabataean-migration", name: "Nabataean Migration", qid: "Q220594", route_type: "migration",
    waypoints: line([[45, 25], [40, 28], [36, 30], [35.4, 30.3]]), start_date: "-600", end_date: "-300",
    peoples: ["Nabataeans"], languages: ["arc"],
    description: "Movement of the nomadic Nabataean Arabs into the Transjordan and northern Arabia, settling around Petra.",
    consequences: "Control of the incense trade; foundation of the Nabataean Kingdom" },
  { id: "great-trek", name: "Great Trek", qid: "Q338949", route_type: "colonization",
    waypoints: line([[18.4, -33.9], [24, -30], [26, -29], [28, -26], [31, -24]]), start_date: "1836", end_date: "1852",
    peoples: ["Boers"], languages: ["afr"],
    description: "Eastward and northward migration of Dutch-descended Boer Voortrekkers from the British Cape Colony into the South African interior.",
    consequences: "Foundation of the Boer republics; conflict with Zulu and Ndebele" },
  { id: "oregon-trail-migration", name: "Oregon Trail Migration", qid: "Q862312", route_type: "colonization",
    waypoints: line([[-94.6, 39.1], [-100, 41], [-106, 42], [-111, 42], [-116, 44], [-122.7, 45.5]]), start_date: "1841", end_date: "1869",
    peoples: ["American settlers"], languages: ["eng"],
    description: "Overland wagon migration of settlers from the Missouri River across the Great Plains and Rockies to the Oregon Country.",
    consequences: "American settlement of the Pacific Northwest; displacement of Indigenous nations" },
  { id: "california-gold-rush", name: "California Gold Rush Migration", qid: "Q17550", route_type: "migration",
    waypoints: line([[-90, 38], [-100, 39], [-115, 37], [-121, 38.5]]), start_date: "1848", end_date: "1855",
    peoples: ["prospectors"], languages: ["eng", "cmn"],
    description: "Mass migration of prospectors from across the world to the goldfields of northern California.",
    consequences: "Explosive growth of San Francisco; California statehood; devastation of Native Californians" },
  { id: "dust-bowl-migration", name: "Dust Bowl Migration", qid: "Q726501", route_type: "migration",
    waypoints: line([[-100, 36], [-108, 35], [-115, 35], [-119, 36]]), start_date: "1930", end_date: "1940",
    peoples: ["Okies"], languages: ["eng"],
    description: "Displacement of farming families from the drought-stricken southern Great Plains toward California during the 1930s.",
    consequences: "Roughly 2.5 million left the Plains; reshaped Californian agriculture and politics" },
  { id: "italian-diaspora", name: "Italian Diaspora", qid: "Q1675084", route_type: "diaspora",
    waypoints: line([[12, 42], [0, 40], [-30, 10], [-58, -34]]), start_date: "1870", end_date: "1970",
    peoples: ["Italians"], languages: ["ita"],
    description: "Large-scale emigration of Italians, especially to the Americas, from the late 19th to mid-20th centuries.",
    consequences: "Major Italian communities in Argentina, Brazil, and the United States" },
  { id: "volga-german-migration", name: "Volga German Migration", qid: "Q312574", route_type: "colonization",
    waypoints: line([[9, 50], [20, 52], [35, 52], [46, 51]]), start_date: "1763", end_date: "1767",
    peoples: ["Germans"], languages: ["deu"],
    description: "Migration of German colonists to the lower Volga region at the invitation of Catherine the Great.",
    consequences: "Established the Volga German community, later deported under Stalin" },
  { id: "huguenot-diaspora", name: "Huguenot Diaspora", qid: "Q101935", route_type: "diaspora",
    waypoints: line([[2, 48], [4, 51], [0, 52], [13, 52]]), start_date: "1685", end_date: "1710",
    peoples: ["Huguenots"], languages: ["fra"],
    description: "Flight of French Calvinist Huguenots after the Revocation of the Edict of Nantes, into the Dutch Republic, England, Prussia, and the Cape.",
    consequences: "Transfer of skills and capital out of France; Huguenot communities across Protestant Europe" },
  { id: "sephardic-expulsion", name: "Sephardic Jewish Expulsion", qid: "Q1061030", route_type: "diaspora",
    waypoints: line([[-4, 40], [3, 41], [12, 37], [28, 41]]), start_date: "1492", end_date: "1497",
    peoples: ["Sephardi Jews"], languages: ["lad"],
    description: "Expulsion of Jews from Spain (1492) and Portugal (1497) and their dispersal across the Mediterranean and the Ottoman Empire.",
    consequences: "Sephardic communities in the Ottoman lands, North Africa, and the Netherlands; spread of Ladino" },
  { id: "palestinian-exodus-1948", name: "1948 Palestinian Exodus", qid: "Q13220089", route_type: "refugee",
    waypoints: line([[35, 32], [35.9, 31.9], [36, 33], [35.5, 33.9]]), start_date: "1948", end_date: "1949",
    peoples: ["Palestinians"], languages: ["ara"],
    description: "Flight and expulsion of Palestinian Arabs during the 1948 Arab-Israeli War into neighbouring states and the West Bank and Gaza.",
    consequences: "Creation of a long-term Palestinian refugee population; enduring regional conflict" },
  { id: "vietnamese-boat-people", name: "Vietnamese Boat People", qid: "Q6449297", route_type: "refugee",
    waypoints: line([[106, 10], [104, 9], [101, 3], [104, 1]]), start_date: "1975", end_date: "1995",
    peoples: ["Vietnamese"], languages: ["vie"],
    description: "Maritime flight of refugees from Vietnam after the fall of Saigon, across the South China Sea to Southeast Asian camps and resettlement abroad.",
    consequences: "Large Vietnamese diaspora in the US, Australia, France, and Canada" },
  { id: "mariel-boatlift", name: "Mariel Boatlift", qid: "Q1776480", route_type: "refugee",
    waypoints: line([[-82.4, 23], [-81, 24], [-80.2, 25.8]]), start_date: "1980", end_date: "1980",
    peoples: ["Cubans"], languages: ["spa"],
    description: "Mass emigration of roughly 125,000 Cubans by boat from Mariel harbour to Florida in 1980.",
    consequences: "Reshaped the Cuban-American community of South Florida" },
  { id: "european-migrant-crisis", name: "European Migrant Crisis", qid: "Q20857240", route_type: "refugee",
    waypoints: line([[36, 34], [28, 37], [22, 40], [16, 46], [13, 52]]), start_date: "2015", end_date: "2016",
    peoples: ["Syrians", "Afghans", "Iraqis"], languages: ["ara", "prs"],
    description: "Surge of refugees and migrants, chiefly from Syria, crossing the Mediterranean and the Balkans into the European Union.",
    consequences: "Political crisis over EU asylum policy; strain on the Schengen system" },
  { id: "bracero-migration", name: "Bracero Program Migration", qid: "Q979772", route_type: "labor",
    waypoints: line([[-103, 20], [-106, 28], [-110, 32], [-118, 34]]), start_date: "1942", end_date: "1964",
    peoples: ["Mexicans"], languages: ["spa"],
    description: "Managed labour migration of millions of Mexican farm workers (braceros) to the United States between 1942 and 1964.",
    consequences: "Entrenched patterns of Mexican migration to US agriculture" },
  { id: "ostrogoth-migration", name: "Ostrogothic Migration", qid: "Q103122", route_type: "invasion",
    waypoints: line([[19, 47], [15, 46], [12, 45], [12.5, 41.9]]), start_date: "488", end_date: "493",
    peoples: ["Ostrogoths"], languages: ["got"],
    description: "Movement of the Ostrogoths under Theodoric from Pannonia into Italy, where they overthrew Odoacer.",
    consequences: "Foundation of the Ostrogothic Kingdom of Italy" },
  { id: "visigoth-migration", name: "Visigothic Migration", qid: "Q23693", route_type: "invasion",
    waypoints: line([[25, 43], [15, 44], [5, 44], [-1, 43], [-4, 40]]), start_date: "376", end_date: "507",
    peoples: ["Visigoths"], languages: ["got"],
    description: "Migration of the Visigoths from the lower Danube through Italy and Gaul into Iberia, founding a kingdom centred on Toledo.",
    consequences: "Sack of Rome (410 CE); the Visigothic Kingdom of Hispania" },
  { id: "suebi-migration", name: "Suebic Migration", qid: "Q155085", route_type: "invasion",
    waypoints: line([[12, 50], [2, 46], [-4, 42], [-8, 42]]), start_date: "406", end_date: "409",
    peoples: ["Suebi"], languages: [],
    description: "Migration of the Suebi across the Rhine and through Gaul into northwestern Iberia, where they founded a kingdom in Galicia.",
    consequences: "Kingdom of the Suebi (Gallaecia), among the first post-Roman Germanic states" },
  { id: "burgundian-migration", name: "Burgundian Migration", qid: "Q150412", route_type: "invasion",
    waypoints: line([[15, 54], [8, 49], [6, 47], [5, 45]]), start_date: "406", end_date: "457",
    peoples: ["Burgundians"], languages: [],
    description: "Migration of the Burgundians from the Baltic and Central Europe into the Rhône valley, founding the Kingdom of the Burgundians.",
    consequences: "Burgundian settlement giving its name to the Burgundy region" },
  { id: "anglo-saxon-settlement", name: "Anglo-Saxon Settlement of Britain", qid: "Q3435247", route_type: "invasion",
    waypoints: line([[8, 54], [5, 53], [1, 52], [-1, 51.5], [-2, 52]]), start_date: "450", end_date: "600",
    peoples: ["Angles", "Saxons", "Jutes"], languages: ["ang"],
    description: "Migration and settlement of Angles, Saxons, and Jutes from the North Sea coast into lowland Britain after Roman withdrawal.",
    consequences: "Emergence of the Anglo-Saxon kingdoms and the English language" },
  { id: "khazar-migration", name: "Khazar Migration", qid: "Q173282", route_type: "migration",
    waypoints: line([[60, 45], [50, 46], [47, 45], [45, 43]]), start_date: "600", end_date: "650",
    peoples: ["Khazars"], languages: [],
    description: "Westward movement of the Turkic Khazars into the North Caucasus and lower Volga, where they built the Khazar Khaganate.",
    consequences: "A powerful steppe state buffering Byzantium and the Caliphate; elite conversion to Judaism" },
  { id: "nilotic-expansion", name: "Nilotic Expansion", qid: "Q664262", route_type: "migration",
    waypoints: line([[31, 7], [33, 4], [34, 1], [35, -1]]), start_date: "1000", end_date: "1600",
    peoples: ["Nilotes"], languages: ["luo", "mas"],
    description: "Southward migration of Nilotic pastoralist peoples from the southern Sudan into the East African Great Lakes region.",
    consequences: "Spread of cattle pastoralism and Nilotic languages across East Africa" },
  { id: "yamnaya-migration", name: "Yamnaya Steppe Migration", qid: "Q426737", route_type: "migration",
    waypoints: line([[45, 48], [35, 49], [25, 50], [15, 51], [9, 52]]), start_date: "-3300", end_date: "-2600",
    peoples: ["Yamnaya"], languages: [],
    description: "Expansion of Yamnaya steppe herders from the Pontic-Caspian steppe into Central and Northern Europe, carrying steppe ancestry.",
    consequences: "Major genetic turnover in Europe; associated with the spread of Indo-European languages" },
  { id: "bell-beaker-spread", name: "Bell Beaker Diffusion", qid: "Q470867", route_type: "migration",
    waypoints: line([[-6, 40], [2, 45], [7, 49], [0, 52], [-2, 52]]), start_date: "-2800", end_date: "-2300",
    peoples: ["Beaker people"], languages: [],
    description: "Spread of the Bell Beaker cultural package across Western Europe, reaching Britain with substantial population replacement.",
    consequences: "Near-complete genetic turnover in Britain; wide distribution of Beaker material culture" },
];

/** A curated trade route (mirrors trade-routes.tsv columns + provenance). */
interface TradeRow {
  id: string;
  name: string;
  qid: string;
  route_type: string;
  waypoints: string;
  start_date: string;
  end_date: string;
  traded_goods: string[];
  key_cities: string[];
  controlling_powers: string[];
  languages: string[];
  description: string;
  economic_impact: string;
}

const TRADE_ROUTES: TradeRow[] = [
  { id: "tr-026", name: "Persian Royal Road", qid: "Q220796", route_type: "land",
    waypoints: line([[52, 37], [48, 36], [44, 38], [40, 39], [35, 39], [30, 38], [27, 38]]), start_date: "-500", end_date: "-330",
    traded_goods: ["royal dispatches", "textiles", "silver"], key_cities: ["Susa", "Arbela", "Sardis"],
    controlling_powers: ["Achaemenid Empire"], languages: ["peo", "arc"],
    description: "The Achaemenid highway from Susa to Sardis, with relay stations enabling rapid royal courier and caravan travel across the Persian Empire.",
    economic_impact: "Integrated the Persian economy; model for later imperial road systems" },
  { id: "tr-027", name: "Via Egnatia", qid: "Q273783", route_type: "land",
    waypoints: line([[19.5, 41.3], [21, 41], [22.9, 40.6], [24.5, 40.9], [28.9, 41.0]]), start_date: "-146", end_date: "1400",
    traded_goods: ["grain", "wine", "slaves", "textiles"], key_cities: ["Dyrrachium", "Thessalonica", "Constantinople"],
    controlling_powers: ["Roman Republic", "Roman Empire", "Byzantine Empire"], languages: ["lat", "grc"],
    description: "The Roman road across the southern Balkans linking the Adriatic to Byzantium, extending the Appian Way eastward.",
    economic_impact: "Principal overland artery between Rome and the East; military and commercial spine of the Balkans" },
  { id: "tr-028", name: "Via Maris", qid: "Q546068", route_type: "land",
    waypoints: line([[31, 31], [34, 31.3], [35, 32.7], [36, 34], [37, 36]]), start_date: "-2000", end_date: "1500",
    traded_goods: ["spices", "grain", "metals", "cedar"], key_cities: ["Gaza", "Megiddo", "Damascus"],
    controlling_powers: ["Egypt", "Assyria", "Rome"], languages: ["egy", "arc"],
    description: "The coastal 'way of the sea' linking Egypt with the Levant and Mesopotamia, one of the oldest trade and military roads of the Near East.",
    economic_impact: "Connected the great Bronze Age economies; contested by every regional power" },
  { id: "tr-029", name: "Appian Way", qid: "Q189417", route_type: "land",
    waypoints: line([[12.5, 41.9], [13.2, 41.3], [14.8, 40.9], [16, 40.6], [17.9, 40.6]]), start_date: "-312", end_date: "500",
    traded_goods: ["marble", "wine", "oil", "grain"], key_cities: ["Rome", "Capua", "Brundisium"],
    controlling_powers: ["Roman Republic", "Roman Empire"], languages: ["lat"],
    description: "The 'queen of roads' from Rome to Brundisium, Rome's principal southeastern land route to Greece and the East.",
    economic_impact: "Backbone of Roman commercial and military movement in southern Italy" },
  { id: "tr-030", name: "Steppe Route", qid: "Q30592581", route_type: "land",
    waypoints: line([[35, 48], [55, 50], [75, 50], [95, 48], [110, 45]]), start_date: "-1000", end_date: "1300",
    traded_goods: ["furs", "horses", "metalwork", "gold"], key_cities: ["Panticapaeum", "Otrar", "Karakorum"],
    controlling_powers: ["Scythians", "Xiongnu", "Mongol Empire"], languages: [],
    description: "The ancient overland corridor across the Eurasian steppe, precursor to the Silk Road, carrying goods between the Black Sea and Mongolia.",
    economic_impact: "Earliest trans-Eurasian exchange; diffusion of metallurgy and horse culture" },
  { id: "tr-031", name: "Manila Galleon Route", qid: "Q683846", route_type: "maritime",
    waypoints: line([[120.9, 14.6], [145, 15], [180, 25], [-160, 30], [-125, 35], [-99, 19]]), start_date: "1565", end_date: "1815",
    traded_goods: ["silver", "silk", "porcelain", "spices"], key_cities: ["Manila", "Acapulco"],
    controlling_powers: ["Spanish Empire"], languages: ["spa", "cmn"],
    description: "The Spanish trans-Pacific trade linking Manila to Acapulco, exchanging American silver for Chinese silk and porcelain.",
    economic_impact: "First sustained trans-Pacific trade; funnelled New World silver into the Chinese economy" },
  { id: "tr-032", name: "El Camino Real de Tierra Adentro", qid: "Q911953", route_type: "land",
    waypoints: line([[-99.1, 19.4], [-100.4, 20.6], [-104.9, 21.9], [-106.5, 31.8], [-106, 35.7]]), start_date: "1598", end_date: "1882",
    traded_goods: ["silver", "livestock", "textiles", "hides"], key_cities: ["Mexico City", "Zacatecas", "Santa Fe"],
    controlling_powers: ["Spanish Empire", "Mexico"], languages: ["spa"],
    description: "The royal road of the interior linking Mexico City to the silver-mining north and the New Mexican frontier.",
    economic_impact: "Lifeline of the northern silver economy and Spanish colonisation of the Southwest" },
  { id: "tr-033", name: "Via Regia", qid: "Q836028", route_type: "land",
    waypoints: line([[8.7, 50], [11, 51], [13.7, 51.1], [17, 51.1], [24, 50]]), start_date: "1000", end_date: "1700",
    traded_goods: ["cloth", "salt", "metal goods", "wine"], key_cities: ["Frankfurt", "Leipzig", "Wrocław", "Kraków"],
    controlling_powers: ["Holy Roman Empire", "Poland"], languages: ["deu", "pol"],
    description: "The medieval 'royal highway' crossing Central Europe from the Rhineland to Silesia and beyond, a protected imperial road.",
    economic_impact: "Principal east-west trade and pilgrimage axis of medieval Central Europe" },
  { id: "tr-034", name: "Way of the Patriarchs", qid: "Q259222", route_type: "land",
    waypoints: line([[35.3, 32.2], [35.2, 31.9], [35.2, 31.7], [35.1, 31.5]]), start_date: "-1800", end_date: "1500",
    traded_goods: ["grain", "wool", "oil"], key_cities: ["Shechem", "Jerusalem", "Hebron", "Beersheba"],
    controlling_powers: ["Judah", "Rome"], languages: ["hbo", "arc"],
    description: "The central ridge route through the highlands of ancient Israel connecting the patriarchal towns from Shechem to Beersheba.",
    economic_impact: "Internal spine of highland Judea's economy and pilgrimage" },
  { id: "tr-035", name: "Uttarapatha (Northern Road)", qid: "Q3321347", route_type: "land",
    waypoints: line([[91, 23], [88, 25], [83, 25.3], [77, 28.6], [72, 31], [71, 34]]), start_date: "-500", end_date: "1500",
    traded_goods: ["textiles", "spices", "gems", "horses"], key_cities: ["Pataliputra", "Varanasi", "Mathura", "Taxila"],
    controlling_powers: ["Maurya Empire", "Gupta Empire"], languages: ["san", "pra"],
    description: "The great northern route of ancient India across the Gangetic plain toward the northwest, ancestor of the Grand Trunk Road.",
    economic_impact: "Commercial and cultural artery of northern India; carrier of Buddhism northwestward" },
  { id: "tr-036", name: "Dakshinapatha (Southern Road)", qid: "Q5210091", route_type: "land",
    waypoints: line([[78, 25], [77, 21], [75, 18], [74, 16], [77, 12]]), start_date: "-500", end_date: "1500",
    traded_goods: ["gems", "gold", "cotton", "spices"], key_cities: ["Ujjain", "Pratishthana", "Kanchipuram"],
    controlling_powers: ["Satavahana dynasty", "Chalukya"], languages: ["san", "tel", "tam"],
    description: "The southern route of ancient India from the Gangetic north into the Deccan and the Tamil south.",
    economic_impact: "Linked the Deccan and peninsular economies to northern India and the sea trade" },
  { id: "tr-037", name: "Inca Road System (Qhapaq Ñan)", qid: "Q948975", route_type: "land",
    waypoints: line([[-78.5, -0.2], [-79, -8], [-77, -12], [-72, -13.5], [-68, -16.5], [-70.3, -18]]), start_date: "1200", end_date: "1533",
    traded_goods: ["textiles", "maize", "coca", "metals"], key_cities: ["Quito", "Cajamarca", "Cusco", "Tiwanaku"],
    controlling_powers: ["Inca Empire"], languages: ["que", "ay"],
    description: "The vast Andean road network of the Inca Empire, some 40,000 km linking Quito to central Chile via relay runners (chasquis).",
    economic_impact: "Integrated the Andean empire; enabled redistribution of tribute and rapid state communication" },
  { id: "tr-038", name: "Nakasendō", qid: "Q1154479", route_type: "land",
    waypoints: line([[139.77, 35.7], [138.6, 36.3], [137.6, 36], [136.9, 35.4], [135.77, 34.98]]), start_date: "1600", end_date: "1868",
    traded_goods: ["rice", "silk", "lacquerware", "tea"], key_cities: ["Edo", "Karuizawa", "Nakatsugawa", "Kyoto"],
    controlling_powers: ["Tokugawa Shogunate"], languages: ["jpn"],
    description: "The inland 'central mountain route' of Edo-period Japan connecting Edo (Tokyo) and Kyoto through the mountains.",
    economic_impact: "One of the Five Routes integrating Tokugawa Japan's post-town commercial economy" },
  { id: "tr-039", name: "Tōkaidō", qid: "Q963514", route_type: "land",
    waypoints: line([[139.77, 35.68], [139.2, 35.2], [138.4, 34.8], [137, 34.75], [135.77, 34.98]]), start_date: "1600", end_date: "1868",
    traded_goods: ["rice", "textiles", "seafood", "tea"], key_cities: ["Edo", "Hakone", "Nagoya", "Kyoto"],
    controlling_powers: ["Tokugawa Shogunate"], languages: ["jpn"],
    description: "The coastal 'eastern sea route' between Edo and Kyoto, the busiest of the Five Routes of Tokugawa Japan.",
    economic_impact: "Principal artery of Edo-period travel and commerce; subject of Hiroshige's famous prints" },
];

/** Assemble one output TSV from a header + row-cell function over the curated records. */
function serialize<T>(
  header: readonly string[],
  records: readonly T[],
  cells: (r: T) => Record<string, string>,
): string {
  const lines = [header.join("\t")];
  const sorted = [...records].sort((a, b) => {
    const ai = cells(a).id;
    const bi = cells(b).id;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  for (const r of sorted) {
    const c = cells(r);
    lines.push(header.map((h) => c[h] ?? "").join("\t"));
  }
  return lines.join("\n") + "\n";
}

function main(): void {
  const migrationHeader = [
    "id", "name", "route_type", "waypoints", "start_date", "end_date",
    "peoples", "associated_languages", "description", "consequences",
    "confidence", "sources", "wikidata_qid", "source_url", "retrieved_at",
  ];
  const migrationTsv = serialize(migrationHeader, MIGRATIONS, (r) => ({
    id: r.id,
    name: r.name,
    route_type: r.route_type,
    waypoints: r.waypoints,
    start_date: r.start_date,
    end_date: r.end_date,
    peoples: JSON.stringify(r.peoples),
    associated_languages: JSON.stringify(r.languages),
    description: r.description,
    consequences: r.consequences,
    confidence: CONFIDENCE,
    sources: SOURCES,
    wikidata_qid: r.qid,
    source_url: `http://www.wikidata.org/entity/${r.qid}`,
    retrieved_at: RETRIEVED_AT,
  }));

  const tradeHeader = [
    "id", "name", "route_type", "waypoints", "start_date", "end_date",
    "traded_goods", "key_cities", "controlling_powers", "associated_languages",
    "description", "economic_impact",
    "confidence", "sources", "wikidata_qid", "source_url", "retrieved_at",
  ];
  const tradeTsv = serialize(tradeHeader, TRADE_ROUTES, (r) => ({
    id: r.id,
    name: r.name,
    route_type: r.route_type,
    waypoints: r.waypoints,
    start_date: r.start_date,
    end_date: r.end_date,
    traded_goods: JSON.stringify(r.traded_goods),
    key_cities: JSON.stringify(r.key_cities),
    controlling_powers: JSON.stringify(r.controlling_powers),
    associated_languages: JSON.stringify(r.languages),
    description: r.description,
    economic_impact: r.economic_impact,
    confidence: CONFIDENCE,
    sources: SOURCES,
    wikidata_qid: r.qid,
    source_url: `http://www.wikidata.org/entity/${r.qid}`,
    retrieved_at: RETRIEVED_AT,
  }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "migration-routes-additions.tsv"), migrationTsv);
  fs.writeFileSync(path.join(DATA_DIR, "trade-routes-additions.tsv"), tradeTsv);

  // eslint-disable-next-line no-console
  console.log(
    `Curated ${MIGRATIONS.length} migration routes → migration-routes-additions.tsv, ` +
      `${TRADE_ROUTES.length} trade routes → trade-routes-additions.tsv`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main();
}
