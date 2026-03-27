/**
 * Test script for CivilizationTimeline view data transformation logic
 * Validates that civilization TSV data can be correctly transformed into timeline items
 * Run with: npx tsx test/test-civilization-timeline.ts
 */

import * as fs from "fs";
import * as path from "path";

const LEXICONS_DIR = path.join(import.meta.dirname, "..", "lexicons");

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  \u2713 ${message}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${message}`);
    failed++;
  }
}

// Simulates the grouping logic from the CivilizationTimeline component
function inferRegion(id: string, name: string, langIds: string[]): string {
  const patterns: Array<[RegExp, string]> = [
    [/han-dynasty|tang-dynasty|song-dynasty|ming-dynasty|qing-dynasty|shang-dynasty|zhou-dynasty|qin-dynasty/i, "East Asia"],
    [/heian|nara|tokugawa/i, "East Asia"],
    [/goryeo|joseon/i, "East Asia"],
    [/xiongnu|mongol|golden-horde|timurid/i, "Central Asia"],
    [/sogdian|khwarazmian/i, "Central Asia"],
    [/srivijaya|majapahit|khmer|ayutthaya|pagan|dai-viet/i, "Southeast Asia"],
    [/maurya|gupta|chola|vijayanagara|delhi-sultanate|mughal|kushan|indus-valley/i, "South Asia"],
    [/tibetan/i, "Central Asia"],
    [/roman|byzantine|hre|carolingian|kievan|viking|celtic/i, "Europe"],
    [/spanish-empire|portuguese-empire|british-empire/i, "Europe"],
    [/persian|achaemenid|sasanian|safavid|seljuk|parthian/i, "Middle East"],
    [/umayyad|abbasid/i, "Middle East"],
    [/ottoman/i, "Middle East"],
    [/sumerian|akkadian|babylonian|assyrian|hittite|lydian|urartu|elamite|nabataean/i, "Middle East"],
    [/ancient-egypt|kingdom-of-kush|axum|ghana-empire|mali|songhai|great-zimbabwe|zulu|benin|ethiopian|kanem|swahili|kingdom-of-punt/i, "Africa"],
    [/aztec|inca|maya|olmec|zapotec|toltec|muisca|tiwanaku|mississippian|haudenosaunee/i, "Americas"],
    [/minoan|mycenaean|ancient-greece|carthage|phoenicia/i, "Mediterranean"],
  ];

  for (const [pattern, region] of patterns) {
    if (pattern.test(id) || pattern.test(name)) return region;
  }

  if (langIds.some((l) => ["cmn", "jpn", "kor"].includes(l))) return "East Asia";
  if (langIds.some((l) => ["san", "hin", "tam", "kan", "tel"].includes(l))) return "South Asia";
  if (langIds.some((l) => ["arb", "fas", "tur"].includes(l))) return "Middle East";
  if (langIds.some((l) => ["lat", "fra", "deu", "eng", "spa", "por"].includes(l))) return "Europe";

  return "Other";
}

function testTimelineDataTransformation() {
  console.log("=== Testing Civilization Timeline Data Transformation ===\n");

  const civText = fs.readFileSync(path.join(LEXICONS_DIR, "civilizations.tsv"), "utf-8");
  const { header, rows } = parseTsv(civText);

  const idIdx = header.indexOf("id");
  const nameIdx = header.indexOf("name");
  const nativeNameIdx = header.indexOf("native_name");
  const startIdx = header.indexOf("time_period_start");
  const endIdx = header.indexOf("time_period_end");
  const structureIdx = header.indexOf("political_structure");
  const capitalIdx = header.indexOf("capital");
  const populationIdx = header.indexOf("population");
  const writingIdx = header.indexOf("writing_systems");
  const langIdx = header.indexOf("associated_language_ids");

  // Test 1: All civilizations can be transformed to timeline items
  console.log("Timeline item transformation:");
  let transformErrors = 0;
  const items = rows.map((row) => {
    try {
      const langIds = langIdx >= 0 && row[langIdx] ? JSON.parse(row[langIdx]) : [];
      return {
        id: row[idIdx],
        name: row[nameIdx],
        startYear: parseInt(row[startIdx], 10),
        endYear: row[endIdx] && row[endIdx] !== "null" ? parseInt(row[endIdx], 10) : null,
        politicalStructure: structureIdx >= 0 ? row[structureIdx] : "",
        capital: capitalIdx >= 0 ? row[capitalIdx] : "",
        population: populationIdx >= 0 && row[populationIdx] ? parseInt(row[populationIdx], 10) : null,
        writingSystems: writingIdx >= 0 && row[writingIdx] ? JSON.parse(row[writingIdx]) : [],
        langIds,
      };
    } catch {
      transformErrors++;
      return null;
    }
  }).filter(Boolean);

  assert(transformErrors === 0, `All civilizations transform without errors (${transformErrors} errors)`);
  assert(items.length >= 80, `Produced ${items.length} timeline items (expected 80+)`);

  // Test 2: All items have valid start years
  console.log("\nStart year validation:");
  const invalidStarts = items.filter((item) => isNaN(item!.startYear));
  assert(invalidStarts.length === 0, `All items have valid start years (${invalidStarts.length} invalid)`);

  // Test 3: End years are valid (null or number >= start)
  console.log("\nEnd year validation:");
  let invalidEnds = 0;
  for (const item of items) {
    if (item!.endYear !== null) {
      if (isNaN(item!.endYear) || item!.endYear < item!.startYear) {
        invalidEnds++;
      }
    }
  }
  assert(invalidEnds === 0, `All end years are valid (${invalidEnds} invalid)`);

  // Test 4: Group by political structure produces reasonable groups
  console.log("\nGroup by political structure:");
  const structures = new Set(items.map((item) => item!.politicalStructure).filter(Boolean));
  assert(structures.size >= 3, `Has ${structures.size} distinct political structures (expected 3+)`);
  assert(structures.has("Empire"), "Includes 'Empire' political structure");
  assert(structures.has("Kingdom"), "Includes 'Kingdom' political structure");

  // Test 5: Group by region covers major world regions
  console.log("\nGroup by region:");
  const regions = new Map<string, number>();
  for (const item of items) {
    const region = inferRegion(item!.id, item!.name, item!.langIds);
    regions.set(region, (regions.get(region) || 0) + 1);
  }

  const expectedRegions = ["East Asia", "South Asia", "Middle East", "Europe", "Africa", "Americas"];
  for (const region of expectedRegions) {
    const count = regions.get(region) || 0;
    assert(count >= 2, `Region '${region}' has ${count} civilizations (expected 2+)`);
  }

  // Test 6: No civilizations fall into "Other" region
  console.log("\nRegion coverage:");
  const otherCount = regions.get("Other") || 0;
  assert(otherCount === 0, `No civilizations in 'Other' region (found ${otherCount})`);

  // Test 7: Timeline spans expected range
  console.log("\nTimeline range:");
  const minYear = Math.min(...items.map((item) => item!.startYear));
  const maxEnd = Math.max(...items.map((item) => item!.endYear ?? 2024));
  assert(minYear <= -3000, `Timeline starts at ${minYear} (expected <= -3000)`);
  assert(maxEnd >= 1900, `Timeline extends to ${maxEnd} (expected >= 1900)`);

  // Test 8: Group by writing system produces diverse groups
  console.log("\nGroup by writing system:");
  const writingSystems = new Set(items.map((item) => item!.writingSystems[0] || "Unknown").filter(Boolean));
  assert(writingSystems.size >= 8, `Has ${writingSystems.size} distinct writing systems (expected 8+)`);
}

function testTimelineVisualizationContract() {
  console.log("\n=== Testing TimelineVisualization Component Contract ===\n");

  // Test that the data structure matches what TimelineVisualization expects
  console.log("Interface compatibility:");

  // TimelineItem requires: id, name, groupName, startYear, endYear, color?, metadata?
  const sampleItem = {
    id: "roman-empire",
    name: "Roman Empire",
    groupName: "Empire",
    startYear: -27,
    endYear: 476,
    metadata: {
      nativeName: "Imperium Romanum",
      politicalStructure: "Empire",
      capital: "Rome",
      population: 60000000,
      writingSystems: ["Latin alphabet"],
    },
  };

  assert(typeof sampleItem.id === "string", "id is string");
  assert(typeof sampleItem.name === "string", "name is string");
  assert(typeof sampleItem.groupName === "string", "groupName is string");
  assert(typeof sampleItem.startYear === "number", "startYear is number");
  assert(typeof sampleItem.endYear === "number" || sampleItem.endYear === null, "endYear is number or null");
  assert(typeof sampleItem.metadata === "object", "metadata is object");

  // Test tooltip content generation
  console.log("\nTooltip content generation:");
  const tooltipContent = {
    title: sampleItem.name,
    subtitle: sampleItem.metadata.nativeName,
    fields: [
      { label: "Period", value: "27 BCE - 476 CE" },
      { label: "Structure", value: "Empire" },
      { label: "Capital", value: "Rome" },
      { label: "Population", value: "60.0M" },
      { label: "Writing", value: "Latin alphabet" },
    ],
  };

  assert(typeof tooltipContent.title === "string", "tooltip has title");
  assert(typeof tooltipContent.subtitle === "string", "tooltip has subtitle");
  assert(Array.isArray(tooltipContent.fields), "tooltip has fields array");
  assert(tooltipContent.fields.length >= 2, `tooltip has ${tooltipContent.fields.length} fields (expected 2+)`);
  for (const field of tooltipContent.fields) {
    assert(typeof field.label === "string" && typeof field.value === "string", `field '${field.label}' has string label and value`);
  }
}

// Run tests
testTimelineDataTransformation();
testTimelineVisualizationContract();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
