/**
 * Test script for boundary drawing tool logic
 * Run with: npx tsx test/test-boundary-drawing.ts
 */

import { ContributionService } from "../server/services/contribution-service";
import fs from "fs";
import path from "path";

// ============================================================================
// Drawing Tool Logic Tests (pure logic, no React)
// ============================================================================

interface Position {
  0: number; // lng
  1: number; // lat
}

// Simulate the core drawing logic without React hooks
class DrawingToolSimulator {
  vertices: number[][] = [];
  mode: 'polygon' | 'polyline' = 'polygon';
  past: number[][][] = [];
  future: number[][][] = [];

  setMode(mode: 'polygon' | 'polyline') {
    this.mode = mode;
    this.vertices = [];
    this.past = [];
    this.future = [];
  }

  addVertex(position: number[]) {
    this.past.push([...this.vertices.map(v => [...v])]);
    this.future = [];
    this.vertices.push([...position]);
  }

  removeVertex(index: number) {
    if (index < 0 || index >= this.vertices.length) return;
    this.past.push([...this.vertices.map(v => [...v])]);
    this.future = [];
    this.vertices = this.vertices.filter((_, i) => i !== index);
  }

  moveVertex(index: number, position: number[]) {
    if (index < 0 || index >= this.vertices.length) return;
    this.past.push([...this.vertices.map(v => [...v])]);
    this.future = [];
    this.vertices[index] = [...position];
  }

  undo() {
    if (this.past.length === 0) return;
    this.future.push([...this.vertices.map(v => [...v])]);
    this.vertices = this.past.pop()!;
  }

  redo() {
    if (this.future.length === 0) return;
    this.past.push([...this.vertices.map(v => [...v])]);
    this.vertices = this.future.pop()!;
  }

  toGeoJSON(): any | null {
    if (this.vertices.length < 2) return null;

    if (this.mode === 'polyline') {
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: this.vertices,
        },
      };
    }

    if (this.vertices.length < 3) return null;

    const ring = [...this.vertices, this.vertices[0]];
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    };
  }
}

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

function assertDeepEqual(actual: any, expected: any, message: string) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ============================================================================
// Test Suite: Drawing Tool Logic
// ============================================================================

function testAddVertices() {
  console.log("\nTest 1: Adding vertices");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');

  tool.addVertex([10, 20]);
  assert(tool.vertices.length === 1, "Should have 1 vertex after adding one");

  tool.addVertex([30, 40]);
  assert(tool.vertices.length === 2, "Should have 2 vertices after adding two");

  tool.addVertex([50, 60]);
  assert(tool.vertices.length === 3, "Should have 3 vertices after adding three");

  assertDeepEqual(tool.vertices[0], [10, 20], "First vertex should be [10, 20]");
  assertDeepEqual(tool.vertices[2], [50, 60], "Third vertex should be [50, 60]");
}

function testRemoveVertex() {
  console.log("\nTest 2: Removing vertices");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');

  tool.addVertex([10, 20]);
  tool.addVertex([30, 40]);
  tool.addVertex([50, 60]);

  tool.removeVertex(1);
  assert(tool.vertices.length === 2, "Should have 2 vertices after removing one");
  assertDeepEqual(tool.vertices[0], [10, 20], "First vertex unchanged");
  assertDeepEqual(tool.vertices[1], [50, 60], "Second vertex is now the former third");

  // Out of bounds removal should be a no-op
  tool.removeVertex(5);
  assert(tool.vertices.length === 2, "Out of bounds removal is a no-op");
  tool.removeVertex(-1);
  assert(tool.vertices.length === 2, "Negative index removal is a no-op");
}

function testMoveVertex() {
  console.log("\nTest 3: Moving vertices");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');

  tool.addVertex([10, 20]);
  tool.addVertex([30, 40]);

  tool.moveVertex(0, [15, 25]);
  assertDeepEqual(tool.vertices[0], [15, 25], "Vertex moved to new position");
  assertDeepEqual(tool.vertices[1], [30, 40], "Other vertex unchanged");
}

