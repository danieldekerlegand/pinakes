/**
 * Tests for embed widget and screenshot export features
 * Run with: npx tsx test/test-embed-and-export.ts
 */

import { generateEmbedCode, type EmbedOptions } from '../web/src/lib/visualization/export-utils';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertIncludes(str: string, substr: string, message: string) {
  assert(str.includes(substr), message);
}

console.log('=== Embed Widget & Export Tests ===\n');

// Test 1: generateEmbedCode with defaults
console.log('Test 1: generateEmbedCode with default options');
{
  const code = generateEmbedCode('https://example.com', { view: 'tree' });
  assertIncludes(code, '<iframe', 'generates iframe element');
  assertIncludes(code, 'src="https://example.com/embed?', 'includes base URL with /embed path');
  assertIncludes(code, 'view=tree', 'includes view parameter');
  assertIncludes(code, 'theme=light', 'defaults to light theme');
  assertIncludes(code, 'width:100%', 'defaults to 100% width');
  assertIncludes(code, 'height:500px', 'defaults to 500px height');
  assertIncludes(code, 'border:none', 'removes border');
  assertIncludes(code, 'loading="lazy"', 'uses lazy loading');
  assertIncludes(code, 'title="pinakes', 'includes accessible title');
}

// Test 2: generateEmbedCode with custom options
console.log('\nTest 2: generateEmbedCode with custom options');
{
  const options: EmbedOptions = {
    view: 'map',
    width: 800,
    height: 600,
    theme: 'dark',
  };
  const code = generateEmbedCode('https://pinakes.io', options);
  assertIncludes(code, 'view=map', 'uses custom view');
  assertIncludes(code, 'theme=dark', 'uses dark theme');
  assertIncludes(code, 'width:800px', 'uses pixel width');
  assertIncludes(code, 'height:600px', 'uses pixel height');
  assertIncludes(code, 'title="pinakes - map visualization"', 'title includes view name');
}

// Test 3: generateEmbedCode with string width
console.log('\nTest 3: generateEmbedCode with string dimensions');
{
  const code = generateEmbedCode('https://example.com', {
    view: 'network',
    width: '50%',
    height: '400',
  });
  assertIncludes(code, 'width:50%', 'preserves string width');
  assertIncludes(code, 'height:400', 'preserves string height');
}

// Test 4: generateEmbedCode for each view type
console.log('\nTest 4: generateEmbedCode for each view type');
{
  const views = ['tree', 'network', 'timeline', 'map', 'explorer'] as const;
  for (const view of views) {
    const code = generateEmbedCode('https://example.com', { view });
    assertIncludes(code, `view=${view}`, `generates valid code for ${view} view`);
  }
}

// Test 5: URL encoding safety
console.log('\nTest 5: URL parameter safety');
{
  const code = generateEmbedCode('https://example.com', { view: 'tree', theme: 'light' });
  // Ensure the src attribute is properly formed
  const srcMatch = code.match(/src="([^"]+)"/);
  assert(srcMatch !== null, 'src attribute is properly quoted');
  if (srcMatch) {
    const url = new URL(srcMatch[1]);
    assert(url.pathname === '/embed', 'URL path is /embed');
    assert(url.searchParams.get('view') === 'tree', 'view param is correctly encoded');
    assert(url.searchParams.get('theme') === 'light', 'theme param is correctly encoded');
  }
}

// Test 6: border-radius in embed code
console.log('\nTest 6: Embed code includes rounded corners');
{
  const code = generateEmbedCode('https://example.com', { view: 'tree' });
  assertIncludes(code, 'border-radius:8px', 'includes border-radius for rounded appearance');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
