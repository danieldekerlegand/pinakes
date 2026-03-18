# LinguaScrape Roadmap

## Vision: A Living Atlas of Human Civilization

LinguaScrape aims to become the most comprehensive interactive atlas of human culture and civilization — tracing the interconnected threads of language, cuisine, music, art, religion, trade, genetics, and social organization across geography and time, from prehistory to the present day.

The ultimate goal: **given any modern culture, trace its origins back through millennia** — showing how Yamnaya pastoralists became Persians, how Proto-Austronesian seafarers populated the Pacific, how a dish traveled from Central Asia to a street vendor in Istanbul, or how a musical scale migrated from West Africa to the Mississippi Delta.

---

## Current State (March 2026)

### Completed
- 1,100+ languages with family trees, IPA lexicons (10M+ words), and geographic coordinates
- 6 visualization modes: hierarchical tree, force-directed network, timeline, geographic map, cross-domain explorer, contribution system
- Linguistic analysis: distance calculator (LDND + IPA+), word comparison, etymology explorer, phonological inventories (112 languages), grammar features (105 languages)
- Cultural domains: 21 cuisines, 20 music traditions, 25 instruments, 20 religions, 62 haplogroups
- Cross-domain relationship engine (128 unified entities, relationship scoring)
- Time slider with animated playback (10,000 BCE → present)
- Contribution system with review queue
- Sample texts for 50+ languages, 5,000+ etymological relationships

### In Progress (Ralph Phase 2-6)
- Grammar comparison matrix UI
- Writing systems data and explorer
- Verb paradigm comparisons

### Known Gaps
- Archaeological sites: only 3 entries (need 500+)
- Civilizations: only 2 entries (need 100+)
- Language range polygons: stub data only
- No migration route data integrated
- Map cannot render organic cultural/linguistic boundaries (only simple polygons)
- No mechanism for showing cultural evolution over time (A → B → C lineages)
- No prehistoric archaeological culture data
- Cultural domains missing: dance, literature, architecture, dress, economics, kinship

---

## Roadmap

### Phase 7: Deep History & Cultural Lineage Engine

**The core differentiator.** Build the infrastructure to model how cultures evolve, split, merge, and influence each other over time. This is the backbone that makes "Yamnaya → Persians" possible.

#### 7.1 Cultural Lineage Graph
- Model cultures as nodes in a directed acyclic graph with temporal edges
- Support relationship types: **descended-from**, **split-from**, **merged-with**, **influenced-by**, **conquered-by**, **absorbed-into**
- Each edge has a time range, confidence score, and evidence type (archaeological, linguistic, genetic, historical)
- Schema: `lexicons/cultural-lineages.tsv` — source_id, target_id, relationship_type, time_start, time_end, confidence, evidence_types, sources
- Example chain: Proto-Indo-Europeans → Proto-Indo-Iranians → Old Persians → Middle Persians → Modern Farsi speakers

#### 7.2 Archaeological Cultures Database
- Create `lexicons/archaeological-cultures.tsv` with 200+ entries
- Fields: id, name, time_start, time_end, region, coordinates, boundary_geometry, material_culture_traits, subsistence_pattern, burial_practices, pottery_style, probable_language_family, probable_haplogroups, successor_cultures, predecessor_cultures, confidence, sources
- Cover key cultures: Yamnaya, Corded Ware, Bell Beaker, Cucuteni-Trypillia, Vinča, Jiahu, Jōmon, Clovis, Lapita, Bantu expansion cultures, Nok, Olmec, Caral-Supe, Indus Valley / Harappan, Longshan, Yangshao, Mehrgarh, Natufian, Göbekli Tepe builders, etc.
- Include **probable language assignments** with confidence levels (e.g., "Yamnaya: probably Proto-Indo-European, confidence 85%")