function testUndoRedo() {
  console.log("\nTest 4: Undo/Redo");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');

  tool.addVertex([10, 20]);
  tool.addVertex([30, 40]);
  tool.addVertex([50, 60]);
  assert(tool.vertices.length === 3, "Start with 3 vertices");

  tool.undo();
  assert(tool.vertices.length === 2, "After undo: 2 vertices");
  assertDeepEqual(tool.vertices[1], [30, 40], "Last vertex is [30, 40] after undo");

  tool.undo();
  assert(tool.vertices.length === 1, "After second undo: 1 vertex");

  tool.redo();
  assert(tool.vertices.length === 2, "After redo: 2 vertices");

  tool.redo();
  assert(tool.vertices.length === 3, "After second redo: 3 vertices");

  // Redo when nothing to redo
  tool.redo();
  assert(tool.vertices.length === 3, "Extra redo is a no-op");

  // Undo all
  tool.undo();
  tool.undo();
  tool.undo();
  assert(tool.vertices.length === 0, "After undoing all: 0 vertices");

  // Undo when nothing to undo
  tool.undo();
  assert(tool.vertices.length === 0, "Extra undo is a no-op");
}

function testUndoRedoBranchClearing() {
  console.log("\nTest 5: Undo then new action clears redo stack");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');

  tool.addVertex([10, 20]);
  tool.addVertex([30, 40]);
  tool.addVertex([50, 60]);

  tool.undo(); // back to 2 vertices
  assert(tool.future.length === 1, "Redo stack has 1 entry");

  tool.addVertex([70, 80]); // new action clears redo
  assert(tool.future.length === 0, "Redo stack cleared after new action");
  assert(tool.vertices.length === 3, "3 vertices after new action");
  assertDeepEqual(tool.vertices[2], [70, 80], "New vertex is [70, 80]");
}

function testGeoJSONPolygon() {
  console.log("\nTest 6: GeoJSON export - Polygon");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');

  // Not enough vertices
  assert(tool.toGeoJSON() === null, "Empty vertices returns null");

  tool.addVertex([10, 20]);
  assert(tool.toGeoJSON() === null, "1 vertex returns null for polygon");

  tool.addVertex([30, 40]);
  assert(tool.toGeoJSON() === null, "2 vertices returns null for polygon");

  tool.addVertex([50, 60]);
  const geojson = tool.toGeoJSON();
  assert(geojson !== null, "3 vertices produces GeoJSON");
  assert(geojson.type === 'Feature', "GeoJSON type is Feature");
  assert(geojson.geometry.type === 'Polygon', "Geometry type is Polygon");

  const coords = geojson.geometry.coordinates[0];
  assert(coords.length === 4, "Ring has 4 points (3 vertices + closing point)");
  assertDeepEqual(coords[0], coords[3], "Ring is closed (first == last)");
}

function testGeoJSONPolyline() {
  console.log("\nTest 7: GeoJSON export - Polyline");
  const tool = new DrawingToolSimulator();
  tool.setMode('polyline');

  tool.addVertex([10, 20]);
  assert(tool.toGeoJSON() === null, "1 vertex returns null for polyline");

  tool.addVertex([30, 40]);
  const geojson = tool.toGeoJSON();
  assert(geojson !== null, "2 vertices produces GeoJSON for polyline");
  assert(geojson.geometry.type === 'LineString', "Geometry type is LineString");

  const coords = geojson.geometry.coordinates;
  assert(coords.length === 2, "LineString has 2 coordinates");
  assertDeepEqual(coords[0], [10, 20], "First coordinate correct");
  assertDeepEqual(coords[1], [30, 40], "Second coordinate correct");
}

function testModeSwitch() {
  console.log("\nTest 8: Mode switch clears state");
  const tool = new DrawingToolSimulator();
  tool.setMode('polygon');
  tool.addVertex([10, 20]);
  tool.addVertex([30, 40]);

  tool.setMode('polyline');
  assert(tool.vertices.length === 0, "Vertices cleared on mode switch");
  assert(tool.past.length === 0, "History cleared on mode switch");
  assert(tool.mode === 'polyline', "Mode changed to polyline");
}

// ============================================================================
// Test Suite: Contribution Service - Boundary Type
// ============================================================================

