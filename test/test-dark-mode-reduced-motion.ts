/**
 * Test script for dark mode and reduced motion features
 * Run with: npx tsx test/test-dark-mode-reduced-motion.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// === Test 1: Dark mode hook file exists and has correct structure ===
console.log("\n=== Dark Mode Hook ===");

const darkModeHookPath = path.resolve(__dirname, '../client/src/hooks/use-dark-mode.tsx');
const darkModeHookContent = fs.readFileSync(darkModeHookPath, 'utf-8');

assert(fs.existsSync(darkModeHookPath), 'use-dark-mode.tsx exists');
assert(darkModeHookContent.includes('pinakes-dark-mode'), 'Uses correct localStorage key');
assert(darkModeHookContent.includes('prefers-color-scheme: dark'), 'Respects OS dark mode preference');
assert(darkModeHookContent.includes("classList.toggle('dark'"), 'Toggles .dark class on documentElement');
assert(darkModeHookContent.includes('export function useDarkMode'), 'Exports useDarkMode hook');
assert(darkModeHookContent.includes('darkMode') && darkModeHookContent.includes('toggleDarkMode'), 'Returns darkMode state and toggleDarkMode function');
assert(darkModeHookContent.includes('addEventListener'), 'Listens for OS preference changes');

// === Test 2: Reduced motion hook file exists and has correct structure ===
console.log("\n=== Reduced Motion Hook ===");

const reducedMotionHookPath = path.resolve(__dirname, '../client/src/hooks/use-reduced-motion.tsx');
const reducedMotionHookContent = fs.readFileSync(reducedMotionHookPath, 'utf-8');

assert(fs.existsSync(reducedMotionHookPath), 'use-reduced-motion.tsx exists');
assert(reducedMotionHookContent.includes('pinakes-reduced-motion'), 'Uses correct localStorage key');
assert(reducedMotionHookContent.includes('prefers-reduced-motion: reduce'), 'Respects OS reduced motion preference');
assert(reducedMotionHookContent.includes("classList.toggle('reduce-motion'"), 'Toggles .reduce-motion class on documentElement');
assert(reducedMotionHookContent.includes('export function useReducedMotion'), 'Exports useReducedMotion hook');
assert(reducedMotionHookContent.includes('reducedMotion') && reducedMotionHookContent.includes('toggleReducedMotion'), 'Returns reducedMotion state and toggleReducedMotion function');
assert(reducedMotionHookContent.includes('addEventListener'), 'Listens for OS preference changes');

// === Test 3: CSS has dark mode variables ===
console.log("\n=== CSS Dark Mode Variables ===");

const cssPath = path.resolve(__dirname, '../client/src/index.css');
const cssContent = fs.readFileSync(cssPath, 'utf-8');

assert(cssContent.includes('.dark {'), 'Has .dark class theme variables');
assert(cssContent.includes('.high-contrast.dark {'), 'Has combined high-contrast + dark variables');

// Verify dark mode has key color overrides
const darkBlock = cssContent.substring(cssContent.indexOf('.dark {'), cssContent.indexOf('}', cssContent.indexOf('.dark {')) + 1);
assert(darkBlock.includes('--background:'), 'Dark mode overrides --background');
assert(darkBlock.includes('--foreground:'), 'Dark mode overrides --foreground');
assert(darkBlock.includes('--card:'), 'Dark mode overrides --card');
assert(darkBlock.includes('--primary:'), 'Dark mode overrides --primary');

// === Test 4: CSS has reduced motion rules ===
console.log("\n=== CSS Reduced Motion Rules ===");

assert(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'Has prefers-reduced-motion media query');
assert(cssContent.includes('.reduce-motion'), 'Has .reduce-motion class rules');
assert(cssContent.includes('animation-duration: 0.01ms'), 'Disables animations');
assert(cssContent.includes('transition-duration: 0.01ms'), 'Disables transitions');
assert(cssContent.includes('scroll-behavior: auto'), 'Disables smooth scrolling');

// === Test 5: Dashboard integrates hooks and toggles ===
console.log("\n=== Dashboard Integration ===");

const dashboardPath = path.resolve(__dirname, '../client/src/pages/dashboard.tsx');
const dashboardContent = fs.readFileSync(dashboardPath, 'utf-8');

assert(dashboardContent.includes("from \"@/hooks/use-dark-mode\""), 'Dashboard imports useDarkMode');
assert(dashboardContent.includes("from \"@/hooks/use-reduced-motion\""), 'Dashboard imports useReducedMotion');
assert(dashboardContent.includes('useDarkMode()'), 'Dashboard uses useDarkMode hook');
assert(dashboardContent.includes('useReducedMotion()'), 'Dashboard uses useReducedMotion hook');
assert(dashboardContent.includes('toggleDarkMode'), 'Dashboard has dark mode toggle handler');
assert(dashboardContent.includes('toggleReducedMotion'), 'Dashboard has reduced motion toggle handler');
assert(dashboardContent.includes('Moon'), 'Dashboard uses Moon icon for dark mode');
assert(dashboardContent.includes('Pause'), 'Dashboard uses Pause icon for reduced motion');

// Verify ARIA attributes
assert(dashboardContent.includes('aria-pressed={darkMode}'), 'Dark mode button has aria-pressed');
assert(dashboardContent.includes('aria-pressed={reducedMotion}'), 'Reduced motion button has aria-pressed');
assert(dashboardContent.includes('"Switch to light mode"') || dashboardContent.includes('"Switch to dark mode"'), 'Dark mode button has descriptive aria-label');
assert(dashboardContent.includes('"Reduce animations"') || dashboardContent.includes('"Enable animations"'), 'Reduced motion button has descriptive aria-label');

// === Test 6: Tailwind config supports dark mode ===
console.log("\n=== Tailwind Config ===");

const tailwindPath = path.resolve(__dirname, '../tailwind.config.ts');
const tailwindContent = fs.readFileSync(tailwindPath, 'utf-8');

assert(tailwindContent.includes('darkMode: ["class"]'), 'Tailwind uses class-based dark mode strategy');

// === Summary ===
console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
console.log("\n✓ All tests passed!");
