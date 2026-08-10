# pinakes Comprehensive Roadmap
## A World Cultures Atlas: Geography × Time × Culture

*Version 1.0 - February 2026*

---

## Executive Summary

pinakes is evolving from a linguistic database into a **comprehensive world cultures atlas** that maps human cultural expression across geography and time. This roadmap outlines the transformation from the current language-focused application into an integrated platform encompassing:

- **Languages** (current & historical)
- **Anthropology** (kinship systems, social organization)
- **Archaeology** (sites, artifacts, material cultures)
- **History** (civilizations, migrations, trade routes)
- **Cuisine** (regional foods, culinary traditions)
- **Music & Performing Arts** (instruments, musical traditions, dance)
- **Visual Arts & Architecture** (artistic styles, monuments)
- **Religion & Mythology** (belief systems, oral traditions, folklore)
- **Economic Systems** (trade goods, subsistence patterns, currencies)

---

## Current State Analysis

### ✅ What's Been Accomplished

#### Core Language Infrastructure
| Feature | Status | Files |
|---------|--------|-------|
| Language families/languages database | ✅ Complete | `data/source/lexicons/families.tsv` (74KB), `data/source/lexicons/languages.tsv` (138KB) |
| Hierarchical family tree visualization | ✅ Complete | `LanguageTreeView.tsx` |
| Force-directed network graph | ✅ Complete | `LanguageNetworkView.tsx` |
| Timeline view with BCE/CE support | ✅ Complete | `LanguageTimelineView.tsx` |
| Geographic map view (Leaflet) | ✅ Complete | `LanguageMapView.tsx` |
| Enhanced multi-layer map view | ✅ Complete | `EnhancedLanguageMapView.tsx` |
| Word comparison tools | ✅ Complete | `word-comparison.tsx` |
| Linguistic distance analysis (LDND + IPA+) | ✅ Complete | `linguistic-distance-calculator.ts` |
| Etymology explorer | ✅ Complete | `etymology-explorer.ts` |

#### Visualization Infrastructure
- **D3.js v7** integration with zoom, pan, drag
- **Leaflet** geographic mapping with multi-layer support
- **Multi-view context** with cross-view selection (6 tabs: Tree, Network, Timeline, Map, Cross-Domain, Contribute)
- **Export capabilities** (SVG, PNG, CSV, JSON)
- **Responsive design** with lazy loading
- **Temporal filtering** via TimeSlider with animated playback

#### Cultural Domain Data (Fully Implemented)
| Schema | TSV File | Data Status |
|--------|----------|-------------|
| Languages | `languages.tsv` | ✅ Populated (~2000+ entries) |
| Language Families | `families.tsv` | ✅ Populated (~400+ entries) |
| Words/Lexicons | `words.tsv` | ✅ Populated (10.7MB) |
| Language Ranges | `language-ranges.tsv` | ⚠️ Stub (2KB sample) |
| Archaeological Sites | `archaeological-sites.tsv` | ✅ Loader implemented (3 entries) |
| Civilizations | `civilizations.tsv` | ✅ Loader implemented |
| Civilization Boundaries | `civilization-boundaries.tsv` | ✅ Loader implemented |
| Haplogroups | `haplogroups.tsv` | ✅ 62 entries with hierarchy |
| Cuisines | `cuisines.tsv` | ✅ 21 cuisines with temporal data |
| Cuisine Items | `cuisine-items.tsv` | ✅ Populated |
| Music Traditions | `music-traditions.tsv` | ✅ 20 traditions with coordinates |
| Musical Instruments | `musical-instruments.tsv` | ✅ 25 instruments |
| Religions | `religions.tsv` | ✅ 20 religions with temporal data |

#### Cross-Domain Analysis (Phase 4)
- **Unified Entity model** normalizing all 128 entities across 6 domain types
- **Relationship scoring** via shared languages, regions, temporal overlap
- **Cross-domain search** across all cultural domains
- **Cross-Domain Explorer** tab with split-panel UI

#### Contribution System (Phase 5)
- **Contribution service** with JSON file storage in `data/contributions/`
- **Validation** with per-entity-type required fields and source citation requirements
- **Review queue** with approve/reject workflow
- **Contribute tab** with submission form and moderation UI