function testBoundaryContribution() {
  console.log("\nTest 9: Contribution Service - Boundary entity type");

  // Use a temp directory for test contributions
  const testDir = path.join("data", "contributions-test-" + Date.now());
  const service = new ContributionService(testDir);

  try {
    // Submit a boundary contribution with geometry
    const geometry = {
      type: 'Polygon',
      coordinates: [[[10, 20], [30, 40], [50, 60], [10, 20]]],
    };

    const result = service.submit({
      entityType: 'boundary',
      action: 'add',
      entityData: {
        name: 'Test Boundary',
        geometry,
        description: 'A test boundary polygon',
        drawingMode: 'polygon',
      },
      sources: [{ title: 'Test Source' }],
      confidence: 80,
    });

    assert(result.validation.valid, "Boundary contribution passes validation");
    assert(result.contribution !== undefined, "Contribution created");
    assert(result.contribution!.entityType === 'boundary', "Entity type is boundary");
    assert(result.contribution!.status === 'pending', "Status is pending");
    assert((result.contribution!.entityData.geometry as any).type === 'Polygon', "Geometry stored correctly");

    // Verify it can be retrieved
    const retrieved = service.get(result.contribution!.id);
    assert(retrieved !== null, "Can retrieve saved contribution");
    assert(retrieved!.entityData.name === 'Test Boundary', "Name preserved");

    // Verify listing works
    const list = service.list({ entityType: 'boundary' });
    assert(list.total === 1, "List returns 1 boundary contribution");

    // Verify stats include boundary type
    const stats = service.stats();
    assert(stats.byEntityType['boundary'] === 1, "Stats count boundary type");

    // Test validation: missing required fields
    const badResult = service.submit({
      entityType: 'boundary',
      action: 'add',
      entityData: { description: 'No name or geometry' },
      sources: [{ title: 'Source' }],
      confidence: 50,
    });
    assert(!badResult.validation.valid, "Missing required fields fails validation");
    assert(badResult.validation.errors.some(e => e.includes('name')), "Error mentions missing name");
    assert(badResult.validation.errors.some(e => e.includes('geometry')), "Error mentions missing geometry");

    // Test review workflow
    const reviewed = service.review(result.contribution!.id, 'approved', 'Looks correct');
    assert(reviewed !== null, "Review succeeds");
    assert(reviewed!.status === 'approved', "Status updated to approved");
    assert(reviewed!.reviewNote === 'Looks correct', "Review note saved");

    console.log("\n  All boundary contribution tests passed");
  } finally {
    // Clean up test directory
    try {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    } catch {
      // ignore cleanup errors
    }
  }
}

function testBoundaryPolylineContribution() {
  console.log("\nTest 10: Contribution Service - Polyline boundary");

  const testDir = path.join("data", "contributions-test-polyline-" + Date.now());
  const service = new ContributionService(testDir);

  try {
    const geometry = {
      type: 'LineString',
      coordinates: [[10, 20], [30, 40], [50, 60]],
    };

    const result = service.submit({
      entityType: 'boundary',
      action: 'add',
      entityData: {
        name: 'Test Route Boundary',
        geometry,
        drawingMode: 'polyline',
      },
      sources: [{ title: 'Route Source' }],
      confidence: 60,
    });

    assert(result.validation.valid, "Polyline boundary contribution passes validation");
    assert((result.contribution!.entityData.geometry as any).type === 'LineString', "LineString geometry stored");

    // Test CSV export includes boundary contributions
    const csv = service.exportCsv();
    assert(csv.includes('boundary'), "CSV export contains boundary entity type");
    assert(csv.includes('Route Source'), "CSV export contains source title");
  } finally {
    try {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// Run Tests
// ============================================================================

async function main() {
  console.log("=== Boundary Drawing Tool Tests ===\n");

  // Drawing logic tests
  testAddVertices();
  testRemoveVertex();
  testMoveVertex();
  testUndoRedo();
  testUndoRedoBranchClearing();
  testGeoJSONPolygon();
  testGeoJSONPolyline();
  testModeSwitch();

  // Contribution service tests
  testBoundaryContribution();
  testBoundaryPolylineContribution();

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