#### 7.3 Linguistic Urheimat Mapping
- Create `lexicons/urheimat-hypotheses.tsv` tracking proposed homelands for language families
- Fields: id, language_family_id, hypothesis_name, proposed_region, proposed_coordinates, proposed_boundary (GeoJSON), time_range_start, time_range_end, supporting_evidence (JSON: linguistic/archaeological/genetic), competing_hypotheses, scholarly_consensus_level, key_proponents, sources
- Cover major debates: Indo-European (Steppe vs. Anatolian), Afro-Asiatic (Levant vs. Africa), Austronesian (Taiwan), Bantu (Cameroon-Nigeria border), Uralic, Sino-Tibetan, etc.
- Visualize competing hypotheses as overlapping translucent regions on the map

#### 7.4 Lineage Timeline UI
- New visualization: **Cultural Lineage Explorer**
- Select any modern culture/language/people and see a branching timeline going back to earliest known ancestors
- Interactive: click any node to see details, branch off to related lineages
- Animated "zoom through time" mode that walks the lineage forward from origin to present
- Show parallel lineages side by side (e.g., compare Persian lineage vs. Hindi lineage diverging from Proto-Indo-Iranian)

#### 7.5 Prehistoric Culture Cards
- Rich detail panels for archaeological cultures showing:
  - Known material culture (pottery types, tool traditions, burial practices)
  - Best-guess language family assignment with evidence and confidence
  - Associated haplogroups with migration arrows
  - Key archaeological sites
  - Successor and predecessor cultures
  - Representative artifact images (where public domain)

---

### Phase 8: Massive Data Expansion

#### 8.1 Civilizations (Target: 150+)
Expand from 2 to 150+ civilizations with time-varying boundaries:
- **Ancient Near East:** Sumer, Akkad, Babylon, Assyria, Hittites, Elam, Urartu, Phoenicia, Judah/Israel, Persia (Achaemenid through Sassanid)
- **Mediterranean:** Minoan, Mycenaean, Classical Greece (city-states), Hellenistic kingdoms, Rome (Republic through Byzantine), Carthage, Etruscans
- **South/Central Asia:** Indus Valley, Maurya, Gupta, Kushan, Chola, Vijayanagara, Mughal, Khmer, Srivijaya
- **East Asia:** Shang, Zhou, Qin, Han through Qing dynasties, Joseon Korea, Heian through Edo Japan, Champa, Đại Việt
- **Africa:** Kush/Nubia, Aksum, Ghana Empire, Mali Empire, Songhai, Great Zimbabwe, Kilwa, Benin, Kongo
- **Americas:** Olmec, Maya, Teotihuacan, Aztec, Inca, Tiwanaku, Cahokia, Ancestral Puebloans, Mississippian
- **Steppe/Central Asia:** Scythians, Xiongnu, Göktürks, Mongol Empire, Timurids
- **Oceania:** Lapita, Rapa Nui, Tonga Empire, Hawaiian kingdoms
- Each civilization gets time-varying boundary polygons at key dates (founding, peak, collapse)

#### 8.2 Archaeological Sites (Target: 500+)
- Major excavation sites worldwide with coordinates, time ranges, associated cultures
- UNESCO World Heritage sites with archaeological significance
- Key transitional sites (e.g., sites showing Neolithic transition, Bronze Age collapse evidence, migration waypoints)

#### 8.3 Migration Routes (Target: 100+)
- Create `lexicons/migrations.tsv` with GeoJSON LineString routes
- **Prehistoric:** Out of Africa, Austronesian expansion, Bantu expansion, Indo-European migrations, Polynesian voyaging, peopling of the Americas
- **Historical:** Völkerwanderung, Arab conquests, Mongol conquests, Viking expansion, Turkic migrations, Romani diaspora
- **Colonial/Modern:** Atlantic slave trade routes, European colonization paths, modern refugee flows
- Each route has temporal data, associated peoples/languages/haplogroups, and cultural impact descriptions

#### 8.4 Language Range Polygons (Target: 200+)
- GeoJSON boundaries for major languages at key historical periods
- Historical snapshots: Latin at peak Roman Empire, Arabic before and after Islamic expansion, Quechua under Inca Empire
- Modern language boundaries from Glottolog/Ethnologue data
- Dialect continuum visualization (gradient boundaries rather than hard lines)