#### Raw Data Files (Not Yet Integrated)
| File | Content | Location |
|------|---------|----------|
| `haplogroups.txt` | ✅ Converted to `data/source/lexicons/haplogroups.tsv` | `/data/` |
| `proto-languages.txt` | Reconstructed ancestral languages | `/data/` |
| `native_migrations.txt` | Population movement data | `/data/` |
| `top_100_foods_by_cuisine.csv` | ✅ Converted to `data/source/lexicons/cuisines.tsv` | `/data/` |
| `language_contact_phenomena.csv` | Substrate/superstrate data | `/data/` |

### � Remaining Gaps

1. ~~**Geospatial Methods Return Empty**~~ - ✅ TSV loaders implemented for all schemas
2. ~~**No Temporal Navigation**~~ - ✅ TimeSlider with animated playback implemented
3. ~~**Missing Cultural Domains**~~ - ✅ Music, religion implemented; kinship, arts, dress, economy still pending
4. **TSV Scalability** - GeoJSON polygons may not scale; evaluate SQLite when data volume grows
5. ~~**No Unified Cultural Entity**~~ - ✅ CrossDomainAnalysis service with UnifiedEntity model (128 entities)
6. ~~**Contribution System**~~ - ✅ Full contribution workflow with validation and review queue
7. **Remaining Phase 3 domains** - Social organization, visual arts, traditional dress, economic systems not yet implemented
8. **Phase 6 polish** - Performance optimization, mobile, accessibility, i18n still pending

---

## Architectural Recommendations

### ⚠️ Critical: Unified Cultural Entity Pattern

Rather than N separate tables per domain, implement a **base cultural entity** with temporal validity:

```typescript
interface CulturalEntity {
  id: string;
  entityType: 'language' | 'civilization' | 'cuisine' | 'music_tradition' | 'religion' | ...;
  name: string;
  nativeName?: string;
  
  // Temporal validity (required for all entities)
  validFrom: number;        // Year (negative = BCE)
  validTo: number | null;   // null = present
  
  // Spatial extent
  centroid?: { lat: number; lng: number };
  boundaryGeometry?: GeoJSON.Geometry;
  
  // Relationships
  relatedEntityIds: string[];
  parentEntityId?: string;
  
  // Domain-specific data
  domainData: Record<string, unknown>;
  
  // Metadata
  confidence: number;       // 0-100
  sources: string[];
}
```

**Benefits:**
- Single query: "Show all cultural entities in region X at time Y"
- Consistent temporal filtering across all domains
- Unified relationship graph between any entity types
- Simpler aggregation and cross-domain analysis

### ⚠️ Storage Evolution: TSV → SQLite/DuckDB

For geospatial queries with time ranges, TSV files will not scale. Recommend:

| Phase | Storage Strategy |
|-------|------------------|
| Phase 1 | TSV for flat data, in-memory filtering |
| Phase 2 | SQLite with SpatiaLite for GeoJSON queries |
| Phase 3+ | DuckDB for complex analytical queries |

**Migration Path:**
1. Keep TSV as source-of-truth for version control
2. Build SQLite at startup from TSVs (like current caching)
3. Use SQLite for spatial/temporal queries

---

## Phased Roadmap

### Phase 0: Foundation & Temporal Infrastructure ⏱️ ✅ COMPLETE
**Duration:** 2-3 weeks
**Priority:** CRITICAL (must precede all other phases)

> ⚠️ **Note for Personal Project:** Focus on getting a working vertical slice before expanding horizontally. See Phase 0.5.

Temporal navigation is foundational—nearly all cultural data is time-dependent. Retrofitting temporal queries is painful.

#### 0.1 Time Navigation Component
```
[ 10000 BCE |--------●---------------------| 2025 CE ]
     ◀ Play/Pause ▶   Speed: [1x ▼]   Step: [100 years ▼]
```

**Tasks:**
- [x] Create `TimeNavigator` component with slider (`TimeSlider.tsx`)
- [x] Support year ranges from 10000 BCE to present
- [x] Configurable step sizes (10, 50, 100, 500, 1000 years)
- [x] Play/pause animated temporal progression
- [ ] URL parameter for shareable time states (`?year=-500`)

