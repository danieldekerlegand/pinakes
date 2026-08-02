#!/usr/bin/env node
/**
 * Convert haplogroups.txt hierarchical tree to haplogroups.tsv
 * 
 * Parses the indented tree structure (lines 17+) from haplogroups.txt
 * and flattens it into TSV rows with parent_id references.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, '../data/source/haplogroups.txt');
const outputPath = path.join(__dirname, '../lexicons/haplogroups.tsv');

const content = fs.readFileSync(inputPath, 'utf-8');
const lines = content.split('\n');

// Estimated time origins for major haplogroups (years, negative = BCE)
// Based on published molecular clock estimates
const TIME_ORIGINS = {
  'A': -275000, 'B': -88000, 'CT': -70000, 'CF': -68000, 'DE': -65000,
  'C': -60000, 'D': -60000, 'E': -55000, 'F': -48000,
  'GHIJK': -46000, 'G': -45000, 'HIJK': -44000, 'H': -42000,
  'IJK': -40000, 'IJ': -38000, 'I': -35000, 'J': -32000,
  'K': -45000, 'LT': -40000, 'L': -30000, 'T': -28000,
  'M': -40000, 'NO': -38000, 'N': -36000, 'O': -35000,
  'P': -35000, 'Q': -30000, 'R': -28000, 'S': -40000,
  // Sub-haplogroups
  'C1': -45000, 'C2': -40000, 'C3': -20000, 'C4': -30000,
  'C-P39': -15000, 'C2b1a1a': -15000,
  'D1': -40000, 'D2': -35000, 'D3': -40000,
  'E1': -45000, 'E1a': -40000, 'E1b1a1': -35000, 'E1b1a2': -30000,
  'E1b1b1a': -25000, 'E-V12': -20000, 'E-V32': -15000,
  'E-V13': -10000, 'E-V22': -8000, 'E-V65': -10000,
  'E1b1b1b': -20000, 'E-M81': -5000, 'E-M183': -5000,
  'E2': -30000, 'E3': -25000,
  'G1': -20000, 'G2': -25000, 'G2A': -15000,
  'I1': -5000, 'I2': -18000,
  'J1': -20000, 'J1-Page08': -8000, 'J2': -25000,
  'L': -30000, 'T': -28000,
  'N3': -10000,
  'O1': -20000, 'O2': -18000, 'O3': -15000,
  'Q1': -15000, 'Q2': -10000, 'Q3': -12000,
  'R1a': -22000, 'R1b': -18000, 'R2': -25000,
};

// Geographic origins for major haplogroups
const GEO_ORIGINS = {
  'A': 'East Africa', 'B': 'Central Africa', 'CT': 'Africa',
  'CF': 'Southwest Asia', 'DE': 'Africa/Southwest Asia',
  'C': 'Central Asia', 'D': 'East Asia', 'E': 'East Africa',
  'F': 'South Asia', 'G': 'Caucasus', 'H': 'South Asia',
  'I': 'Europe', 'J': 'Middle East', 'K': 'Southeast Asia',
  'L': 'South Asia', 'M': 'Melanesia', 'N': 'East Asia',
  'O': 'East Asia', 'P': 'Central Asia', 'Q': 'Central Asia',
  'R': 'Central Asia', 'S': 'Melanesia', 'T': 'Middle East',
  'I1': 'Scandinavia', 'I2': 'Balkans',
  'J1': 'Middle East', 'J2': 'Caucasus/Anatolia',
  'R1a': 'Pontic-Caspian Steppe', 'R1b': 'Western Europe',
  'R2': 'South Asia',
  'N3': 'Siberia/Finland',
  'O1': 'Southeast Asia', 'O2': 'Southeast Asia', 'O3': 'East Asia',
  'Q1': 'Beringia', 'Q3': 'Americas',
  'G1': 'Central Asia', 'G2': 'Caucasus/Anatolia', 'G2A': 'Iran',
  'E1b1a1': 'West Africa', 'E-V13': 'Balkans', 'E-M81': 'North Africa',
};

// Parse the hierarchical tree section (lines starting with *)
const haplogroups = [];
const parentStack = []; // Stack of [indent_level, haplogroup_id]

// Process lines from the tree section
let inTree = false;
for (const line of lines) {
  // Start of the tree section
  if (line.includes('Y-chromosome Haplogroup Ethnicities General')) {
    inTree = true;
    continue;
  }
  if (!inTree) continue;
  if (!line.trim()) continue;

  // Match lines like "* A: Khoisan, Nilo-Saharan" or "    * CF:" etc.
  const match = line.match(/^(\s*)\*\s+([^:]+):\s*(.*)/);
  if (!match) continue;

  const [, indent, rawId, associations] = match;
  const indentLevel = indent.length;

  // Clean up the haplogroup ID
  // Handle cases like "C-P39/C2b1a1a" -> use first part as id
  let hapId = rawId.trim();
  let altNames = '';
  if (hapId.includes('/')) {
    const parts = hapId.split('/');
    hapId = parts[0].trim();
    altNames = parts.slice(1).join(', ').trim();
  }
  // Handle cases like "C1/C2 (Austronesian)" or "C*/C1"
  const parenMatch = hapId.match(/^(.+?)\s*\((.+)\)$/);
  if (parenMatch) {
    hapId = parenMatch[1].trim();
  }
  // Handle wildcard notation like "C*" -> "C-star"
  if (hapId.endsWith('*')) {
    hapId = hapId.replace('*', '-star');
  }

  // Determine parent from indent stack
  while (parentStack.length > 0 && parentStack[parentStack.length - 1][0] >= indentLevel) {
    parentStack.pop();
  }
  const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1][1] : null;
  parentStack.push([indentLevel, hapId]);

  // Parse associated groups
  const assocGroups = associations
    .split(',')
    .map(g => g.trim())
    .filter(g => g.length > 0);

  // Slugify for TSV id
  const tsvId = hapId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const timeOrigin = TIME_ORIGINS[hapId] ?? TIME_ORIGINS[hapId.split('-')[0]] ?? null;
  const geoOrigin = GEO_ORIGINS[hapId] ?? GEO_ORIGINS[hapId.split('-')[0]] ?? '';

  haplogroups.push({
    id: tsvId,
    name: hapId,
    parentId: parentId ? parentId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : 'null',
    haplogroupType: 'Y-chromosome',
    description: assocGroups.length > 0
      ? `Associated with: ${assocGroups.join(', ')}`
      : `Y-chromosome haplogroup ${hapId}`,
    associatedLanguageFamilyIds: JSON.stringify(
      assocGroups.filter(g =>
        // Filter for likely language family names (heuristic)
        !['Cro-Magnon', 'Aurignacian', 'Gravettian', 'Epi-Gravettian', 'Solutrean',
          'Magdalenian', 'Pitted Ware', 'EEF', 'ANF', 'Yamnaya', 'Bell Beaker',
          'Western Hunter Gatherer', 'Eastern Hunter Gatherer',
          'Pygmy', 'Negrito', 'Aeta', 'Roma', 'Kalash',
          'Ötzi', 'Jomon-Japanese', 'Yayoi-Japanese',
          'Indus Valley Civilization', 'Marsh Arab'
        ].includes(g)
      ).map(g => g.toLowerCase().replace(/\s+/g, '-'))
    ),
    associatedCivilizationIds: '[]',
    geographicOrigin: geoOrigin,
    timeOrigin: timeOrigin ?? 'null',
    sources: '["ISOGG Y-DNA Haplogroup Tree","Genetic studies"]',
  });
}

