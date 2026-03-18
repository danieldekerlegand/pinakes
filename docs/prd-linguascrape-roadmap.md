# PRD: LinguaScrape Long-Term Roadmap

## Introduction

LinguaScrape aims to be the definitive interactive atlas of all human language and culture throughout history. The platform already has a strong foundation: 1,100+ languages with phonetic data, 121K+ word translations, linguistic distance analysis, cultural domain data (cuisines, music, religions, haplogroups), and a multi-view visualization system (tree, network, timeline, map, cross-domain).

This roadmap defines the path from the current state to the full vision: a tapestry illustrating the interconnectedness of all human language and culture, with sophisticated visualization tools for exploring when and where languages were spoken, how they grew and contracted, how cultures migrated and intermixed, and how all of these threads weave together.

The roadmap is organized into six phases, each delivering a self-contained set of features with meaningful data expansion. Phases can overlap but are ordered by dependency and impact.

---

## Goals

- Catalog every known human language (living, dead, moribund, reconstructed, historical dialects) with representative sample texts
- Enable deep etymological analysis of any text, showing language-of-origin breakdowns (inspired by the etymology-tree project)
- Provide structural linguistic comparison tools (grammar, morphology, phonological inventories, verb systems, writing systems)
- Build an animated, temporal map experience where users can watch languages and cultures spread, contract, and interact across millennia
- Expand cultural data significantly: 50+ archaeological sites, 20+ civilizations, migration patterns, battles/wars, trade routes, material culture
- Create cross-domain correlation tools showing how language, cuisine, religion, genetics, and material culture co-evolve
- Serve researchers, students, and enthusiasts as an open-source educational platform

---

## Phase 1: Sample Texts & Text-Level Etymology Analysis ✅ COMPLETE

**Theme:** Give every language a voice. Port etymology-tree's analytical capabilities into the web platform.

### US-1.01: Sample Text Data Model & Storage ✅
**Description:** As a developer, I need a data structure for storing representative text passages per language so that users can see what languages actually look like.

**Acceptance Criteria:**
- [x] Create `lexicons/sample-texts.tsv` with columns: `id`, `language_id`, `title`, `text`, `transliteration` (for non-Latin scripts), `translation_en`, `source`, `date_composed`, `genre` (prose/poetry/religious/legal/inscription/conversational), `script`
- [x] Populate with at least 2-3 sample texts per language for the top 50 most-spoken languages (100-150 entries)
- [x] Include samples from at least 20 dead/historical languages (Old English, Latin, Ancient Greek, Sanskrit, Sumerian, Old Norse, Gothic, Classical Chinese, Old Irish, Akkadian, Hittite, Egyptian, Coptic, Old Church Slavonic, Old Persian, Avestan, Sogdian, Tocharian, Proto-Germanic reconstructions, Middle English)
- [x] TSV loader implemented in `tsv-storage.ts`
- [x] API endpoint `GET /api/sample-texts` with filters for language_id, genre, script
- [x] API endpoint `GET /api/sample-texts/:id`
- [x] Typecheck passes

### US-1.02: Sample Text Viewer Component ✅
**Description:** As a user, I want to browse and read sample texts from any language so that I can see what the language looks and sounds like.

**Acceptance Criteria:**
- [x] New "Texts" tab or section within language detail view
- [x] Display original text with proper Unicode rendering
- [x] Show transliteration alongside for non-Latin scripts
- [x] Show English translation in a toggleable panel
- [x] Display metadata: source, date composed, genre, script used
- [x] Search/filter texts by genre and time period
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-1.03: Etymology Wordnet Data Integration ✅
**Description:** As a developer, I need to integrate etymological derivation data (similar to etymwn.tsv used by etymology-tree) so the system can trace word origins across languages.

**Acceptance Criteria:**
- [x] Create `lexicons/etymology-relations.tsv` with columns: `id`, `source_word`, `source_language`, `target_word`, `target_language`, `relation_type` (derived_from, etymology, cognate, borrowed_from, calque)
- [x] Populate with at least 5,000 etymological relationships covering major Indo-European, Semitic, Sino-Tibetan, and Austronesian connections
- [x] Include relationships for common English words back to Latin, French, Old English, Old Norse, Greek roots
- [x] TSV loader and API endpoint `GET /api/etymology-relations`
- [x] API endpoint `GET /api/etymology-relations/trace/:word` that recursively traces a word's full etymology chain (like `trace-etymology` in etymology-tree)
- [x] Typecheck passes