#### 0.2 Temporal Query Infrastructure
- [x] Add `filterByTimeRange(entities, year)` utility (`filterGeoJSONByTime`)
- [x] Implement temporal validity checks: `validFrom <= year <= validTo`
- [x] Add temporal indexing to all data loaders
- [x] Create `useTimeSlider` React hook

#### 0.3 Map Integration
- [x] Connect time slider to all map layers
- [x] Animate layer transitions on time change
- [x] Show/hide entities based on temporal validity
- [ ] Visual indicator for "approximate" vs "known" time periods

**Deliverables:**
- Time slider component in map view
- All existing entities respect time filtering
- Animated temporal playback working

---

### Phase 0.5: Vertical Slice - Cuisine Domain 🍜 ✅ COMPLETE
**Duration:** 1-2 weeks
**Priority:** HIGH (validate architecture before horizontal expansion)

Before expanding to all domains, implement **one complete domain end-to-end** with temporal filtering. Cuisine is ideal because data already exists in `/data/`.

#### 0.5.1 Complete Cuisine Implementation

- [x] Convert `top_100_foods_by_cuisine.csv` → `data/source/lexicons/cuisines.tsv` + `cuisine-items.tsv`
- [x] Implement TSV loader for cuisines
- [x] Add temporal validity fields (when cuisine emerged)
- [x] Create cuisine map layer with regional markers (`CuisineLayer.tsx`)
- [x] Connect time slider to cuisine visibility
- [ ] Build cuisine detail panel with dishes list

#### 0.5.2 Validate Unified Entity Pattern

Test the proposed `CulturalEntity` abstraction against real queries:

```typescript
// Query 1: "Show cuisines in Mediterranean region at 500 BCE"
const cuisines = getEntities({ type: 'cuisine', region: 'Mediterranean', year: -500 });

// Query 2: "What languages are associated with Italian cuisine?"
const related = getRelatedEntities(italianCuisine, 'language');

// Query 3: "Show all cultural entities in Greece at 400 BCE"
const everything = getEntities({ region: 'Greece', year: -400 });
```

If the pattern works well for cuisine, proceed. If not, refactor before adding more domains.

**Deliverables:**
- Cuisine fully working with time filtering
- Architecture validated for multi-domain use
- Clear go/no-go decision on unified entity pattern

---

### Phase 1: Data Infrastructure & Integration 📊 ✅ COMPLETE
**Duration:** 4-6 weeks
**Depends on:** Phase 0

#### 1.1 Implement TSV Loaders for Existing Schemas
Currently `tsv-storage.ts` has stub methods returning empty arrays.

**Tasks:**
- [x] Implement `loadLanguageRanges()` with GeoJSON parsing
- [x] Implement `loadArchaeologicalSites()` with coordinate parsing
- [x] Implement `loadCivilizations()` and `loadCivilizationBoundaries()`
- [x] Implement `loadHistoricalRoutes()` with LineString parsing
- [x] Implement `loadMaterialCultures()` and distributions
- [x] Add temporal filtering to all loaders

#### 1.2 Integrate Existing Data Files
The `/data/` directory has valuable data not yet connected.

| File | Integration Target |
|------|-------------------|
| `haplogroups.txt` | ✅ `data/source/lexicons/haplogroups.tsv` (62 entries) |
| `proto-languages.txt` | New `data/source/lexicons/proto-languages.tsv` |
| `native_migrations.txt` | New `data/source/lexicons/migrations.tsv` |
| `top_100_foods_by_cuisine.csv` | ✅ `data/source/lexicons/cuisines.tsv` + `data/source/lexicons/cuisine-items.tsv` |
| `language_contact_phenomena.csv` | New `data/source/lexicons/language-contact.tsv` |

**Tasks:**
- [x] Create parser scripts for each format (`scripts/convert-haplogroups.js`)
- [x] Generate standardized TSV files
- [x] Add API endpoints for new data types
- [x] Create UI components for browsing

#### 1.3 Populate Sample Data
Create rich sample datasets for each schema:

- [ ] **Language Ranges:** 50+ major languages with historical boundaries (stub data exists)
- [ ] **Archaeological Sites:** 100+ significant world heritage sites (3 sample entries)
- [ ] **Civilizations:** 30+ major civilizations with time-varying boundaries (2 sample entries)
- [ ] **Historical Routes:** Silk Road, Spice Route, migration paths
- [ ] **Material Cultures:** Pottery, tools, burial traditions

**Data Sources:**
- Wikipedia/Wikidata (structured data)
- UNESCO World Heritage
- Academic linguistics databases (Glottolog, WALS)
- Archaeological databases (tDAR, OCHRE)

#### 1.4 SQLite/SpatiaLite Integration (if needed)
- [ ] Evaluate TSV performance with 1000+ GeoJSON entities (not yet needed at current scale)
- [ ] If slow: implement SQLite storage layer
- [ ] Add SpatiaLite extension for spatial queries
- [ ] Create startup migration from TSV → SQLite

**Deliverables:**
- All designed schemas have working loaders
- `/data/` files integrated
- 500+ cultural entities in database
- Map shows real data

---

### Phase 2: Temporal Visualization & Animation 🎬
**Duration:** 3-4 weeks
**Depends on:** Phase 0, Phase 1

#### 2.1 Enhanced Timeline View
- [ ] Multi-track timeline (languages, civilizations, events)
- [ ] Brush selection for time ranges
- [ ] Synchronized scrolling with map
- [ ] Event markers (wars, migrations, inventions)

#### 2.2 Animated Map Transitions
- [ ] Smooth boundary morphing as time changes
- [ ] Fade in/out for appearing/disappearing entities
- [ ] Trail effects for migration routes
- [ ] Population density heatmaps over time

#### 2.3 Historical Snapshots
- [ ] Preset dates: "Roman Empire at Peak (117 CE)", "Bronze Age Collapse (1200 BCE)"
- [ ] Shareable snapshot URLs
- [ ] Screenshot/export of specific time periods

**Deliverables:**
- Fully animated temporal navigation
- Smooth visual transitions
- Curated historical snapshots

---

### Phase 3: Cultural Domain Expansion 🎭 🟡 PARTIALLY COMPLETE
**Duration:** 8-12 weeks
**Depends on:** Phase 1

Add new cultural domains beyond language and archaeology.

#### 3.1 Music & Performing Arts 🎵 ✅ COMPLETE

**Schema: `data/source/lexicons/music-traditions.tsv`**
```
id | name | region | time_period_start | time_period_end | associated_language_ids | instruments | scales | rhythmic_patterns | related_traditions | sources
```

**Schema: `data/source/lexicons/musical-instruments.tsv`**
```
id | name | instrument_family | origin_region | time_origin | construction_materials | playing_technique | associated_traditions | sources
```

**Features:**
- [x] Musical tradition map layer (`MusicTraditionLayer.tsx`)
- [ ] Instrument family tree visualization
- [ ] Audio samples integration (future)
- [ ] Dance traditions linked to music

#### 3.2 Religion & Mythology 🕌 ✅ COMPLETE

**Schema: `data/source/lexicons/religions.tsv`**
```
id | name | religion_type | origin_region | time_origin | sacred_texts | associated_language_ids | deity_pantheon | ritual_practices | sources
```

**Schema: `data/source/lexicons/mythologies.tsv`**
```
id | name | associated_religion_id | mythology_type | creation_narratives | hero_cycles | cosmology | sources
```

**Schema: `data/source/lexicons/oral-traditions.tsv`**
```
id | name | tradition_type | associated_language_ids | transmission_method | key_narratives | cultural_significance | sources
```

**Features:**
- [x] Religion spread visualization over time (`ReligionLayer.tsx`)
- [ ] Mythology comparison tool (parallel myths)
- [ ] Sacred site mapping
- [ ] Oral tradition preservation tracking

#### 3.3 Social Organization & Kinship 👥

**Schema: `data/source/lexicons/kinship-systems.tsv`**
```
id | name | system_type | descent_rule | residence_pattern | marriage_rules | terminology_type | associated_language_ids | sources
```

