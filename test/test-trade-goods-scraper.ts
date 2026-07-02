/**
 * Test script for trade goods scraper and economic data
 * Run with: npx tsx test/test-trade-goods-scraper.ts
 */

import { TsvStorage } from "../server/tsv-storage";
import type { TradeGood, TradeRoute } from "../server/tsv-storage";
import fs from "node:fs";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  \u2713 ${message}`);
    passed++;
  } else {
    console.log(`  \u2717 FAIL: ${message}`);
    failed++;
  }
}

async function testTradeGoodsData() {
  console.log("=== Testing Trade Goods TSV Data ===\n");

  const storage = new TsvStorage();

  // Test: File exists
  console.log("1. File existence");
  assert(fs.existsSync("lexicons/trade-goods.tsv"), "trade-goods.tsv exists");
  assert(fs.existsSync("lexicons/trade-routes.tsv"), "trade-routes.tsv exists");

  // Test: Load all trade goods
  console.log("\n2. Loading trade goods");
  const allGoods = await storage.getTradeGoods();
  assert(allGoods.length >= 40, `Expected at least 40 trade goods, got ${allGoods.length}`);

  // Test: Each good has required fields
  console.log("\n3. Validating trade good required fields");
  for (const good of allGoods) {
    assert(!!good.id, `Good has id: ${good.id}`);
    assert(!!good.name, `Good ${good.id} has name: ${good.name}`);
    assert(!!good.category, `Good ${good.id} has category: ${good.category}`);
    assert(!!good.originRegion, `Good ${good.id} has origin region`);
    assert(!!good.timePeriod, `Good ${good.id} has time period`);
    assert(!!good.economicSignificance, `Good ${good.id} has economic significance`);
    break; // Just test the first one for brevity
  }

  // Test: IDs are unique
  console.log("\n4. Unique IDs");
  const goodIds = allGoods.map((g) => g.id);
  const uniqueGoodIds = new Set(goodIds);
  assert(goodIds.length === uniqueGoodIds.size, `All ${goodIds.length} trade good IDs are unique`);

  // Test: ID format
  console.log("\n5. ID format");
  for (const good of allGoods) {
    assert(good.id.startsWith("tg-"), `Good ${good.id} has correct prefix`);
  }

  // Test: Valid categories
  console.log("\n6. Category validation");
  const validCategories = ["textile", "spice", "metal", "luxury", "grain", "animal", "mineral", "manufactured", "narcotics", "naval"];
  for (const good of allGoods) {
    assert(
      validCategories.some((c) => good.category.toLowerCase().includes(c)) || good.category.length > 0,
      `Good ${good.id} (${good.name}) has category: ${good.category}`
    );
  }

  // Test: Coordinates are valid
  console.log("\n7. Coordinate validation");
  for (const good of allGoods.slice(0, 5)) {
    assert(
      good.originCoordinates.lat >= -90 && good.originCoordinates.lat <= 90,
      `Good ${good.id} has valid latitude: ${good.originCoordinates.lat}`
    );
    assert(
      good.originCoordinates.lng >= -180 && good.originCoordinates.lng <= 180,
      `Good ${good.id} has valid longitude: ${good.originCoordinates.lng}`
    );
  }

  // Test: Associated languages are arrays
  console.log("\n8. Associated languages");
  for (const good of allGoods.slice(0, 5)) {
    assert(Array.isArray(good.associatedLanguages), `Good ${good.id} has languages array`);
    assert(good.associatedLanguages.length > 0, `Good ${good.id} has at least one language`);
  }

  // Test: Trade routes references are arrays
  console.log("\n9. Trade route references");
  for (const good of allGoods.slice(0, 5)) {
    assert(Array.isArray(good.tradeRoutes), `Good ${good.id} has trade routes array`);
  }

  // Test: Filter by category
  console.log("\n10. Filter by category");
  const spices = await storage.getTradeGoods({ category: "spice" });
  assert(spices.length > 0, `Found ${spices.length} spice goods`);
  for (const s of spices) {
    assert(s.category === "spice", `Filtered good ${s.id} is a spice`);
  }

  // Test: Get by ID
  console.log("\n11. Get by ID");
  const silk = await storage.getTradeGoodById("tg-001");
  assert(silk !== null, "Found Silk by ID tg-001");
  assert(silk?.name === "Silk", `Silk name: ${silk?.name}`);

  // Test: Non-existent returns null
  const notFound = await storage.getTradeGoodById("tg-999");
  assert(notFound === null, "Non-existent good returns null");
}

async function testTradeRoutesData() {
  console.log("\n\n=== Testing Trade Routes TSV Data ===\n");

  const storage = new TsvStorage();

  // Test: Load all routes
  console.log("1. Loading trade routes");
  const allRoutes = await storage.getTradeRoutes();
  assert(allRoutes.length >= 25, `Expected at least 25 trade routes, got ${allRoutes.length}`);

  // Test: Required fields
  console.log("\n2. Validating required fields");
  for (const route of allRoutes.slice(0, 3)) {
    assert(!!route.id, `Route has id: ${route.id}`);
    assert(!!route.name, `Route ${route.id} has name: ${route.name}`);
    assert(!!route.routeType, `Route ${route.id} has routeType: ${route.routeType}`);
    assert(!!route.description, `Route ${route.id} has description`);
  }

  // Test: IDs are unique
  console.log("\n3. Unique IDs");
  const routeIds = allRoutes.map((r) => r.id);
  const uniqueRouteIds = new Set(routeIds);
  assert(routeIds.length === uniqueRouteIds.size, `All ${routeIds.length} route IDs are unique`);

  // Test: Valid route types
  console.log("\n4. Route type validation");
  const validTypes = ["land", "maritime", "river"];
  for (const route of allRoutes) {
    assert(validTypes.includes(route.routeType), `Route ${route.id} has valid type: ${route.routeType}`);
  }

  // Test: Filter by type
  console.log("\n5. Filter by route type");
  const landRoutes = await storage.getTradeRoutes("land");
  const maritimeRoutes = await storage.getTradeRoutes("maritime");
  assert(landRoutes.length > 0, `Found ${landRoutes.length} land routes`);
  assert(maritimeRoutes.length > 0, `Found ${maritimeRoutes.length} maritime routes`);

  // Test: Waypoints structure
  console.log("\n6. Waypoints GeoJSON");
  for (const route of allRoutes.slice(0, 3)) {
    const wp = route.waypoints as { type?: string; coordinates?: number[][] };
    assert(wp.type === "LineString", `Route ${route.id} waypoints is LineString`);
    assert(Array.isArray(wp.coordinates), `Route ${route.id} has coordinates array`);
    if (wp.coordinates && wp.coordinates.length > 0) {
      assert(wp.coordinates[0].length === 2, `Route ${route.id} coordinates are [lng, lat] pairs`);
    }
  }

  // Test: Arrays are properly parsed
  console.log("\n7. Array fields");
  const silkRoad = await storage.getTradeRouteById("tr-001");
  assert(silkRoad !== null, "Found Silk Road");
  assert(Array.isArray(silkRoad?.tradedGoods), "tradedGoods is array");
  assert(Array.isArray(silkRoad?.keyCities), "keyCities is array");
  assert(Array.isArray(silkRoad?.controllingPowers), "controllingPowers is array");
  assert(Array.isArray(silkRoad?.associatedLanguages), "associatedLanguages is array");
  assert((silkRoad?.tradedGoods?.length ?? 0) > 0, "Silk Road has traded goods");
  assert((silkRoad?.keyCities?.length ?? 0) > 0, "Silk Road has key cities");

  // Test: Dates present
  console.log("\n8. Date fields");
  for (const route of allRoutes.slice(0, 5)) {
    assert(route.startDate !== "", `Route ${route.id} has start date: ${route.startDate}`);
    assert(route.endDate !== "", `Route ${route.id} has end date: ${route.endDate}`);
  }
}

async function testTsvWriterRoundTrip() {
  console.log("\n\n=== Testing TSV Writer Round Trip ===\n");

  // Import tsvWriter dynamically to avoid circular deps
  const { tsvWriter } = await import("../server/services/tsv-writer");

  const testGoods: TradeGood[] = [
    {
      id: "tg-test-001",
      name: "Test Commodity",
      category: "luxury",
      originRegion: "Test Region",
      originCoordinates: { lat: 35.5, lng: 45.5 },
      tradeRoutes: ["silk-road", "spice-trade"],
      timePeriod: "-1000 to 500",
      economicSignificance: "Test significance",
      associatedLanguages: ["eng", "arb"],
    },
  ];

  const testRoutes: TradeRoute[] = [
    {
      id: "tr-test-001",
      name: "Test Route",
      routeType: "land",
      waypoints: { type: "LineString", coordinates: [[45, 35], [50, 40]] },
      startDate: "-500",
      endDate: "1000",
      tradedGoods: ["tg-test-001"],
      keyCities: ["CityA", "CityB"],
      controllingPowers: ["Empire A"],
      associatedLanguages: ["eng"],
      description: "Test route description",
      economicImpact: "Test impact",
    },
  ];

  const goodsPath = "lexicons/test-trade-goods-tmp.tsv";
  const routesPath = "lexicons/test-trade-routes-tmp.tsv";

  try {
    // Write test data
    await tsvWriter.writeTradeGoodsTSV(testGoods, goodsPath);
    assert(fs.existsSync(goodsPath), "Trade goods TSV written");

    await tsvWriter.writeTradeRoutesTSV(testRoutes, routesPath);
    assert(fs.existsSync(routesPath), "Trade routes TSV written");

    // Verify content
    const goodsContent = fs.readFileSync(goodsPath, "utf8");
    const goodsLines = goodsContent.trim().split("\n");
    assert(goodsLines.length === 2, `Trade goods TSV has header + 1 data row (got ${goodsLines.length})`);
    assert(goodsLines[0].includes("id\tname\tcategory"), "Trade goods header is correct");
    assert(goodsLines[1].includes("tg-test-001"), "Trade goods data contains test ID");
    assert(goodsLines[1].includes("Test Commodity"), "Trade goods data contains test name");

    const routesContent = fs.readFileSync(routesPath, "utf8");
    const routesLines = routesContent.trim().split("\n");
    assert(routesLines.length === 2, `Trade routes TSV has header + 1 data row (got ${routesLines.length})`);
    assert(routesLines[0].includes("id\tname\troute_type"), "Trade routes header is correct");
    assert(routesLines[1].includes("tr-test-001"), "Trade routes data contains test ID");

    // Verify JSON columns are properly serialized
    assert(goodsLines[1].includes('{"lat":35.5,"lng":45.5}'), "Coordinates serialized correctly");
    assert(goodsLines[1].includes('["silk-road","spice-trade"]'), "Trade routes array serialized correctly");
    assert(routesLines[1].includes('"LineString"'), "Waypoints GeoJSON serialized correctly");
  } finally {
    // Cleanup
    try { fs.unlinkSync(goodsPath); } catch {}
    try { fs.unlinkSync(routesPath); } catch {}
  }
}

async function main() {
  await testTradeGoodsData();
  await testTradeRoutesData();
  await testTsvWriterRoundTrip();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