#### 8.5 Trade Routes & Economic Networks
- Silk Road (multiple branches), Spice Route, Incense Route, Amber Road, Trans-Saharan routes, Maritime Jade Road
- Traded goods with origin points and destination markets
- Currency and weight system spread
- Animated flow visualization showing goods movement over time

---

### Phase 9: New Cultural Domains

#### 9.1 Dance Traditions
- `lexicons/dance-traditions.tsv`: id, name, region, origin_culture, time_origin, dance_type (ceremonial, social, performative, martial), associated_music_traditions, movement_characteristics, costume_requirements, cultural_significance, related_dances, sources
- Cover: Bharatanatyam, Flamenco, Capoeira, Haka, Samba, Waltz, Ballet, Sufi whirling, Chinese lion dance, West African griot dances, Native American powwow, Irish step dance, Balinese Legong, Tango, etc.
- Map visualization: dance tradition regions with temporal spread
- Link to music traditions and ceremonial contexts

#### 9.2 Literature & Oral Traditions
- `lexicons/literary-traditions.tsv`: id, name, language_id, region, time_origin, tradition_type (epic, poetry, drama, prose, oral_epic, mythology), key_works, writing_system_id, themes, influences, influenced_by, sources
- `lexicons/literary-works.tsv`: id, title, tradition_id, author, language_id, date_composed, genre, significance, translations_count, sources
- Cover foundational texts: Epic of Gilgamesh, Rigveda, Iliad/Odyssey, Mahabharata, Beowulf, Tale of Genji, One Thousand and One Nights, Popol Vuh, Kalevala, Sundiata, Shahnameh, etc.
- Track literary influence chains (e.g., Greek drama → Roman drama → Renaissance theater → modern Western drama)
- Map showing where literary traditions emerged and spread

#### 9.3 Architecture & Monumental Building
- `lexicons/architectural-styles.tsv`: id, name, region, time_start, time_end, characteristics, materials, structural_innovations, associated_civilizations, influences, notable_examples, sources
- Cover: Megalithic, Egyptian, Mesopotamian, Classical Greek/Roman, Byzantine, Gothic, Islamic, Hindu temple, Chinese imperial, Mesoamerican pyramid, Khmer, Japanese, Art Deco, Brutalist, etc.
- Notable structures as map points with construction dates
- Style diffusion visualization showing how architectural ideas spread along trade/conquest routes

#### 9.4 Writing Systems
- `lexicons/writing-systems.tsv` (already planned in current PRD, expand scope)
- Track evolution: Proto-Sinaitic → Phoenician → Greek → Latin → modern alphabets
- Include undeciphered scripts: Linear A, Indus Valley script, Rongorongo, Proto-Elamite
- Writing system family tree visualization
- Map showing script adoption and spread over time

#### 9.5 Cuisine Deep Expansion
- Expand from 21 to 80+ cuisines with sub-regional granularity
- `lexicons/ingredient-origins.tsv`: track where key ingredients originated and how they spread (Columbian Exchange, Silk Road spices, etc.)
- `lexicons/cooking-techniques.tsv`: fermentation, smoking, wok cooking, tandoor, etc. with origin cultures and spread patterns
- Dish origin stories with migration tracking (e.g., dumplings: Central Asian origin → spread to China, Turkey, Italy, etc.)
- "Food family tree" showing how dishes evolved (e.g., Roman garum → Southeast Asian fish sauce → Worcestershire sauce)

#### 9.6 Kinship & Social Systems
- `lexicons/kinship-systems.tsv`: Eskimo, Hawaiian, Sudanese, Iroquois, Crow, Omaha systems mapped to cultures
- `lexicons/social-structures.tsv`: governance types, stratification systems, property systems
- Kinship terminology comparison tool (like the word comparison tool but for kinship terms)
- Governance evolution visualization (chiefdom → kingdom → empire patterns)

