/**
 * Curate hand-authored myth/folklore motif additions into a committed TSV for write-back into
 * `lexicons/myth-motifs.tsv` (US-005, data-population at scale).
 *
 * Unlike the bulk-acquire domains in acquire-cultural-domains.ts, myth motifs are NOT bulk-acquired
 * from a Wikidata class: the narrative-motif class (Q1697305) is badly polluted with modern tropes
 * (denazification, "think of the children", grey aliens…), so a class sweep can't be curated to a
 * credible set. Instead each motif below is a well-attested cross-cultural motif anchored to a
 * **verified Wikidata QID** (resolved via `wbsearchentities` and confirmed against the entity label
 * + description) so every row carries genuine provenance and reconciles against the corpus — the
 * same offline-curation pattern as curate-route-additions.ts.
 *
 * This file is the network-free source of truth: running it re-emits the committed additions TSV
 * deterministically; the `--add-rows` write-back + QA gate then operate on that.
 *
 * Run:  npx tsx scripts/curate-myth-motifs.ts
 */

import fs from "node:fs";
import path from "node:path";
import { confidenceCellForClass } from "@contracts/confidence-rubric";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "scripts", "data");

/** Fixed retrieval timestamp for the verified-QID lookups (deterministic file). */
const RETRIEVED_AT = "2026-07-08T00:00:00Z";
/** Confidence for curated, QID-anchored rows on the 0–1 scale (export leaves ≤1 as-is). */
// `curated-verified` (0.8) — hand-picked motifs, each anchored to a manually verified QID;
// confidence comes from the rubric, not a literal (US-001).
const CONFIDENCE = confidenceCellForClass("curated-verified");
const SOURCES = '["Wikidata","Stith Thompson Motif-Index"]';

/** A curated myth motif (mirrors myth-motifs.tsv columns + provenance). */
interface MotifRow {
  id: string;
  name: string;
  qid: string;
  motif_type: string;
  description: string;
  /** Broad culture areas the motif is attested in. */
  distribution: string[];
  /** Approximate earliest attestation (signed year). */
  time_depth: string;
}