### US-1.04: Text Etymology Analyzer ✅
**Description:** As a user, I want to paste or select a text and see a breakdown of what percentage of its vocabulary comes from each source language, so I can understand the linguistic composition of any text.

**Acceptance Criteria:**
- [x] New "Text Analyzer" page/view accessible from main navigation
- [x] Text input area (paste any text) with language selector (default: English)
- [x] Tokenization that splits text into words and looks up each word's etymology chain
- [x] Results display: pie/donut chart showing percentage breakdown by origin language (e.g., "43% Latin, 31% Germanic, 12% French, 8% Greek, 6% Other")
- [x] Clickable segments that expand to show which specific words came from that origin
- [x] Word-level highlighting: hover over any word in the text to see its etymology chain
- [x] Support analyzing the sample texts from US-1.01 with a single click
- [x] Handle unknown words gracefully (categorize as "Unknown origin")
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-1.05: Etymology Tree Visualization ✅
**Description:** As a user, I want to see a visual tree showing how a word has traveled across languages over centuries, so I can understand the journey of individual words.

**Acceptance Criteria:**
- [x] D3.js tree/graph visualization showing a word's etymology chain
- [x] Nodes represent word forms in different languages, edges represent derivation relationships
- [x] Nodes colored by language family
- [ ] Temporal axis showing approximate century of each derivation
- [x] Bidirectional traversal: show both ancestors (where did this word come from?) and descendants (what words did it give rise to?)
- [x] Click any node to recenter the tree on that word
- [x] Export as SVG/PNG
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-1.06: Comparative Text Analysis ✅
**Description:** As a user, I want to compare the etymological composition of two texts side-by-side (e.g., a legal document vs. a casual conversation, or Shakespeare vs. a modern novel) to see how vocabulary origins differ.

**Acceptance Criteria:**
- [x] Side-by-side comparison view for two texts
- [x] Dual pie/donut charts with synchronized color coding
- [x] Difference summary: "Text A has 15% more Latin-origin words than Text B"
- [x] Shared vs. unique origin languages highlighted
- [x] Can compare any sample text against a pasted text
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

## Phase 2: Structural Linguistic Comparison ✅ COMPLETE

**Theme:** Go beyond vocabulary to compare how languages actually work - their grammar, sounds, and writing.

### US-2.01: Phonological Inventory Data ✅
**Description:** As a developer, I need to store phonological inventories (consonants, vowels, tones) for each language so users can compare sound systems.

**Acceptance Criteria:**
- [x] Create `lexicons/phonological-inventories.tsv` with columns: `id`, `language_id`, `consonants` (JSON array of IPA symbols), `vowels` (JSON array), `tones` (JSON array or null), `phonotactic_patterns` (JSON), `syllable_structure`, `stress_system`
- [x] Populate for at least 100 languages across all major families
- [x] Include data for historical/dead languages where known (Latin, Sanskrit, Proto-Indo-European, Old English, Classical Arabic)
- [x] TSV loader and API endpoints
- [x] Typecheck passes

### US-2.02: Phonological Inventory Comparison View ✅
**Description:** As a user, I want to compare the sound systems of two or more languages side-by-side, seeing shared and unique phonemes on an IPA chart.

**Acceptance Criteria:**
- [x] Interactive IPA consonant chart (place x manner grid) with phonemes highlighted per language
- [x] Vowel trapezoid chart with language-colored markers
- [x] Color-coded overlap: shared phonemes, unique to Language A, unique to Language B
- [x] Summary statistics: total consonants, total vowels, has tones, syllable complexity
- [x] Support comparing 2-4 languages simultaneously
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-2.03: Grammar & Morphology Data ✅
**Description:** As a developer, I need to store structural grammar features for each language so users can compare grammatical systems.

**Acceptance Criteria:**
- [x] Create `lexicons/grammar-features.tsv` with columns: `id`, `language_id`, `word_order` (SOV/SVO/VSO/VOS/OVS/OSV/free), `morphological_type` (isolating/agglutinative/fusional/polysynthetic), `case_system` (JSON: list of cases), `gender_system` (JSON), `number_system` (JSON), `tense_aspect_mood` (JSON), `agreement_system`, `negation_strategy`, `question_formation`, `relative_clause_strategy`, `noun_class_count`, `verb_valency_changes` (JSON: causative/passive/applicative/etc.), `evidentiality`, `ergativity`
- [x] Populate for at least 100 languages spanning all major typological profiles
- [x] TSV loader and API endpoints
- [x] Typecheck passes