#### 9.7 Mythology & Folklore Comparison
- `lexicons/myth-motifs.tsv`: Track recurring narrative motifs across cultures (flood myths, trickster figures, creation stories, hero journeys, world tree/axis mundi)
- `lexicons/deities.tsv`: Deity database with domains, associated cultures, syncretism links
- Comparative mythology tool: select a motif (e.g., "flood myth") and see all cultures that share it, mapped geographically
- Deity family trees within pantheons and syncretism links across pantheons (Zeus ↔ Jupiter ↔ Indra ↔ Thor parallels)

#### 9.8 Genetics & Population History
- Expand haplogroup data with migration timing and routes
- Ancient DNA integration: link archaeological sites to genetic samples where available
- Admixture visualization: show how modern populations are genetic mixtures of ancient groups
- "Genetic distance" metric paralleling linguistic distance — compare populations and show shared ancestry proportions

---

### Phase 10: Advanced Map & Visualization

#### 10.1 Organic Cultural Boundaries
**Pain point: the map currently can't render the curvy, organic boundaries typical of linguistic/cultural maps.**
- Replace simple GeoJSON polygon rendering with smooth spline-interpolated boundaries
- Implement gradient/fuzzy edges for dialect continua and cultural transition zones
- Use Bézier curves or Catmull-Rom splines to create hand-drawn-looking cultural regions
- Support overlapping translucent regions (multiple cultures can occupy the same space)
- Investigate MapLibre GL JS or deck.gl for GPU-accelerated rendering of complex boundaries
- Reference style: the maps in historical atlases like the *DK Atlas of World History* or *Penguin Historical Atlas* series

#### 10.2 Animated Temporal Atlas
- Smooth morphing of civilization boundaries as time progresses (not just show/hide)
- Migration route animation: moving particles/arrows showing population flow direction
- "Bloom" effect for cultural diffusion (e.g., show agriculture spreading from Fertile Crescent)
- Split-screen time comparison: view the same region at two different dates side by side
- Preset historical snapshots with curated annotations:
  - "The Bronze Age World (1500 BCE)"
  - "The Silk Road at its Peak (200 CE)"
  - "Eve of the Columbian Exchange (1491 CE)"
  - "Peak of the Mongol Empire (1279 CE)"
  - "The Bronze Age Collapse (1177 BCE)"

#### 10.3 3D Globe View
- Optional 3D globe rendering (three.js or Cesium) for a more immersive experience
- Useful for showing migration routes that wrap around the globe (Austronesian expansion, Polynesian voyaging)
- Animated rotation following migration paths
- Toggle between flat map and globe

#### 10.4 Relationship Visualization Overhaul
- **Sankey diagrams** for showing cultural influence flow between civilizations
- **Chord diagrams** for showing mutual influences between language families
- **Animated network graphs** where edges appear/disappear based on time slider
- **Treemap view** for showing relative sizes (speaker populations, civilization territories, cuisine diversity)

#### 10.5 Heatmap & Density Layers
- Population density heatmap over time
- Language diversity index by region (languages per square km)
- Archaeological site density (showing well-studied vs. under-explored regions)
- Cultural exchange intensity (trade volume, loanword density, genetic admixture)

#### 10.6 Comparative Panels
- Side-by-side comparison of any two entities across all available dimensions
- Radar/spider charts comparing cultures across multiple metrics (linguistic complexity, culinary diversity, trade connectivity, etc.)
- Parallel timelines showing synchronized events across cultures

---

### Phase 11: Data Acquisition & Scraping

#### 11.1 In-App Data Contribution Tools
- **Map-based boundary drawing tool:** Click to draw polygons/lines directly on the map to define cultural regions, trade routes, migration paths
- **Timeline entry tool:** Click on the timeline to add events, period markers, date ranges
- **Relationship builder:** Visual drag-and-drop interface for connecting entities (drag "Latin" onto "French" to create a parent-child link)
- **Bulk CSV/TSV import:** Upload spreadsheets that get validated and merged into the dataset
- **Wikipedia/Wikidata scraper:** Paste a Wikipedia URL, automatically extract structured data (coordinates, dates, relationships) into entity form

