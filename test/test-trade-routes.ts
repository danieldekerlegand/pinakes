/**
 * Test script for trade routes TSV loader and API
 * Run with: npx tsx test/test-trade-routes.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testTradeRoutes() {
  console.log("=== Testing Trade Routes TSV Loader ===\n");

  const storage = new TsvStorage();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.log(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  // Test 1: Load all historical routes
  console.log("1. Loading all historical routes...");
  const allRoutes = await storage.getHistoricalRoutes();
  assert(allRoutes.length > 0, `Loaded ${allRoutes.length} historical routes`);
  assert(allRoutes.length >= 20, `Has at least 20 routes (got ${allRoutes.length})`);

  // Test 2: Verify GeoJSON structure
  console.log("\n2. Verifying GeoJSON Feature structure...");
  const route = allRoutes[0];
  assert(route.type === "Feature", "type is 'Feature'");
  assert(route.geometry.type === "LineString", "geometry.type is 'LineString'");
  assert(Array.isArray(route.geometry.coordinates), "geometry.coordinates is an array");
  assert(route.geometry.coordinates.length >= 2, "Has at least 2 coordinate points");
  assert(typeof route.properties.routeId === "string", "properties.routeId is a string");
  assert(typeof route.properties.name === "string", "properties.name is a string");
  assert(typeof route.properties.routeType === "string", "properties.routeType is a string");
  assert(typeof route.properties.timePeriod.start === "number", "timePeriod.start is a number");
  assert(Array.isArray(route.properties.associatedLanguageIds), "associatedLanguageIds is an array");
  assert(Array.isArray(route.properties.sources), "sources is an array");

  // Test 3: Verify route types
  console.log("\n3. Checking route types...");
  const routeTypes = new Set(allRoutes.map((r) => r.properties.routeType));
  assert(routeTypes.has("trade"), "Has 'trade' route type");
  assert(routeTypes.has("migration"), "Has 'migration' route type");
  assert(routeTypes.has("conquest"), "Has 'conquest' route type");
  console.log(`  Route types found: ${[...routeTypes].join(", ")}`);

  // Test 4: Filter by route type
  console.log("\n4. Filtering by route type...");
  const tradeRoutes = await storage.getHistoricalRoutes({ routeTypes: ["trade"] });
  assert(tradeRoutes.length > 0, `Found ${tradeRoutes.length} trade routes`);
  assert(
    tradeRoutes.every((r) => r.properties.routeType === "trade"),
    "All filtered routes are trade type"
  );

  const migrationRoutes = await storage.getHistoricalRoutes({ routeTypes: ["migration"] });
  assert(migrationRoutes.length > 0, `Found ${migrationRoutes.length} migration routes`);

  // Test 5: Filter by time period
  console.log("\n5. Filtering by time period...");
  const ancientRoutes = await storage.getHistoricalRoutes({
    timeStart: -5000,
    timeEnd: 0,
  });
  assert(ancientRoutes.length > 0, `Found ${ancientRoutes.length} ancient routes (before 0 CE)`);
  assert(
    ancientRoutes.every((r) => {
      const end = r.properties.timePeriod.end ?? Infinity;
      return r.properties.timePeriod.start <= 0 || end >= -5000;
    }),
    "All ancient routes overlap with the requested time window"
  );

  // Test 6: Trade goods enrichment
  console.log("\n6. Checking trade goods enrichment...");
  const silkRoad = allRoutes.find((r) => r.properties.routeId === "silk-road");
  assert(silkRoad !== undefined, "Found Silk Road route");
  if (silkRoad) {
    assert(
      silkRoad.properties.tradedGoods !== undefined && silkRoad.properties.tradedGoods.length > 0,
      `Silk Road has ${silkRoad.properties.tradedGoods?.length} traded goods`
    );
    assert(silkRoad.properties.routeType === "trade", "Silk Road is a trade route");
    assert(silkRoad.properties.direction === "bidirectional", "Trade routes are bidirectional");
    console.log(`  Traded goods: ${silkRoad.properties.tradedGoods?.slice(0, 5).join(", ")}...`);
  }

  // Test 7: Verify specific well-known routes
  console.log("\n7. Verifying specific routes...");
  const expectedRoutes = ["silk-road", "bantu-expansion", "viking-expansion", "atlantic-slave-trade"];
  for (const id of expectedRoutes) {
    const found = allRoutes.find((r) => r.properties.routeId === id);
    assert(found !== undefined, `Route '${id}' exists`);
  }

  // Test 8: Coordinate validation
  console.log("\n8. Validating coordinates...");
  let allCoordsValid = true;
  for (const r of allRoutes) {
    for (const [lng, lat] of r.geometry.coordinates) {
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        allCoordsValid = false;
        console.log(`  ✗ Invalid coordinate [${lng}, ${lat}] in route ${r.properties.routeId}`);
      }
    }
  }
  assert(allCoordsValid, "All coordinates are within valid ranges");

  // Test 9: Combined filters
  console.log("\n9. Testing combined filters...");
  const medievalTrade = await storage.getHistoricalRoutes({
    timeStart: 500,
    timeEnd: 1500,
    routeTypes: ["trade"],
  });
  assert(medievalTrade.length > 0, `Found ${medievalTrade.length} medieval trade routes`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testTradeRoutes().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