const MOTIFS: MotifRow[] = [
  { id: "tower-of-babel", name: "Tower of Babel", qid: "Q41213", motif_type: "origin",
    description: "A unified humanity building a tower to heaven is scattered when a deity confounds their single language into many, explaining linguistic diversity and punishing hubris.",
    distribution: ["Near East", "Mediterranean"], time_depth: "-600" },
  { id: "fountain-of-youth", name: "Fountain of Youth", qid: "Q775332", motif_type: "object",
    description: "A magical spring or water that restores youth and health to those who drink from or bathe in it, sought by heroes and explorers across many traditions.",
    distribution: ["Global"], time_depth: "-500" },
  { id: "wild-hunt", name: "The Wild Hunt", qid: "Q841437", motif_type: "spectral",
    description: "A ghostly procession of huntsmen, hounds, and spirits sweeping across the night sky, an omen of catastrophe or death in northern European folklore.",
    distribution: ["Northern Europe"], time_depth: "500" },
  { id: "swan-maiden", name: "The Swan Maiden", qid: "Q1326754", motif_type: "transformation",
    description: "A shapeshifting woman who can take the form of a swan (or other bird) and is bound to a mortal husband when he hides her feather garment.",
    distribution: ["Eurasia"], time_depth: "-1000" },
  { id: "vagina-dentata", name: "Vagina Dentata", qid: "Q1123830", motif_type: "taboo",
    description: "A motif of a toothed vagina posing danger to men, expressing anxieties about sexuality and requiring a hero to render it harmless.",
    distribution: ["Global"], time_depth: "-1000" },
  { id: "therianthropy", name: "Therianthropy", qid: "Q1149649", motif_type: "transformation",
    description: "The mythological ability of humans to metamorphose into animals, encompassing werewolves and other were-creatures across world folklore.",
    distribution: ["Global"], time_depth: "-3000" },
  { id: "seven-league-boots", name: "Seven-League Boots", qid: "Q2282444", motif_type: "object",
    description: "Enchanted boots that allow the wearer to stride seven leagues at a step, a common magical-transport object in European fairy tales.",
    distribution: ["Europe"], time_depth: "1600" },
  { id: "philosophers-stone", name: "The Philosopher's Stone", qid: "Q182053", motif_type: "alchemy",
    description: "A legendary alchemical substance able to transmute base metals into gold and confer immortality, the central goal of alchemical mythology.",
    distribution: ["Eurasia", "North Africa"], time_depth: "300" },
  { id: "holy-grail", name: "The Holy Grail", qid: "Q162808", motif_type: "quest",
    description: "A sacred vessel with miraculous powers whose pursuit structures the Arthurian quest, blending Christian relic and older cauldron-of-plenty motifs.",
    distribution: ["Western Europe"], time_depth: "1100" },
  { id: "cosmic-ocean", name: "The Cosmic Ocean", qid: "Q5174141", motif_type: "cosmology",
    description: "A primeval sea of formless water from which the ordered world emerges, a widespread creation setting preceding the making of land and sky.",
    distribution: ["Global"], time_depth: "-2500" },
  { id: "green-man", name: "The Green Man", qid: "Q1460159", motif_type: "nature",
    description: "A face formed of or surrounded by foliage, symbolising vegetative rebirth and the cycle of the seasons in art and folklore.",
    distribution: ["Europe", "Near East"], time_depth: "100" },
  { id: "mermaid-motif", name: "The Mermaid", qid: "Q182559", motif_type: "creature",
    description: "A being with a woman's upper body and a fish's tail, luring or aiding sailors, found in coastal mythologies around the world.",
    distribution: ["Global"], time_depth: "-1000" },
  { id: "leviathan", name: "Leviathan", qid: "Q192677", motif_type: "creature",
    description: "A vast primordial sea monster embodying chaos, subdued or slain by a deity — a Near Eastern chaoskampf motif echoed across cultures.",
    distribution: ["Near East"], time_depth: "-1200" },
  { id: "ouroboros", name: "Ouroboros", qid: "Q237970", motif_type: "symbol",
    description: "A serpent or dragon devouring its own tail, symbolising cyclic eternity, renewal, and the unity of beginning and end.",
    distribution: ["Egypt", "Eurasia"], time_depth: "-1300" },
  { id: "evil-eye", name: "The Evil Eye", qid: "Q1020115", motif_type: "curse",
    description: "A malevolent glare believed to cause misfortune, illness, or death, warded off by amulets and gestures across the Mediterranean and beyond.",
    distribution: ["Mediterranean", "Near East", "South Asia"], time_depth: "-2000" },
  { id: "changeling", name: "The Changeling", qid: "Q1127246", motif_type: "creature",
    description: "A fairy or spirit substituted for a human infant, explaining sudden change in a child and prompting rituals to recover the stolen original.",
    distribution: ["Europe"], time_depth: "800" },
  { id: "land-of-cockaigne", name: "Land of Cockaigne", qid: "Q6645", motif_type: "place",
    description: "A mythical land of ease and plenty where food is abundant and labour needless, an inverted-world motif of medieval and later folklore.",
    distribution: ["Europe"], time_depth: "1100" },
  { id: "axis-mundi", name: "Axis Mundi", qid: "Q1421259", motif_type: "cosmology",
    description: "A world centre or cosmic axis — mountain, pillar, or tree — connecting sky, earth, and underworld and orienting sacred space.",
    distribution: ["Global"], time_depth: "-3000" },
  { id: "cornucopia", name: "The Cornucopia", qid: "Q332682", motif_type: "object",
    description: "The horn of plenty overflowing with produce, a classical symbol of inexhaustible abundance and nourishment.",
    distribution: ["Mediterranean"], time_depth: "-700" },
  { id: "doppelganger", name: "The Doppelgänger", qid: "Q461363", motif_type: "double",
    description: "A ghostly or supernatural double of a living person, whose appearance is often an omen of misfortune or death.",
    distribution: ["Europe"], time_depth: "1500" },
  { id: "unicorn", name: "The Unicorn", qid: "Q7246", motif_type: "creature",
    description: "A horse-like beast with a single spiralling horn, emblem of purity whose horn was believed to neutralise poison.",
    distribution: ["Eurasia"], time_depth: "-400" },
  { id: "griffin", name: "The Griffin", qid: "Q130223", motif_type: "creature",
    description: "A composite guardian beast with a lion's body and an eagle's head and wings, protector of treasure across Near Eastern and classical art.",
    distribution: ["Near East", "Mediterranean"], time_depth: "-3000" },
  { id: "cockatrice", name: "The Cockatrice", qid: "Q1371084", motif_type: "creature",
    description: "A serpentine beast said to kill with a glance or breath, hatched from a cock's egg — a lethal-gaze motif of European bestiaries.",
    distribution: ["Europe"], time_depth: "1200" },
  { id: "magic-carpet", name: "The Magic Carpet", qid: "Q740881", motif_type: "object",
    description: "An enchanted carpet that flies its rider to distant places instantly, a magical-transport motif prominent in Near Eastern tales.",
    distribution: ["Near East"], time_depth: "800" },
  { id: "golem", name: "The Golem", qid: "Q215085", motif_type: "creature",
    description: "An animated anthropomorphic being formed from clay and brought to life by sacred words, protector and cautionary figure of Jewish folklore.",
    distribution: ["Central Europe", "Near East"], time_depth: "1200" },
  { id: "kraken", name: "The Kraken", qid: "Q193165", motif_type: "creature",
    description: "A colossal sea monster of the northern seas capable of dragging ships beneath the waves, a maritime terror of Scandinavian folklore.",
    distribution: ["Northern Europe"], time_depth: "1200" },
  { id: "magic-cauldron", name: "The Magic Cauldron", qid: "Q115833959", motif_type: "object",
    description: "A vessel of endless plenty, rebirth, or wisdom — reviving the dead or never emptying — a Celtic and wider Indo-European motif.",
    distribution: ["Western Europe"], time_depth: "-500" },
  { id: "jinn", name: "The Jinn", qid: "Q3465", motif_type: "spirit",
    description: "Supernatural spirits of smokeless fire inhabiting a parallel world, capable of aiding or harming humans, central to Arabian and Islamic lore.",
    distribution: ["Near East", "North Africa"], time_depth: "-500" },
  { id: "basilisk", name: "The Basilisk", qid: "Q152519", motif_type: "creature",
    description: "A legendary reptile called the king of serpents, whose lethal gaze and venom made it a lethal-glance motif of European mythology.",
    distribution: ["Mediterranean", "Europe"], time_depth: "-100" },
];