#### 11.2 Automated Data Pipelines
- Glottolog integration: periodic sync of language data (coordinates, family trees, endangerment status)
- WALS (World Atlas of Language Structures) integration: typological features for 2,000+ languages
- Wikidata SPARQL queries: automated extraction of civilizations, archaeological sites, historical figures, trade goods
- GeoNames integration for standardized place names and coordinates
- Open Context / tDAR integration for archaeological site data

#### 11.3 AI-Assisted Data Entry
- LLM-powered data extraction: paste a paragraph from a textbook or paper, automatically extract entities, dates, relationships, and coordinates
- Confidence scoring on AI-extracted data (clearly marked as AI-generated, requires human review)
- Suggested relationships: when adding a new entity, the system suggests likely connections based on temporal/spatial/linguistic proximity

#### 11.4 Community & Crowdsource Expansion
- Public API for programmatic contributions
- "Adopt a culture" program: community members claim responsibility for specific cultural domains
- Integration with iNaturalist-style verification (multiple independent confirmations increase confidence)
- Academic partnership data imports (structured data from research institutions)

---

### Phase 12: Narrative & Educational Features

#### 12.1 Guided Journeys
- Curated narrative paths through the data, e.g.:
  - "The Indo-European Story: From Steppe to Subcontinent and Beyond"
  - "How Dumplings Conquered the World"
  - "The Austronesian Expansion: 5,000 Years Across the Pacific"
  - "Writing: From Counting Tokens to Unicode"
  - "The Columbian Exchange: When Two Worlds Met"
  - "Religions of the Silk Road"
  - "The Bantu Expansion and the Shaping of Africa"
  - "From Göbekli Tepe to Gothic Cathedrals: The Story of Monumental Architecture"
- Each journey is a sequence of map states + annotations + entity highlights
- Autoplay mode that narrates the journey with timed transitions

#### 12.2 "What If" Explorations
- Hypothetical scenario overlays: "What if the Bronze Age Collapse hadn't happened?"
- Alternative Urheimat visualizations: toggle between competing hypotheses and see how they change the migration map
- Counterfactual trade routes: "What if the Silk Road had extended to the Americas?"
- These are clearly marked as speculative/educational

#### 12.3 Quiz & Learning Mode
- "Where did this dish originate?" — click the map to guess
- "Which language family does X belong to?" — multiple choice
- "Place these civilizations in chronological order" — drag and sort
- Progress tracking and difficulty scaling
- Shareable quiz results

#### 12.4 Research & Academic Tools
- BibTeX export for any entity's source citations
- Stable URLs for every entity and view state (cite in papers)
- Data versioning with changelog (track when data was added/modified)
- DOI generation for dataset releases
- API for programmatic access to the full dataset

---

### Phase 13: Platform & Infrastructure

#### 13.1 Performance at Scale
- Migrate to SQLite/DuckDB for complex queries when data exceeds TSV performance limits
- WebGL/Canvas rendering for 10,000+ map entities (deck.gl or MapLibre GL)
- WebWorkers for heavy computations (linguistic distance matrices, graph traversals)
- Progressive loading: load summary data first, detail on demand
- Tile-based data loading for map (only load entities visible in viewport)

#### 13.2 Search & Discovery
- Global full-text search across all domains with faceted results
- Natural language queries: "What languages were spoken in Mesopotamia in 2000 BCE?"
- Autocomplete with entity type indicators
- Search by coordinates: click map → "What was here in 500 BCE?"
- "Related entities" suggestions on every detail panel

#### 13.3 Sharing & Collaboration
- Shareable URLs encoding full view state (map position, time, selected entities, active layers)
- Embed widgets for external websites and blogs
- Screenshot/export of current view with attribution watermark
- Collaborative collections: groups of entities curated around a theme
- User annotations and notes on entities

