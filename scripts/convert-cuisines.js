#!/usr/bin/env node
/**
 * Convert top_100_foods_by_cuisine.csv to cuisine-items.tsv with temporal data
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the CSV file
const csvPath = path.join(__dirname, '../data/source/top_100_foods_by_cuisine.csv');
const tsvPath = path.join(__dirname, '../lexicons/cuisine-items.tsv');

const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.trim().split('\n');

// Cuisine ID mapping
const cuisineIdMap = {
  'Chinese': 'chinese',
  'Ethiopian': 'ethiopian',
  'French': 'french',
  'Georgian': 'georgian',
  'German': 'german',
  'Greek': 'greek',
  'Hungarian': 'hungarian',
  'Indian': 'indian',
  'Indonesian': 'indonesian',
  'Iranian': 'iranian',
  'Italian': 'italian',
  'Japanese': 'japanese',
  'Korean': 'korean',
  'Mexican': 'mexican',
  'Peruvian': 'peruvian',
  'Polish': 'polish',
  'Portuguese': 'portuguese',
  'Spanish': 'spanish',
  'Thai': 'thai',
  'Turkish': 'turkish',
  'Vietnamese': 'vietnamese',
};

// Estimated time origins based on cuisine and dish patterns
// Using approximate eras per Opus 4.5 guidance
function estimateTimeOrigin(cuisine, foodItem, foodType) {
  const item = foodItem.toLowerCase();
  
  // Modern dishes (20th century American-Chinese, fusion, etc.)
  const modernDishes = [
    'general tso', 'orange chicken', 'fortune cookie', 'california roll',
    'korean fried chicken', 'fusion', 'modern'
  ];
  if (modernDishes.some(d => item.includes(d))) {
    return 1950;
  }
  
  // Post-Columbian Exchange dishes (contain tomatoes, peppers, potatoes)
  const columbianExchangeIndicators = [
    'tomato', 'potato', 'chili', 'pepper', 'corn', 'chocolate'
  ];
  if (cuisine === 'Italian' && columbianExchangeIndicators.some(i => item.includes(i))) {
    return 1550;
  }
  
  // Medieval/Renaissance period dishes
  if (['French', 'German', 'Polish', 'Hungarian'].includes(cuisine)) {
    if (foodType === 'Soup' || foodType === 'Stew') return 800;
    return 1200;
  }
  
  // Ancient cuisines defaults
  const ancientCuisines = {
    'Chinese': -500,
    'Indian': -1000,
    'Greek': -800,
    'Iranian': -1000,
    'Ethiopian': -500,
    'Mexican': -2000, // Mesoamerican origins
    'Peruvian': -1000,
  };
  
  if (ancientCuisines[cuisine]) {
    return ancientCuisines[cuisine];
  }
  
  // Southeast Asian cuisines
  if (['Thai', 'Vietnamese', 'Indonesian'].includes(cuisine)) {
    return 500;
  }
  
  // East Asian
  if (['Japanese', 'Korean'].includes(cuisine)) {
    return 500;
  }
  
  // Mediterranean
  if (['Italian', 'Spanish', 'Portuguese', 'Turkish'].includes(cuisine)) {
    return -200;
  }
  
  // Caucasus
  if (cuisine === 'Georgian') {
    return -300;
  }
  
  // Default
  return 1000;
}

// Generate slug ID from food name
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Parse CSV (handling commas in quoted fields)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Process lines
const tsvLines = ['id\tcuisine_id\tname\tfood_type\ttime_origin\ttime_end'];

for (let i = 1; i < lines.length; i++) {
  const parts = parseCSVLine(lines[i]);
  if (parts.length < 4) continue;
  
  const [cuisine, itemNum, foodItem, foodType] = parts;
  if (!cuisine || cuisine === 'Cuisine') continue;
  
  const cuisineId = cuisineIdMap[cuisine];
  if (!cuisineId) {
    console.warn(`Unknown cuisine: ${cuisine}`);
    continue;
  }
  
  const id = `${cuisineId}-${slugify(foodItem)}`;
  const timeOrigin = estimateTimeOrigin(cuisine, foodItem, foodType);
  
  tsvLines.push(`${id}\t${cuisineId}\t${foodItem}\t${foodType}\t${timeOrigin}\tnull`);
}

// Write TSV
fs.writeFileSync(tsvPath, tsvLines.join('\n'), 'utf-8');

console.log(`Converted ${tsvLines.length - 1} cuisine items to ${tsvPath}`);
console.log('Sample entries:');
tsvLines.slice(1, 6).forEach(line => console.log('  ' + line));