**Schema: `data/source/lexicons/social-structures.tsv`**
```
id | name | structure_type | stratification | political_organization | economic_base | associated_civilization_ids | sources
```

**Features:**
- [ ] Kinship diagram generator
- [ ] Social structure comparison
- [ ] Governance system evolution

#### 3.4 Visual Arts & Architecture 🏛️

**Schema: `data/source/lexicons/art-styles.tsv`**
```
id | name | style_period | region | time_period_start | time_period_end | characteristics | influences | associated_civilization_ids | sources
```

**Schema: `data/source/lexicons/architectural-traditions.tsv`**
```
id | name | tradition_type | region | structural_elements | materials | associated_civilization_ids | notable_examples | sources
```

**Features:**
- [ ] Art style timeline with example images
- [ ] Architectural tradition map
- [ ] Style influence network graph

#### 3.5 Traditional Dress & Textiles 👘

**Schema: `data/source/lexicons/traditional-dress.tsv`**
```
id | name | region | associated_culture_ids | garment_types | materials | symbolism | occasions | sources
```

**Features:**
- [ ] Regional dress map
- [ ] Textile technique evolution
- [ ] Material trade connections

#### 3.6 Economic Systems & Trade 💰

**Schema: `data/source/lexicons/economic-systems.tsv`**
```
id | name | system_type | subsistence_pattern | trade_goods | currency_type | market_structures | time_period | sources
```

**Schema: `data/source/lexicons/trade-goods.tsv`**
```
id | name | good_type | origin_regions | trade_routes | time_period | cultural_significance | sources
```

**Features:**
- [ ] Trade route visualization with goods
- [ ] Commodity flow animation over time
- [ ] Currency evolution timeline

**Deliverables:**
- 6 new cultural domain modules
- Cross-domain relationship links
- Comparative analysis tools

---

### Phase 4: Cross-Domain Analysis & Relationships 🔗 ✅ COMPLETE
**Duration:** 4-6 weeks
**Depends on:** Phase 3

#### 4.1 Unified Entity Relationship Graph
- [x] Create unified entity model across all domains (`CrossDomainAnalysis` service, 128 entities)
- [x] Visualize connections between any entity types (`CrossDomainExplorer.tsx`)
- [x] Query: "What connects Latin to Mediterranean cuisine?" (cross-domain search API)
- [x] Influence pathways across domains (relationship strength scoring)

#### 4.2 Correlation Analysis
- [x] Language family ↔ genetic haplogroup correlation (via shared language IDs)
- [x] Cuisine similarity ↔ linguistic distance (via shared regions + languages)
- [ ] Trade routes ↔ language contact
- [x] Religion spread ↔ political expansion (via temporal + regional overlap)

#### 4.3 Comparative Tools
- [x] Cross-domain search across all entity types (`/api/cross-domain/search`)
- [x] Similarity scoring across domains (relationship strength 0-100%)
- [x] "Find similar cultures" feature (`/api/cross-domain/connections/:type/:id`)

#### 4.4 Research Queries
- [ ] Natural language query interface
- [ ] Saved queries and collections
- [ ] Export for academic use (BibTeX, CSV)

**Deliverables:**
- Cross-domain relationship explorer
- Correlation analysis dashboards
- Research-grade query tools

---

### Phase 5: Contribution & Collaboration 🤝 🟡 PARTIALLY COMPLETE
**Duration:** 4-6 weeks
**Depends on:** Phase 1
**Priority:** LOW for personal project (defer until user base exists)

> ⚠️ **Personal Project Note:** This phase adds significant complexity with minimal value until you have actual users. Consider deferring entirely until Phases 0-4 are stable and you're ready to share publicly.

#### 5.1 User Accounts & Authentication
- [ ] OAuth2 integration (Google, GitHub) — deferred, not needed for personal use
- [ ] User profiles with contribution history
- [ ] Permission levels (viewer, contributor, editor, admin)