#### 13.4 Mobile & Accessibility
- Touch-optimized map controls with gesture support
- Responsive layouts for all visualization modes
- Screen reader support with meaningful descriptions for visual elements
- Keyboard navigation for all interactive elements
- Reduced motion mode
- PWA with offline support for cached data
- Dark mode

#### 13.5 Internationalization
- UI translation framework (start with major world languages)
- RTL layout support for Arabic, Hebrew, Farsi
- Localized date formatting (Islamic calendar, Chinese calendar, etc.)
- Entity names in native scripts alongside romanization

---

### Phase 14: Speculative & Long-term Vision

#### 14.1 DNA-to-Culture Mapper
- Upload 23andMe/AncestryDNA results → see which historical cultures, languages, and cuisines are associated with your genetic heritage
- "Your ancestors likely spoke..." feature based on haplogroup-language correlations
- Privacy-first: all processing client-side, no data stored

#### 14.2 Sound & Music Integration
- Audio samples for language pronunciation (IPA playback)
- Musical tradition audio clips with instrument identification
- "Sound of a language family" — hear how related languages sound in sequence
- Reconstructed Proto-Indo-European pronunciation playback

#### 14.3 AR/VR Experiences
- AR overlay: point phone at a location, see historical layers
- VR globe exploration: fly through time and space
- Virtual museum of world cultures with 3D artifact models

#### 14.4 AI-Powered Insights
- "Explain the connection between X and Y" — AI generates narrative explanations from the relationship graph
- Anomaly detection: find unexpected cultural similarities that might indicate undiscovered contact
- Prediction: given known migration patterns, suggest where undiscovered archaeological sites might be found
- Automated hypothesis generation: "These three cultures share pottery styles and haplogroup markers — possible common ancestor?"

#### 14.5 Living Dataset
- Real-time updates as new archaeological discoveries are published
- Endangered language tracking with preservation status
- Integration with field research: archaeologists and linguists can update data from the field
- Versioned dataset snapshots released annually with DOIs for academic citation

---

## Priority Matrix

| Phase | Impact | Effort | Priority |
|-------|--------|--------|----------|
| **7: Deep History & Lineage Engine** | Very High | High | **1 — Core differentiator** |
| **8: Massive Data Expansion** | Very High | Very High | **2 — Nothing works without data** |
| **10: Advanced Map & Viz** | High | High | **3 — Organic boundaries are critical** |
| **9: New Cultural Domains** | High | High | **4 — Breadth of coverage** |
| **11: Data Acquisition** | High | Medium | **5 — Scalable data entry** |
| **12: Narrative & Education** | Medium | Medium | **6 — User engagement** |
| **13: Platform & Infra** | Medium | High | **7 — Scale when needed** |
| **14: Speculative** | Low-Medium | Very High | **8 — Long-term vision** |

---

## Guiding Principles

1. **Interconnectedness first.** Every feature should reveal connections between cultures, not just catalog them in isolation.
2. **Time is a first-class dimension.** Every entity has a temporal range. The time slider should be the most-used control.
3. **Show your work.** Every claim has sources and confidence levels. Clearly distinguish established fact from scholarly hypothesis from speculation.
4. **Prehistory matters.** Don't start at "recorded history." The most interesting stories begin with archaeological cultures we can only partially reconstruct.
5. **Data over features.** A simple visualization with rich data is more valuable than a fancy visualization with sparse data. Prioritize data expansion.
6. **Respect complexity.** Cultures don't have clean borders. Languages exist on continua. Identities overlap. The visualization should embrace fuzziness rather than forcing false precision.
7. **TSV as source of truth.** Keep data in version-controlled TSV files. Build computed indexes (SQLite, etc.) at runtime. This keeps data portable, diffable, and contributor-friendly.
8. **Academic credibility.** This should be useful to researchers, not just casual browsers. Proper citation, stable identifiers, and data provenance are non-negotiable.

---

*Last updated: March 12, 2026*