// Build TSV
const header = 'id\tname\tparent_id\thaplogroup_type\tdescription\tassociated_language_family_ids\tassociated_civilization_ids\tgeographic_origin\ttime_origin\tsources';

const rows = haplogroups.map(h =>
  `${h.id}\t${h.name}\t${h.parentId}\t${h.haplogroupType}\t${h.description}\t${h.associatedLanguageFamilyIds}\t${h.associatedCivilizationIds}\t${h.geographicOrigin}\t${h.timeOrigin}\t${h.sources}`
);

fs.writeFileSync(outputPath, [header, ...rows].join('\n'), 'utf-8');

console.log(`Converted ${haplogroups.length} haplogroups to ${outputPath}`);
console.log('\nSample entries:');
haplogroups.slice(0, 5).forEach(h => {
  console.log(`  ${h.name} (parent: ${h.parentId}) → ${h.geographicOrigin || '?'}, ${h.timeOrigin} yr`);
});
console.log('\nTree depth check:');
const maxDepth = haplogroups.reduce((max, h) => {
  let depth = 0;
  let cur = h.parentId;
  while (cur && cur !== 'null' && depth < 20) {
    const parent = haplogroups.find(p => p.id === cur);
    if (!parent) break;
    cur = parent.parentId;
    depth++;
  }
  return Math.max(max, depth);
}, 0);
console.log(`  Max tree depth: ${maxDepth}`);