### US-2.04: Grammar Comparison Matrix ✅
**Description:** As a user, I want to compare grammatical features across multiple languages in a matrix view, so I can see which languages share structural properties.

**Acceptance Criteria:**
- [x] Matrix/table view: languages as rows, grammatical features as columns
- [x] Color-coded cells showing feature values
- [x] Sortable by any feature (e.g., group all SOV languages together)
- [x] Filter to specific feature categories (word order, morphology, case, TAM)
- [x] Structural similarity score between any two languages (based on shared features)
- [x] Highlight typological outliers and rare features
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-2.05: Writing Systems Catalog ✅
**Description:** As a user, I want to explore the world's writing systems, see which languages use them, and understand their historical development.

**Acceptance Criteria:**
- [x] Create `lexicons/writing-systems.tsv` with columns: `id`, `name`, `type` (alphabet/abjad/abugida/syllabary/logographic/featural), `direction` (LTR/RTL/TTB/boustrophedon), `parent_system_id`, `language_ids` (JSON), `origin_date`, `origin_region`, `character_count`, `sample_characters`, `unicode_block`, `is_active`
- [x] Populate with at least 50 writing systems (Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Chinese, Japanese kana/kanji, Korean Hangul, Thai, Ge'ez, Armenian, Georgian, Tibetan, Burmese, Tamil, Telugu, Khmer, Mongolian, Cherokee, Runic, Ogham, Linear A/B, Cuneiform, Egyptian hieroglyphs, Phoenician, Brahmi, etc.)
- [x] Family tree visualization showing script evolution (Phoenician -> Greek -> Latin -> etc.)
- [x] Map view showing geographic distribution of writing systems
- [x] Detail view with sample characters and Unicode rendering
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-2.06: Verb Structure Deep Dive ✅
**Description:** As a user, I want to compare verb conjugation systems across languages to understand how differently languages encode tense, aspect, mood, person, and number.

**Acceptance Criteria:**
- [x] Create `lexicons/verb-paradigms.tsv` with sample conjugation tables for common verbs ("to be", "to go", "to give") across at least 30 languages
- [x] Interactive conjugation table viewer showing full paradigm for a verb in any language
- [x] Side-by-side comparison of the same verb concept across 2-3 languages
- [x] Visual indicators for complexity: number of distinct forms, irregularity markers
- [x] Highlight shared patterns (e.g., Romance languages all mark future tense similarly)
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

## Phase 3: Animated Temporal Atlas ✅ COMPLETE

**Theme:** Build the centerpiece visualization - watch human history unfold on a map across millennia.

### US-3.01: Expand Civilization & Territory Data ✅
**Description:** As a developer, I need comprehensive civilization boundary data to show territorial changes over time.

**Acceptance Criteria:**
- [x] Expand `lexicons/civilizations.tsv` to 30+ civilizations (add: Mesopotamian empires, Egypt, Persia, Maurya, Gupta, Han Dynasty, Tang Dynasty, Mongol Empire, Ottoman Empire, Byzantine Empire, Holy Roman Empire, Aztec, Inca, Maya, Khmer Empire, Mali Empire, Songhai, Great Zimbabwe, Carthage, Phoenicia, Indus Valley, Shang Dynasty, Hittite Empire, Assyria, Umayyad/Abbasid Caliphates, Viking territories, Celtic territories, etc.)
- [x] Expand `lexicons/civilization-boundaries.tsv` with multiple temporal snapshots per civilization (e.g., Roman Republic 200 BCE, Roman Empire 117 CE, Western Roman Empire 400 CE)
- [x] At least 80 boundary entries total (multiple snapshots per expanding/contracting entity)
- [x] All boundaries as valid GeoJSON polygons
- [x] Typecheck passes

### US-3.02: Expand Archaeological Sites ✅
**Description:** As a developer, I need a comprehensive archaeological sites dataset to populate the map with material evidence of human history.

**Acceptance Criteria:**
- [x] Expand `lexicons/archaeological-sites.tsv` to 60+ sites across all inhabited continents
- [x] Include: Olduvai Gorge, Lascaux, Altamira, Catalhoyuk, Jericho, Ur, Mohenjo-daro, Angkor Wat, Machu Picchu, Great Zimbabwe, Mesa Verde, Cahokia, Teotihuacan, Chichen Itza, Petra, Persepolis, Troy, Knossos, Mycenae, Stonehenge, Newgrange, Carnac, Terracotta Army, Sanchi, Ajanta, Easter Island, L'Anse aux Meadows, etc.
- [x] Each site with: coordinates, date range, associated civilization, cultural_period, site_type (settlement/temple/burial/cave_art/fortress/city), description, associated_languages
- [x] Typecheck passes

### US-3.03: Migration Routes Data ✅
**Description:** As a developer, I need human migration and trade route data to animate the movement of peoples and ideas.

**Acceptance Criteria:**
- [x] Create `lexicons/migration-routes.tsv` with columns: `id`, `name`, `route_type` (migration/trade/conquest/colonization/diaspora), `waypoints` (GeoJSON LineString), `start_date`, `end_date`, `peoples` (JSON), `associated_languages` (JSON), `description`, `consequences`
- [x] Populate with at least 30 routes: Out of Africa, Indo-European expansion, Bantu expansion, Austronesian expansion, Polynesian voyaging, Silk Road, Trans-Saharan trade, Amber Road, Incense Route, Viking expansion, Arab expansion, Mongol conquests, European colonization routes, Atlantic slave trade routes, Great Migration (US), Jewish diaspora, Romani migration, etc.
- [x] Each route with temporal data enabling animated playback
- [x] Typecheck passes

### US-3.04: Battles & Conflicts Data ✅
**Description:** As a developer, I need historical battle and conflict data to contextualize territorial changes and language shifts.

**Acceptance Criteria:**
- [x] Create `lexicons/battles.tsv` with columns: `id`, `name`, `date`, `coordinates` (lat/lng), `belligerents` (JSON: array of {name, civilization_id}), `outcome`, `casualties_estimate`, `significance`, `associated_language_changes`, `war_name`
- [x] Populate with at least 50 historically significant battles spanning antiquity to modern era across all continents
- [x] Include battles that directly caused language shifts (e.g., Battle of Hastings -> Norman French influence on English, Fall of Constantinople -> Greek diaspora)
- [x] Typecheck passes

### US-3.05: Temporal Atlas Player ✅
**Description:** As a user, I want to press play and watch history unfold on the map - seeing civilizations rise and fall, migrations flow, battles flash, and languages spread and contract over thousands of years.

**Acceptance Criteria:**
- [x] Enhanced TimeSlider with play/pause, speed control (1x, 5x, 10x, 50x), and step-by-step (century/decade increments)
- [x] Civilization boundaries morph/transition smoothly between temporal snapshots using GeoJSON interpolation
- [x] Migration routes animate as flowing lines with directional arrows, appearing during their active period
- [x] Battles appear as brief flash markers at their location when the timeline crosses their date
- [x] Archaeological sites fade in when the timeline reaches their founding period
- [x] Language range polygons grow/shrink as the timeline progresses
- [x] Current year prominently displayed, with era labels (Bronze Age, Iron Age, Classical, Medieval, etc.)
- [x] Sidebar timeline showing key events at the current time point
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-3.06: Map Layer Controls & Legend ✅
**Description:** As a user, I want fine-grained control over what layers are visible on the temporal atlas, with a clear legend explaining what I'm seeing.

**Acceptance Criteria:**
- [x] Layer panel with toggles for: civilizations, language ranges, archaeological sites, migration routes, battles, trade routes, cuisine regions, music traditions, religion origins, haplogroup distributions
- [x] Opacity slider per layer
- [x] Color legend that dynamically updates based on visible layers
- [x] Preset layer combinations: "Linguistic Atlas", "Political History", "Cultural Diffusion", "Trade & Economy", "All Layers"
- [x] Layer state persists in URL params for shareable views
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

## Phase 4: Cross-Domain Correlation & Deep Analysis ✅ COMPLETE

**Theme:** Connect the threads - show how language, culture, genetics, and material evidence interrelate.

### US-4.01: Language Contact & Substrate/Superstrate Visualization ✅
**Description:** As a user, I want to see how languages influenced each other through contact - substrate effects, borrowings, pidginization, and creolization.

**Acceptance Criteria:**
- [x] Integrate existing `data/language_contact_phenomena.csv` into a proper TSV with enrichment
- [x] Create `lexicons/language-contacts.tsv` with columns: `id`, `source_language_id`, `target_language_id`, `contact_type` (substrate/superstrate/adstrate/borrowing/pidginization/creolization), `time_period`, `region`, `features_transferred` (JSON: phonological/lexical/grammatical), `example_features`, `intensity` (heavy/moderate/light)
- [x] Populate with at least 60 contact events
- [x] Network visualization showing language contact as a directed graph (separate from family tree - shows horizontal transfer)
- [x] Map overlay showing contact zones with temporal filtering
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-4.02: Historical Sound Change Chains ✅
**Description:** As a user, I want to see how sounds changed systematically over time within language families (e.g., Grimm's Law, the Great Vowel Shift), so I can understand why related languages sound different today.

**Acceptance Criteria:**
- [x] Create `lexicons/sound-changes.tsv` with columns: `id`, `name`, `family_id`, `source_language_id`, `target_language_id`, `change_rule` (IPA notation, e.g., "p -> f"), `environment` (word-initial, intervocalic, etc.), `date_range`, `examples` (JSON array of {before, after, meaning}), `related_changes` (JSON)
- [x] Populate with at least 40 well-documented sound changes: Grimm's Law, Verner's Law, Great Vowel Shift, Grassmann's Law, Latin to Romance vowel changes, Proto-Slavic palatalization, Bantu consonant shifts, etc.
- [x] Interactive chain visualization: show a sound change rule, then click through examples showing the before/after in descendant languages
- [x] Timeline view of sound changes within a family, showing when each change occurred
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-4.03: Cross-Domain Correlation Explorer ✅
**Description:** As a user, I want to ask questions like "when this language spread to this region, how did cuisine change?" or "do genetic haplogroups correlate with language families?" and see the data visualized.

**Acceptance Criteria:**
- [x] Query builder UI: select two domains (language, cuisine, music, religion, haplogroup, civilization) and a relationship type (co-occurrence, temporal correlation, geographic overlap)
- [x] Results displayed as: Sankey diagram (flow between domains), scatter plot (correlation), or map overlay (geographic co-occurrence)
- [x] Pre-built "interesting queries" that users can explore: "Indo-European languages vs. R1b haplogroup distribution", "Spread of Islam vs. Arabic loanwords", "Austronesian expansion vs. outrigger canoe archaeology", "Roman roads vs. Romance language boundaries"
- [x] Narrative mode: for each pre-built query, show a brief scholarly explanation of the correlation
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-4.04: Linguistic Distance Enhanced Modes ✅
**Description:** As a user, I want to compare languages not just by vocabulary but by grammar, phonology, and verb structure independently, so I can understand which dimensions make languages similar or different.

**Acceptance Criteria:**
- [x] Extend the existing linguistic distance API to support comparison modes: `vocabulary` (existing), `phonological` (based on phonological inventories from Phase 2), `grammatical` (based on grammar features from Phase 2), `combined` (weighted blend)
- [x] UI selector for comparison mode in existing distance tools
- [x] Results show dimensional breakdown: "Korean and Japanese are 85% similar grammatically but only 12% similar in vocabulary"
- [x] Radar/spider chart showing multi-dimensional similarity profile
- [x] "Nearest neighbors" view that can be filtered by dimension
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-4.05: Genetic-Linguistic Correlation Map ✅
**Description:** As a user, I want to see haplogroup distributions overlaid on language family distributions to explore the relationship between genetic and linguistic ancestry.

**Acceptance Criteria:**
- [x] Map layer showing haplogroup distribution zones (heat map or shaded polygons)
- [x] Toggle between Y-chromosome and mtDNA haplogroups
- [x] Overlay with language family boundaries
- [x] Correlation score for each haplogroup-language family pair (geographic overlap percentage)
- [x] Notable divergences highlighted (e.g., Hungarian: Uralic language but mostly R1b genetics)
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

## Phase 5: Expanded Cultural Domains ✅ COMPLETE

**Theme:** Fill in the remaining dimensions of human cultural experience.

### US-5.01: Material Culture & Technology ✅
**Description:** As a user, I want to explore the spread of technologies and material culture (pottery styles, metallurgy, agriculture, tools) across time and space.

**Acceptance Criteria:**
- [x] Create `lexicons/material-culture.tsv` with columns: `id`, `name`, `category` (pottery/metallurgy/agriculture/tools/textiles/architecture), `origin_date`, `origin_coordinates`, `spread_data` (JSON: array of {date, coordinates, associated_civilization}), `description`, `associated_languages`, `significance`
- [x] Populate with at least 40 entries: Bell Beaker pottery, Corded Ware, Linear Pottery, Iron smelting, Bronze working, Wheel invention, Writing invention, Agriculture (Fertile Crescent, Yangtze, Mesoamerica independently), Gunpowder, Printing, Domesticated crops (wheat, rice, maize, potato), Domesticated animals (horse, cattle, dog), etc.
- [x] Map visualization showing technology spread as animated concentric waves from origin points
- [x] Timeline showing when different regions gained each technology
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-5.02: Foodways & Agricultural Change ✅
**Description:** As a user, I want to see how food and agriculture changed over time in different regions, linked to migrations, trade, and colonization.

**Acceptance Criteria:**
- [x] Extend existing cuisine data with temporal depth: create `lexicons/foodway-events.tsv` tracking specific introductions (e.g., "Tomatoes introduced to Italy, 1548, from Mesoamerica via Spanish colonization")
- [x] Populate with at least 50 major food exchange events (Columbian Exchange items, Silk Road spice trade, Austronesian crop introductions, Bantu agricultural expansion, etc.)
- [x] Map animation showing crop/food diffusion from origin to global adoption
- [x] Link food introductions to the migration routes and trade routes from Phase 3
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-5.03: Social Organization & Kinship Systems ✅
**Description:** As a user, I want to explore different kinship terminologies and social organization patterns across cultures.

**Acceptance Criteria:**
- [x] Create `lexicons/kinship-systems.tsv` with columns: `id`, `system_type` (Eskimo/Hawaiian/Sudanese/Omaha/Crow/Iroquois/Dravidian), `language_ids` (JSON), `terminology` (JSON: mapping of kin terms), `descent_rule` (patrilineal/matrilineal/bilateral/ambilineal), `residence_rule` (patrilocal/matrilocal/neolocal/avunculocal), `associated_civilizations`
- [x] Populate with at least 25 entries spanning all system types
- [x] Visual kinship diagram showing how each system classifies relatives differently
- [x] Map showing geographic distribution of kinship system types
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-5.04: Visual Arts & Architectural Styles ✅
**Description:** As a user, I want to explore artistic and architectural traditions across cultures and time periods.

**Acceptance Criteria:**
- [x] Create `lexicons/art-traditions.tsv` with columns: `id`, `name`, `category` (painting/sculpture/architecture/textile/ceramic/metalwork), `style_period`, `origin_date`, `end_date`, `origin_coordinates`, `description`, `associated_civilizations`, `associated_languages`, `key_features` (JSON), `notable_examples` (JSON)
- [x] Populate with at least 30 traditions: Egyptian monumental, Greek Classical, Roman, Byzantine, Romanesque, Gothic, Renaissance, Baroque, Islamic geometric, Chinese landscape painting, Japanese ukiyo-e, Mayan, Aztec, African masks, Aboriginal dot painting, Mughal miniatures, etc.
- [x] Timeline view showing overlapping art periods
- [x] Map showing geographic distribution of styles
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-5.05: Economic Systems & Trade Goods ✅
**Description:** As a user, I want to see what goods were traded along historical routes and how economic systems varied across civilizations.

**Acceptance Criteria:**
- [x] Create `lexicons/trade-goods.tsv` with columns: `id`, `name`, `category` (spice/metal/textile/grain/luxury/animal), `origin_region`, `origin_coordinates`, `trade_routes` (JSON: route_ids), `time_period`, `economic_significance`, `associated_languages` (JSON: languages of traders/producers)
- [x] Populate with at least 40 trade goods: silk, spices (pepper, cinnamon, clove, nutmeg), gold, silver, tin, copper, amber, incense, ivory, salt, tea, coffee, sugar, cotton, wool, horses, slaves (historical context), porcelain, obsidian, lapis lazuli, etc.
- [x] Map showing trade good origins with animated flow along trade routes
- [x] Filter by good type or time period
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

## Phase 6: Platform Maturity & Public Readiness ✅ COMPLETE

**Theme:** Polish, performance, and features that make the platform usable by the public.

### US-6.01: Global Search ✅
**Description:** As a user, I want a single search bar that finds anything in the system - languages, words, civilizations, foods, instruments, battles, sites - and takes me to the right place.

**Acceptance Criteria:**
- [x] Search bar in top navigation, always visible
- [x] Fuzzy matching across all entity types
- [x] Results grouped by category with icons
- [x] Keyboard shortcut (Cmd/Ctrl+K) to focus search
- [x] Recent searches persisted in localStorage
- [x] Results link directly to detail views
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-6.02: Guided Exploration Narratives ✅
**Description:** As a user, I want pre-built "guided tours" that walk me through fascinating stories in the data - like "The Journey of the Word 'Sugar'" or "How the Silk Road Changed Languages."

**Acceptance Criteria:**
- [x] Create `lexicons/narratives.tsv` with columns: `id`, `title`, `description`, `steps` (JSON array of {text, map_center, map_zoom, time_point, highlighted_entities, layer_config})
- [x] Populate with at least 10 narratives covering diverse topics and regions
- [x] Narrative player UI: step-by-step cards with map/timeline auto-navigation
- [x] Play/pause/step controls
- [x] The map, timeline, and visible layers automatically adjust as the narrative progresses
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-6.03: Shareable Views & Deep Linking ✅
**Description:** As a user, I want to share a specific view (a particular language comparison, a map at a specific time, a text analysis result) via URL so others can see exactly what I see.

**Acceptance Criteria:**
- [x] All view state encoded in URL parameters (active tab, filters, selected entities, time slider position, map center/zoom, visible layers)
- [x] Copy-link button that generates a shareable URL
- [x] Loading a shared URL restores the exact view state
- [x] Social media preview metadata (Open Graph tags) for shared links
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-6.04: Performance Optimization for Large Datasets ✅
**Description:** As a developer, I need the system to handle the growing dataset without degrading UI responsiveness.

**Acceptance Criteria:**
- [x] Implement virtual scrolling for lists with 1000+ items
- [x] Lazy-load TSV data by domain (don't load all 14+ TSV files on startup)
- [x] Implement server-side pagination for large endpoints (words, etymology-relations)
- [x] Map clustering for dense point layers (archaeological sites, battles)
- [x] D3 visualizations use canvas rendering for >500 nodes, SVG for smaller datasets
- [x] Client-side caching with React Query configured for optimal stale times
- [x] Typecheck passes

### US-6.05: Data Contribution & Community ✅
**Description:** As a user, I want to contribute data corrections or new entries through a streamlined interface, and see contributions from others.

**Acceptance Criteria:**
- [x] Enhance existing contribution system with per-field editing (not just whole-entity submissions)
- [x] "Suggest edit" button on every data display (language details, sample texts, etymology entries, etc.)
- [x] Contribution review dashboard showing pending/approved/rejected submissions
- [x] Contributor attribution on data entries
- [x] Export contribution history as CSV
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-6.06: Responsive Design & Accessibility ✅
**Description:** As a user, I want the platform to work well on tablets and be accessible to screen reader users.

**Acceptance Criteria:**
- [x] All views responsive down to 768px tablet width
- [x] Map controls usable on touch devices
- [x] ARIA labels on all interactive elements
- [x] Keyboard navigation for all views (not just search)
- [x] High contrast mode toggle
- [x] Alt text for all visualizations
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

## Functional Requirements Summary

### Phase 1: Sample Texts & Etymology
- FR-1.1: Store and serve sample texts per language with transliteration and translation
- FR-1.2: Render sample texts with proper Unicode and script support
- FR-1.3: Store etymological derivation relationships between words across languages
- FR-1.4: Tokenize input text and compute origin-language frequency distribution
- FR-1.5: Visualize word etymology chains as interactive D3 tree graphs
- FR-1.6: Compare etymological composition of two texts side-by-side

### Phase 2: Structural Comparison
- FR-2.1: Store and compare phonological inventories on IPA charts
- FR-2.2: Store and compare grammatical features in a sortable matrix
- FR-2.3: Catalog writing systems with family tree and geographic distribution
- FR-2.4: Store and compare verb conjugation paradigms across languages

### Phase 3: Temporal Atlas
- FR-3.1: Display 30+ civilizations with temporal boundary morphing
- FR-3.2: Display 60+ archaeological sites with temporal filtering
- FR-3.3: Animate 30+ migration/trade routes with directional flow
- FR-3.4: Display 50+ historical battles as temporal flash markers
- FR-3.5: Provide play/pause/speed controls for temporal playback across all map layers
- FR-3.6: Support 10+ toggleable map layers with opacity control and presets

### Phase 4: Cross-Domain Analysis
- FR-4.1: Visualize language contact events as directed network graphs
- FR-4.2: Display historical sound changes with before/after examples
- FR-4.3: Query and visualize correlations between any two cultural domains
- FR-4.4: Compare languages across vocabulary, phonology, and grammar dimensions independently
- FR-4.5: Overlay haplogroup and language family distributions with correlation scoring

### Phase 5: Cultural Domains
- FR-5.1: Track and animate technology/material culture diffusion on map
- FR-5.2: Visualize food exchange events linked to trade routes and migrations
- FR-5.3: Catalog and visualize kinship system types with kin diagrams
- FR-5.4: Catalog artistic and architectural traditions with timeline and map
- FR-5.5: Track trade goods with animated flow along historical routes

### Phase 6: Platform Maturity
- FR-6.1: Provide unified fuzzy search across all entity types
- FR-6.2: Support guided narrative playback with auto-map/timeline navigation
- FR-6.3: Encode all view state in URL for shareable links
- FR-6.4: Handle large datasets with virtualization, pagination, and clustering
- FR-6.5: Support granular data contributions with review workflow
- FR-6.6: Meet WCAG 2.1 AA accessibility and tablet responsiveness standards

---

## Non-Goals (Out of Scope for This Roadmap)

- **Native mobile app**: web-first, responsive design is sufficient
- **Real-time collaboration**: this is not a multiplayer editing tool
- **Machine translation**: the platform catalogs and analyzes languages, it doesn't translate between them
- **AI-generated data**: data should be sourced from scholarly/reference materials, not generated (AI can assist with formatting/structuring sourced data)
- **User accounts & authentication**: keep the platform open-access; contributions use a lightweight submission model, not user accounts
- **Database migration**: the TSV-based architecture is intentional and should be maintained; optimize reads with in-memory caching rather than switching to a database
- **Constructed/fictional languages**: focus remains on natural human languages (Esperanto and historically significant pidgins/creoles are acceptable)

---

## Technical Considerations

- **Data format**: All new data stored in `lexicons/*.tsv` files with JSON-encoded complex fields, consistent with existing architecture
- **Data volume**: Phase 3 data expansion will push total TSV rows from ~126K to ~130K+; in-memory loading remains feasible but lazy-loading by domain (Phase 6) will be important
- **GeoJSON complexity**: Civilization boundary polygons can be large; consider simplification for rendering and storing detailed versions separately
- **Etymology data**: The `etymwn.tsv` format from etymology-tree uses `rel:is_derived_from` and `rel:etymology` relations; adapt this to the new TSV schema while preserving the recursive trace capability
- **D3 performance**: Some visualizations (etymology trees, contact networks) may have hundreds of nodes; implement level-of-detail rendering
- **Existing components to reuse**: VisualizationContext, D3 tree/network/timeline views, Leaflet map with layer system, export utilities, TSV storage layer, cross-domain search infrastructure
- **No breaking changes**: Each phase extends existing APIs and data; no existing endpoint signatures should change

---

## Success Metrics

- **Data coverage**: 150+ sample texts, 5,000+ etymology relations, 100+ phonological/grammar profiles, 30+ civilizations, 60+ archaeological sites, 30+ migration routes, 50+ battles by end of Phase 5
- **Visualization richness**: 15+ distinct visualization types (tree, network, timeline, map, pie/donut, IPA chart, vowel trapezoid, grammar matrix, conjugation table, Sankey, radar, etymology tree, contact graph, narrative player, animated map)
- **Cross-domain queries**: Users can ask correlation questions across any pair of the 8+ cultural domains
- **Temporal range**: Usable atlas from ~300,000 BCE (earliest archaeological evidence) through present day
- **Performance**: All pages load in <3s, map with all layers renders at 30fps, search returns results in <200ms
- **Shareability**: Any view can be shared via URL and loads identically for the recipient

---

## Open Questions

1. **Etymology data source**: Should we use the Open Etymological Wordnet (etymwn.tsv) as a starting point, or curate our own dataset? The former gives us ~6M relations but may have quality issues.
2. **Historical boundary accuracy**: How precise do civilization boundaries need to be? Scholarly sources often disagree on exact borders. Should we show confidence levels or multiple interpretations?
3. **Phonological data sourcing**: PHOIBLE database has excellent phonological inventory data for ~3,000 languages. Should we write an importer for PHOIBLE's CSV format?
4. **Grammar data sourcing**: WALS (World Atlas of Language Structures) has typological features for ~2,600 languages. Should we integrate WALS data directly?
5. **Narrative content**: Who writes the guided exploration narratives? Should they be community-contributed or curated?
6. **Scale of etymological analysis**: Should text analysis be limited to English texts initially, or support any source language from the start?
7. **Map tile provider**: Should we use a historical map tile set (e.g., natural-earth style without modern borders) for the temporal atlas, or overlay on modern OpenStreetMap?
