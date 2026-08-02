/**
 * Test script for validating migration routes data
 * Run with: npx tsx test/test-migration-routes.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALID_ROUTE_TYPES = ["migration", "trade", "conquest", "colonization", "diaspora", "pilgrimage", "communication"];

interface RouteRow {
  id: string;
  name: string;
  routeType: string;
  waypoints: unknown;
  startDate: string;
  endDate: string;
  peoples: string[];
  associatedLanguages: string[];
  description: string;
  consequences: string;
}

function loadMigrationRoutes(): RouteRow[] {
  const filePath = join(__dirname, "..", "data", "source", "lexicons", "migration-routes.tsv");
  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t");

  const idx = (col: string) => header.indexOf(col);

  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return {
      id: cols[idx("id")] || "",
      name: cols[idx("name")] || "",
      routeType: cols[idx("route_type")] || "",
      waypoints: (() => {
        try { return JSON.parse(cols[idx("waypoints")] || "{}"); } catch { return {}; }
      })(),
      startDate: cols[idx("start_date")] || "",
      endDate: cols[idx("end_date")] || "",
      peoples: (() => {
        try { return JSON.parse(cols[idx("peoples")] || "[]"); } catch { return []; }
      })(),
      associatedLanguages: (() => {
        try { return JSON.parse(cols[idx("associated_languages")] || "[]"); } catch { return []; }
      })(),
      description: cols[idx("description")] || "",
      consequences: cols[idx("consequences")] || "",
    };
  });
}

function testMigrationRoutes() {
  console.log("=== Migration Routes Validation Test ===\n");

  const routes = loadMigrationRoutes();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.log(`  ✗ FAIL: ${message}`);
    }
  }

  // Test 1: Minimum count
  console.log("Test 1: Route count >= 60");
  assert(routes.length >= 60, `Expected >= 60 routes, got ${routes.length}`);
  console.log(`  Routes loaded: ${routes.length}`);

  // Test 2: All routes have required fields
  console.log("\nTest 2: Required fields present");
  for (const route of routes) {
    assert(!!route.id, `Route missing id`);
    assert(!!route.name, `Route ${route.id} missing name`);
    assert(!!route.routeType, `Route ${route.id} missing routeType`);
    assert(!!route.description, `Route ${route.id} missing description`);
    assert(!!route.startDate, `Route ${route.id} missing startDate`);
    assert(!!route.endDate, `Route ${route.id} missing endDate`);
  }
  console.log(`  Checked ${routes.length} routes for required fields`);

  // Test 3: Valid route types
  console.log("\nTest 3: Valid route types");
  for (const route of routes) {
    assert(
      VALID_ROUTE_TYPES.includes(route.routeType),
      `Route ${route.id} has invalid routeType: ${route.routeType}`
    );
  }
  const typeCounts = routes.reduce((acc, r) => {
    acc[r.routeType] = (acc[r.routeType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log("  Route type distribution:", typeCounts);

  // Test 4: Unique IDs
  console.log("\nTest 4: Unique IDs");
  const ids = routes.map((r) => r.id);
  const uniqueIds = new Set(ids);
  assert(
    ids.length === uniqueIds.size,
    `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`
  );
  console.log(`  ${uniqueIds.size} unique IDs`);

  // Test 5: Valid waypoints (GeoJSON LineString)
  console.log("\nTest 5: Valid GeoJSON waypoints");
  for (const route of routes) {
    const wp = route.waypoints as { type?: string; coordinates?: number[][] };
    assert(wp.type === "LineString", `Route ${route.id} waypoints not LineString`);
    assert(
      Array.isArray(wp.coordinates) && wp.coordinates.length >= 2,
      `Route ${route.id} needs at least 2 coordinate pairs`
    );
    if (Array.isArray(wp.coordinates)) {
      for (const coord of wp.coordinates) {
        assert(
          Array.isArray(coord) && coord.length === 2,
          `Route ${route.id} has invalid coordinate`
        );
        const [lon, lat] = coord;
        assert(
          lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90,
          `Route ${route.id} has out-of-range coordinate [${lon},${lat}]`
        );
      }
    }
  }

  // Test 6: startDate < endDate
  console.log("\nTest 6: Date ordering (startDate < endDate)");
  for (const route of routes) {
    const start = parseInt(route.startDate);
    const end = parseInt(route.endDate);
    assert(!isNaN(start) && !isNaN(end), `Route ${route.id} has non-numeric dates`);
    assert(start < end, `Route ${route.id} startDate (${start}) >= endDate (${end})`);
  }

  // Test 7: Peoples array is valid
  console.log("\nTest 7: Peoples arrays");
  for (const route of routes) {
    assert(Array.isArray(route.peoples), `Route ${route.id} peoples is not an array`);
    assert(route.peoples.length > 0, `Route ${route.id} has empty peoples array`);
  }

  // Test 8: Associated languages array is valid
  console.log("\nTest 8: Associated languages arrays");
  for (const route of routes) {
    assert(Array.isArray(route.associatedLanguages), `Route ${route.id} languages is not an array`);
  }

  // Test 9: Coverage of different time periods
  console.log("\nTest 9: Time period coverage");
  const prehistoric = routes.filter((r) => parseInt(r.startDate) < -3000);
  const ancient = routes.filter((r) => {
    const s = parseInt(r.startDate);
    return s >= -3000 && s < 500;
  });
  const medieval = routes.filter((r) => {
    const s = parseInt(r.startDate);
    return s >= 500 && s < 1500;
  });
  const modern = routes.filter((r) => parseInt(r.startDate) >= 1500);
  assert(prehistoric.length >= 3, `Need >= 3 prehistoric routes, got ${prehistoric.length}`);
  assert(ancient.length >= 5, `Need >= 5 ancient routes, got ${ancient.length}`);
  assert(medieval.length >= 5, `Need >= 5 medieval routes, got ${medieval.length}`);
  assert(modern.length >= 5, `Need >= 5 modern routes, got ${modern.length}`);
  console.log(`  Prehistoric: ${prehistoric.length}, Ancient: ${ancient.length}, Medieval: ${medieval.length}, Modern: ${modern.length}`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testMigrationRoutes();
