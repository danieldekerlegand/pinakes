/**
 * Test script for verifying guided journey narratives
 * Run with: npx tsx test/test-narratives.ts
 *
 * Tests the narratives.tsv file directly to validate structure and content.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

interface NarrativeStep {
  text: string;
  map_center: [number, number];
  map_zoom: number;
  time_point: number;
  highlighted_entities: string[];
  layer_config: { layers: string[] };
}

interface Narrative {
  id: string;
  title: string;
  description: string;
  steps: NarrativeStep[];
}

function loadNarratives(): Narrative[] {
  const tsvPath = resolve(__dirname, "../lexicons/narratives.tsv");
  const text = readFileSync(tsvPath, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");

  const idIdx = header.indexOf("id");
  const titleIdx = header.indexOf("title");
  const descIdx = header.indexOf("description");
  const stepsIdx = header.indexOf("steps");

  return lines.map((line) => {
    const cols = line.split("\t");
    let steps: NarrativeStep[] = [];
    try {
      steps = JSON.parse(cols[stepsIdx]);
    } catch { /* empty */ }
    return {
      id: cols[idIdx],
      title: cols[titleIdx],
      description: cols[descIdx],
      steps,
    };
  }).filter((n) => n.id && n.id.trim() !== "");
}

function testNarratives() {
  console.log("=== Testing Guided Journey Narratives ===\n");

  const narratives = loadNarratives();

  // Test: narratives load successfully
  console.log("1. Loading narratives");
  assert(narratives.length > 0, `Narratives loaded: ${narratives.length}`);
  assert(narratives.length >= 21, `At least 21 narratives exist (found ${narratives.length})`);

  // Test: all narratives have unique IDs
  console.log("\n2. Unique IDs");
  const ids = narratives.map((n) => n.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `All ${ids.length} narrative IDs are unique`);

  // Test: all narratives have required fields
  console.log("\n3. Required fields");
  for (const n of narratives) {
    assert(!!n.id && n.id.trim() !== "", `"${n.id}" has an id`);
    assert(!!n.title && n.title.trim() !== "", `"${n.id}" has a title`);
    assert(!!n.description && n.description.trim() !== "", `"${n.id}" has a description`);
    assert(n.steps.length > 0, `"${n.id}" has steps (${n.steps.length})`);
  }

  // Test: all steps have valid structure
  console.log("\n4. Step structure validation");
  for (const n of narratives) {
    for (let i = 0; i < n.steps.length; i++) {
      const step = n.steps[i];
      const label = `${n.id}[${i}]`;
      assert(!!step.text && step.text.length > 0, `${label} has text`);
      assert(
        Array.isArray(step.map_center) && step.map_center.length === 2,
        `${label} has valid map_center`
      );
      assert(
        typeof step.map_center[0] === "number" && typeof step.map_center[1] === "number",
        `${label} map_center contains numbers`
      );
      assert(
        step.map_center[0] >= -90 && step.map_center[0] <= 90,
        `${label} latitude in range (${step.map_center[0]})`
      );
      assert(
        step.map_center[1] >= -180 && step.map_center[1] <= 180,
        `${label} longitude in range (${step.map_center[1]})`
      );
      assert(
        typeof step.map_zoom === "number" && step.map_zoom >= 1 && step.map_zoom <= 20,
        `${label} has valid map_zoom (${step.map_zoom})`
      );
      assert(typeof step.time_point === "number", `${label} has numeric time_point`);
      assert(Array.isArray(step.highlighted_entities), `${label} has highlighted_entities array`);
      assert(
        step.layer_config && Array.isArray(step.layer_config.layers),
        `${label} has layer_config.layers`
      );
      assert(
        step.layer_config.layers.length > 0,
        `${label} has at least one layer`
      );
    }
  }

  // Test: each narrative has at least 4 steps
  console.log("\n5. Minimum step count");
  for (const n of narratives) {
    assert(n.steps.length >= 4, `${n.id} has >= 4 steps (${n.steps.length})`);
  }

  // Test: specific new narratives exist
  console.log("\n6. New narratives present");
  const expectedNew = [
    "journey_of_coffee",
    "viking_linguistic_trail",
    "persian_literary_empire",
    "dravidian_legacy",
    "greek_scientific_legacy",
    "creole_genesis",
    "uralic_journey",
    "tibetan_himalayan",
    "printing_press_revolution",
    "chinese_characters_across_asia",
    "atlantic_slave_trade_languages",
  ];
  for (const id of expectedNew) {
    assert(ids.includes(id), `New narrative "${id}" exists`);
  }

  // Test: original narratives still exist
  console.log("\n7. Original narratives preserved");
  const expectedOriginal = [
    "sugar_journey",
    "silk_road_languages",
    "indo_european_expansion",
    "columbian_exchange",
    "spread_of_writing",
    "bantu_migration",
    "norman_conquest_english",
    "austronesian_voyagers",
    "arabic_golden_age",
    "spice_trade",
  ];
  for (const id of expectedOriginal) {
    assert(ids.includes(id), `Original narrative "${id}" still exists`);
  }

  // Test: verify a specific new narrative's content
  console.log("\n8. Content spot check");
  const coffee = narratives.find((n) => n.id === "journey_of_coffee");
  assert(coffee !== undefined, "journey_of_coffee found");
  assert(coffee?.title === "The Journey of Coffee", "Coffee narrative title correct");
  assert(coffee?.steps.length === 6, `Coffee narrative has 6 steps (${coffee?.steps.length})`);
  assert(
    coffee?.steps[0].map_center[0] === 7.5 && coffee?.steps[0].map_center[1] === 36.0,
    "Coffee step 1 starts in Ethiopia"
  );

  const viking = narratives.find((n) => n.id === "viking_linguistic_trail");
  assert(viking !== undefined, "viking_linguistic_trail found");
  assert(viking?.steps.length === 6, `Viking narrative has 6 steps (${viking?.steps.length})`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testNarratives();
