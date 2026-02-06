# Lexicon Data Migration Summary

## Date: December 23, 2024

## Overview
Successfully merged the northeuralex and scraped language data into a unified structure in the `lexicons/` directory.

## Changes Made

### 1. Data Merging
- Merged language data from `northeuralex-0.9-language-data.tsv` into `scraped/languages.tsv`
- Added 97 new languages from NorthEuraLex (10 were duplicates and skipped)
- Added 58 new families/subfamilies from NorthEuraLex
- Final counts:
  - **357 families** (up from 299)
  - **852 languages** (up from 755)

### 2. File Reorganization
Renamed and moved files to unified structure:

**Old Structure:**
```
lexicons/
├── northeuralex/
│   ├── northeuralex-0.9-forms.tsv
│   ├── northeuralex-0.9-concept-data.tsv
│   └── northeuralex-0.9-language-data.tsv
└── scraped/
    ├── families.tsv
    ├── languages.tsv
    └── [language-id].tsv (per-language word lists)
```

**New Structure:**
```
lexicons/
├── words.tsv (formerly northeuralex-0.9-forms.tsv)
├── words-base.tsv (formerly northeuralex-0.9-concept-data.tsv)
├── families.tsv (merged from scraped/families.tsv)
├── languages.tsv (merged from scraped/languages.tsv)
└── [language-id].tsv (per-language word lists)
```

### 3. Code Updates

Updated all references to use new unified paths:

#### `server/tsv-storage.ts`
- Updated default paths in constructor
- Simplified `loadLanguagesAndFamilies()` to use unified files
- Updated `loadScrapedFamilies()` and `loadScrapedLanguages()` to read from `lexicons/`
- Updated `loadScrapedForms()` to read from `lexicons/` and exclude new unified files

#### `server/services/word-list-scraper.ts`
- Updated output path from `lexicons/scraped/` to `lexicons/`

#### `server/services/language-family-scraper-tsv.ts`
- Updated output paths to write to `lexicons/families.tsv` and `lexicons/languages.tsv`

#### `scripts/split-northeuralex-forms.ts`
- Updated default input path to `lexicons/words.tsv`
- Updated default output directory to `lexicons/by-language`

### 4. Removed Directories
- Deleted `lexicons/northeuralex/`
- Deleted `lexicons/scraped/`

## File Statistics

| File | Lines | Description |
|------|-------|-------------|
| `families.tsv` | 358 | Language family hierarchy (merged) |
| `languages.tsv` | 853 | Language metadata (merged) |
| `words.tsv` | 121,614 | Word forms with IPA transcriptions |
| `words-base.tsv` | 1,017 | Base vocabulary concepts |

## Data Source Labels

The UI still maintains data source filters ("NorthEuraLex" and "AI Scraped") for user convenience. These are now purely display labels - the actual data is unified in the backend. Each language and family retains a `source` field indicating its origin:
- `source: "northeuralex"` - Originally from NorthEuraLex dataset
- `source: "scraped"` - Generated via AI scraping

## Testing

- ✅ Build successful (`npm run build`)
- ✅ All TypeScript compilation passed
- ✅ File structure verified
- ✅ Data integrity confirmed (no duplicate IDs)

## Migration Script

The merge was performed using `scripts/merge-language-data.py`, which:
1. Read northeuralex language data
2. Read scraped languages and families
3. Checked for duplicates (skipped 10 duplicate languages)
4. Created necessary family/subfamily entries
5. Wrote merged data to scraped files
6. Files were then moved to unified structure

## Next Steps

The application now uses a unified lexicon structure. Future language data additions should be made directly to:
- `lexicons/families.tsv` - for new language families
- `lexicons/languages.tsv` - for new languages
- `lexicons/[language-id].tsv` - for per-language word lists