/** Assemble the output TSV from a header + per-record cell map. */
function serialize(header: readonly string[], records: readonly MotifRow[]): string {
  const lines = [header.join("\t")];
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of sorted) {
    const c: Record<string, string> = {
      id: r.id,
      name: r.name,
      motif_type: r.motif_type,
      atu_index: "",
      description: r.description,
      examples: "",
      associated_religion_ids: "",
      associated_deity_ids: "",
      geographic_distribution: JSON.stringify(r.distribution),
      time_depth: r.time_depth,
      sources: SOURCES,
      confidence: CONFIDENCE,
      wikidata_qid: r.qid,
      source_url: `http://www.wikidata.org/entity/${r.qid}`,
      retrieved_at: RETRIEVED_AT,
    };
    lines.push(header.map((h) => c[h] ?? "").join("\t"));
  }
  return lines.join("\n") + "\n";
}

function main(): void {
  const header = [
    "id", "name", "motif_type", "atu_index", "description", "examples",
    "associated_religion_ids", "associated_deity_ids", "geographic_distribution", "time_depth",
    "sources", "confidence", "wikidata_qid", "source_url", "retrieved_at",
  ];
  const tsv = serialize(header, MOTIFS);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "myth-motifs-additions.tsv"), tsv);
  // eslint-disable-next-line no-console
  console.log(`Curated ${MOTIFS.length} myth motifs → myth-motifs-additions.tsv`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  main();
}
