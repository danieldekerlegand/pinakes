/**
 * Test script for trade routes TSV data
 * Run with: npx tsx test/test-trade-routes.ts
 */

import { TsvStorage } from "../server/tsv-storage";

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

async function testTradeRoutes() {
  console.log("=== Testing Trade Routes TSV ===\n");

  const storage = new TsvStorage();

  // Test: Load all trade routes
  console.log("1. Loading all trade routes");
  const allRoutes = await storage.getTradeRoutes();
  assert(allRoutes.length >= 25, `Expected at least 25 trade routes, got ${allRoutes.length}`);

  // Test: Each route has required fields
  console.log("\n2. Validating required fields");
  for (const route of allRoutes) {
    assert(!!route.id, `Route has id: ${route.id}`);
    assert(!!route.name, `Route ${route.id} has name: ${route.name}`);
    assert(!!route.routeType, `Route ${route.id} has routeType: ${route.routeType}`);
    assert(!!route.description, `Route ${route.id} has description`);
    break; // Just test the first one for brevity
  }

  // Test: Route types are valid
  console.log("\n3. Validating route types");
  const validTypes = ["land", "maritime", "river"];
  for (const route of allRoutes) {
    assert(validTypes.includes(route.routeType), `Route ${route.id} has valid type: ${route.routeType}`);
  }

  // Test: Filter by route type
  console.log("\n4. Filtering by route type");
  const landRoutes = await storage.getTradeRoutes("land");
  const maritimeRoutes = await storage.getTradeRoutes("maritime");
  const riverRoutes = await storage.getTradeRoutes("river");
  assert(landRoutes.length > 0, `Found ${landRoutes.length} land routes`);
  assert(maritimeRoutes.length > 0, `Found ${maritimeRoutes.length} maritime routes`);
  assert(riverRoutes.length > 0, `Found ${riverRoutes.length} river routes`);
  assert(
    landRoutes.length + maritimeRoutes.length + riverRoutes.length === allRoutes.length,
    "Sum of filtered routes equals total routes"
  );

  // Test: Get by ID
  console.log("\n5. Get trade route by ID");
  const silkRoad = await storage.getTradeRouteById("tr-001");
  assert(silkRoad !== null, "Found Silk Road by ID tr-001");
  assert(silkRoad?.name === "Silk Road", `Silk Road name: ${silkRoad?.name}`);
  assert(silkRoad?.routeType === "land", `Silk Road is a land route`);
  assert(Array.isArray(silkRoad?.tradedGoods) && silkRoad.tradedGoods.length > 0, `Silk Road has traded goods`);
  assert(Array.isArray(silkRoad?.keyCities) && silkRoad.keyCities.length > 0, `Silk Road has key cities`);
  assert(Array.isArray(silkRoad?.controllingPowers) && silkRoad.controllingPowers.length > 0, `Silk Road has controlling powers`);
  assert(Array.isArray(silkRoad?.associatedLanguages) && silkRoad.associatedLanguages.length > 0, `Silk Road has associated languages`);

  // Test: Non-existent route returns null
  console.log("\n6. Non-existent route");
  const notFound = await storage.getTradeRouteById("tr-999");
  assert(notFound === null, "Non-existent route returns null");

  // Test: Waypoints have GeoJSON structure
  console.log("\n7. Waypoints GeoJSON structure");
  assert(silkRoad?.waypoints?.type === "LineString", "Silk Road waypoints is LineString");
  assert(
    Array.isArray((silkRoad?.waypoints as { coordinates?: unknown })?.coordinates),
    "Silk Road waypoints has coordinates array"
  );

  // Test: Trade goods reference valid IDs
  console.log("\n8. Trade goods references");
  const tradeGoods = silkRoad?.tradedGoods ?? [];
  for (const goodId of tradeGoods.slice(0, 3)) {
    assert(goodId.startsWith("tg-"), `Traded good ${goodId} has valid prefix`);
    const good = await storage.getTradeGoodById(goodId);
    assert(good !== null, `Traded good ${goodId} exists in trade-goods.tsv`);
  }

  // Test: Dates are present
  console.log("\n9. Date fields");
  for (const route of allRoutes) {
    assert(route.startDate !== "", `Route ${route.id} has start date: ${route.startDate}`);
    assert(route.endDate !== "", `Route ${route.id} has end date: ${route.endDate}`);
  }

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