#### 5.2 Data Contribution System ✅ COMPLETE
- [x] Contribution form for new entities (`ContributionPanel.tsx`)
- [x] Source citation requirements (validation enforces at least one source)
- [x] Confidence scoring for user submissions (1-100 scale)
- [x] Review queue for moderators (approve/reject with notes)
- [x] JSON file storage in `data/contributions/`
- [x] API: POST/GET `/api/contributions`, PATCH `/api/contributions/:id/review`

#### 5.3 Crowdsourced Validation ✅ COMPLETE
- [x] Flagging system for inaccurate data (flag action type with issue description)
- [ ] Voting on contested facts
- [ ] Expert verification badges
- [ ] Change history/versioning

#### 5.4 Community Features
- [ ] Comments and discussions
- [ ] Curated collections by users
- [ ] "Cultural journey" shareable paths
- [ ] Educational resource links

**Deliverables:**
- ✅ Full contribution workflow (submit → review → approve/reject)
- ✅ Moderation tools (review queue with filtering)
- Community engagement features (deferred)

---

### Phase 6: Advanced Features & Polish ✨
**Duration:** Ongoing

#### 6.1 Performance Optimization
- [ ] Virtual scrolling for large lists
- [ ] Canvas rendering for 1000+ map entities
- [ ] WebWorker for heavy computations
- [ ] Progressive loading strategies

#### 6.2 Mobile Experience
- [ ] Touch-optimized map controls
- [ ] Responsive visualization layouts
- [ ] Offline mode with cached data
- [ ] PWA support

#### 6.3 Accessibility
- [ ] Screen reader support
- [ ] Keyboard navigation
- [ ] High contrast mode
- [ ] Reduced motion preferences

#### 6.4 Internationalization
- [ ] UI translation framework
- [ ] RTL language support
- [ ] Localized date/number formatting

#### 6.5 API & Integrations
- [ ] Public REST API with documentation
- [ ] GraphQL API for complex queries
- [ ] Embed widgets for external sites
- [ ] Academic database integrations (WALS, Glottolog)

---

## Data Provenance & Licensing

> ⚠️ **Important:** Track licensing from the start. Mixing CC-BY, CC0, and proprietary sources without clear attribution creates headaches if this ever goes academic or public.

### Licensing Tracking Schema

Add to every TSV file a `source_license` column:

```
id | name | ... | sources | source_license
italian-cuisine | Italian | ... | ["Wikidata","Academic paper"] | CC0;CC-BY-4.0
```

### License Compatibility Matrix

| Source License | Can Use | Must Attribute | Share-Alike |
|----------------|---------|----------------|-------------|
| CC0 | ✅ | No | No |
| CC-BY | ✅ | Yes | No |
| CC-BY-SA | ✅ | Yes | Yes |
| CC-BY-NC | ⚠️ | Yes | Non-commercial only |
| Proprietary | ❌ | N/A | N/A |

### Attribution File

Maintain `ATTRIBUTION.md` listing all data sources with their licenses.

---

## Data Sources Inventory

### Open Data Sources

| Source | Data Type | License | URL |
|--------|-----------|---------|-----|
| Glottolog | Languages, families | CC-BY | glottolog.org |
| WALS | Typological features | CC-BY | wals.info |
| Ethnologue | Language statistics | Proprietary | ethnologue.com |
| Wikidata | Structured knowledge | CC0 | wikidata.org |
| UNESCO | Heritage sites | Varies | unesco.org |
| tDAR | Archaeological data | Varies | tdar.org |
| ASJP | Lexical data | Academic | asjp.clld.org |
| NorthEuraLex | Lexicons | CC-BY | northeuralex.org |

### Data Quality Guidelines

1. **Prefer primary sources** over aggregators
2. **Multiple citations required** for contested claims
3. **Time periods must have sources** (avoid unsourced "ancient")
4. **Confidence scores** for reconstructed/estimated data
5. **Version control** all data files

---

## Technical Debt & Refactoring

### Current Issues to Address

1. **`tsv-storage.ts`** - 646 lines, needs modularization
2. **Geospatial types** - Scattered across files, need consolidation
3. **Scraping services** - Coupled to specific sources, need abstraction
4. **State management** - Mixed React Query + Context, evaluate consistency

### Recommended Refactors

1. Split `TsvStorage` into domain-specific loaders
2. Create unified `DataLoader` interface
3. Extract geospatial utilities to shared module
4. Add comprehensive TypeScript types for all domains

---

## Success Metrics

### Phase Completion Criteria

| Phase | Success Metric | Status |
|-------|----------------|--------|
| Phase 0 | Time slider controls all map layers | ✅ Done |
| Phase 0.5 | Cuisine domain end-to-end with temporal filtering | ✅ Done |
| Phase 1 | 500+ entities with real data on map | ✅ 128 unified entities (growing) |
| Phase 2 | Animated playback of 1000 years in <30s | ✅ Done |
| Phase 3 | All 6 cultural domains browsable | 🟡 2/6 domains (music, religion) |
| Phase 4 | Cross-domain query returns results in <500ms | ✅ Done |
| Phase 5 | 10+ community contributions reviewed | 🟡 Contribution system live |

### Long-term Goals

- **1 year:** 10,000+ cultural entities across all domains
- **2 years:** Academic citations in research papers
- **3 years:** Educational institution adoption
- **5 years:** Primary reference for world culture research

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| TSV scalability limits | High | Early SQLite migration evaluation |
| Data accuracy disputes | Medium | Robust source citation system |
| Scope creep | High | Strict phase boundaries, MVP mindset |
| Single-maintainer burnout | High | Community contribution system |
| Copyright/licensing issues | Medium | Prefer CC-BY/CC0 sources |

---

## Immediate Next Steps

> **Status as of February 2026:** Phases 0–5 substantially complete. Next priorities are data expansion and polish.

1. **Data Expansion (High Priority):**
   - [ ] Expand archaeological sites from 3 → 100+ entries
   - [ ] Expand civilizations from 2 → 30+ entries
   - [ ] Add language range polygons (50+ languages)
   - [ ] Convert `proto-languages.txt` → TSV
   - [ ] Convert `native_migrations.txt` → TSV

2. **Remaining Phase 3 Domains:**
   - [ ] Social organization & kinship (3.3)
   - [ ] Visual arts & architecture (3.4)
   - [ ] Traditional dress & textiles (3.5)
   - [ ] Economic systems & trade (3.6)

3. **Phase 6 Polish:**
   - [ ] Performance optimization for large datasets
   - [ ] Mobile/responsive improvements
   - [ ] Accessibility audit
   - [ ] Export for academic use (BibTeX, CSV)

---

## Appendix A: Proposed Schema Summary

| Domain | Tables | Status |
|--------|--------|--------|
| **Languages** | `languages`, `families`, `words`, `language-contact`, `proto-languages` | ✅ Complete |
| **Archaeology** | `archaeological-sites`, `material-cultures`, `material-culture-distributions` | ✅ Loaders done (stub data) |
| **History** | `civilizations`, `civilization-boundaries`, `historical-routes`, `migrations` | ✅ Loaders done (stub data) |
| **Genetics** | `haplogroups` | ✅ 62 entries |
| **Cuisine** | `cuisines`, `cuisine-items` | ✅ 21 cuisines |
| **Music** | `music-traditions`, `musical-instruments` | ✅ 20 traditions, 25 instruments |
| **Religion** | `religions`, `mythologies`, `oral-traditions` | ✅ 20 religions (mythologies pending) |
| **Social** | `kinship-systems`, `social-structures` | ⬜ Not started |
| **Arts** | `art-styles`, `architectural-traditions` | ⬜ Not started |
| **Dress** | `traditional-dress` | ⬜ Not started |
| **Economy** | `economic-systems`, `trade-goods` | ⬜ Not started |

---

## Appendix B: Technology Stack Evolution

| Current | Phase 1-2 | Phase 3+ |
|---------|-----------|----------|
| TSV files | TSV + SQLite | SQLite/DuckDB |
| React Context | React Context | Consider Zustand |
| D3.js v7 | D3.js v7 | D3.js + deck.gl |
| Leaflet | Leaflet | Leaflet + MapLibre GL |
| In-memory cache | LRU cache | Redis (if multi-user) |

---

*Document maintained by: pinakes Development Team*
*Last updated: February 6, 2026 — Phases 0–5 substantially complete*
