# Data Attribution & Licensing

This document tracks data sources, licenses, and attribution requirements for all datasets used in LinguaScrape.

Per-domain **counts** below reflect the populated corpus after the `data-population` work (roadmap
§15). For the machine-readable actual-vs-target breakdown see
[`docs/coverage-report.md`](coverage-report.md) / [`coverage-report.json`](coverage-report.json).

## Data provenance (acquired rows)

Domains expanded at scale were acquired from **Wikidata** (WDQS / offline dump) via
culture-scrape's blueprints, then reconciled + curated (see
[`docs/data-population-runbook.md`](data-population-runbook.md) and
`scripts/acquire-*.ts` / `scripts/curate-*.ts`). **Wikidata content is CC0** — no attribution
legally required, but every acquired row still carries full per-row provenance
(`wikidata_qid`, `source_url`, `retrieved_at`, `confidence`, `sources`), enforced by the
convergence-QA attribution gate (`npm run convergence-qa`). Human-curated rows keep their original
sources and are never overwritten by acquisition (Guiding Principle #8).

---

## Core Language Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/families.tsv` | Glottolog, Ethnologue structure, manual curation | CC-BY / Mixed | 543 language families and subfamilies |
| `lexicons/languages.tsv` | Glottolog, Ethnologue, Wikipedia; UNESCO endangerment status via Wikidata (P1999) | CC-BY / CC0 / Mixed | 1,099 languages; UNESCO vitality enrichment on 549 rows (US-006) |
| `lexicons/words-base.tsv` | CLDF Concepticon, Swadesh lists | CC-BY | Base word concepts for comparison |
| `lexicons/words.tsv` | Wiktionary, CLDF, manual scraping | CC-BY-SA / Mixed | Word forms and IPA transcriptions |

## Geospatial Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/language-ranges.tsv` | Manual curation from historical atlases | CC-BY | 8 language range polygons with temporal validity |
| `lexicons/language-range-polygons.tsv` | Manual curation from historical atlases | CC-BY | 133 range polygons (Wikidata carries no inline geoshapes for our corpus — US-006) |
| `lexicons/archaeological-sites.tsv` | Wikidata (Q839954), manual curation from archaeological records | CC0 / CC-BY / Mixed | 550 sites (151 curated + 399 Wikidata-acquired; US-002) |
| `lexicons/archaeological-cultures.tsv` | Wikidata (Q465299), manual curation | CC0 / CC-BY / Mixed | 277 prehistoric cultures with predecessor/successor edges (US-003) |
| `lexicons/civilizations.tsv` | Wikidata, manual curation from historical sources | CC0 / CC-BY / Mixed | 170 civilizations (pilot + manual) |
| `lexicons/civilization-boundaries.tsv` | Manual curation from historical atlases | CC-BY | Boundary polygons with temporal snapshots |
| `lexicons/migration-routes.tsv` | Manual curation, anchored to verified Wikidata QIDs (GeoJSON waypoints) | CC-BY / Mixed | 104 migration routes (US-003) |
| `lexicons/trade-routes.tsv` | Manual curation, anchored to verified Wikidata QIDs | CC-BY / Mixed | 39 trade routes incl. Silk/Spice/Incense corridors (US-003) |

## Cultural Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/cuisines.tsv` | Wikidata (Q1968435), manual curation, Wikipedia | CC0 / CC-BY / Mixed | 101 world cuisines (US-004) |
| `lexicons/cuisine-items.tsv` | Manual curation | CC-BY | 2099 food items |
| `lexicons/ingredient-origins.tsv` | Wikidata (Q25403900), manual curation | CC0 / CC-BY / Mixed | 111 ingredient origins (US-004) |
| `lexicons/cooking-techniques.tsv` | Wikidata (Q1039303), manual curation | CC0 / CC-BY / Mixed | 92 cooking techniques (US-004) |
| `lexicons/writing-systems.tsv` | Wikidata (Q8192), manual curation | CC0 / CC-BY / Mixed | 115 writing systems (US-005) |
| `lexicons/deities.tsv` | Wikidata (Q178885), manual curation | CC0 / CC-BY / Mixed | 206 deities with syncretism (P460) edges (US-005) |
| `lexicons/architectural-styles.tsv` | Wikidata (Q32880), manual curation | CC0 / CC-BY / Mixed | 90 architectural styles (US-005) |
| `lexicons/dance-traditions.tsv` | Wikidata (subclasses of dance Q11401 / folk-dance Q201022), manual curation | CC0 / CC-BY / Mixed | 92 dance traditions (US-005) |
| `lexicons/literary-traditions.tsv` | Wikidata (Q2198855 literary movement), manual curation | CC0 / CC-BY / Mixed | 62 literary traditions (US-005) |
| `lexicons/myth-motifs.tsv` | Manual curation, anchored to verified Wikidata QIDs | CC-BY / Mixed | 61 cross-cultural myth motifs (US-005) |

## Music Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/music-traditions.tsv` | Ethnomusicological research, UNESCO, manual curation | CC-BY | 20 world music traditions with coordinates, temporal data, instruments, scales |
| `lexicons/musical-instruments.tsv` | Ethnomusicological research, UNESCO, manual curation | CC-BY | 25 traditional instruments with origins, materials, playing techniques |

## Religion Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/religions.tsv` | Historical records, sacred texts, ethnographic research | CC-BY | 20 world religions with coordinates, temporal data, sacred texts, deities, rituals |

## Genetic Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/haplogroups.tsv` | ISOGG Y-DNA Haplogroup Tree, academic genetic studies | CC-BY / Mixed | 62 Y-chromosome haplogroups with hierarchical tree, associated language families, temporal estimates |

## Raw Data (Not Yet Integrated)

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `data/proto-languages.txt` | Historical linguistics literature | CC-BY | Proto-language reconstructions |
| `data/native_migrations.txt` | Anthropological research | CC-BY | Migration route descriptions |
| `data/language_contact_phenomena.csv` | Linguistic research | CC-BY | Language contact and borrowing data |
| `data/language_hierarchy_complete_with_contact.csv` | Glottolog + manual curation | CC-BY | Extended language hierarchy with contact info |
| `data/top_100_foods_by_cuisine.csv` | Manual curation | CC-BY | Source data for cuisine-items.tsv |
| `data/top_30_main_dishes_by_cuisine.csv` | Manual curation | CC-BY | Supplementary cuisine data |
| `data/top_30_soups_by_cuisine.csv` | Manual curation | CC-BY | Supplementary cuisine data |

## External APIs & Services

| Service | Usage | License | Notes |
| --- | --- | --- | --- |
| OpenStreetMap | Map tiles | ODbL | Attribution required on map views |
| Google Generative AI | Data scraping assistance | API Terms | Used for augmenting word list data |
| Wikidata (WDQS / dumps) | Data acquisition for scaled domains (§15) | CC0 | Public-domain; every acquired row still records `wikidata_qid` + provenance |

---

## License Compatibility

| License | Can Use | Must Attribute | Share-Alike |
| --- | --- | --- | --- |
| CC0 | Yes | No | No |
| CC-BY | Yes | Yes | No |
| CC-BY-SA | Yes | Yes | Yes |
| CC-BY-NC | Caution | Yes | Non-commercial only |
| ODbL | Yes | Yes | Share-Alike for DB |
| Proprietary | No | N/A | N/A |

---

## How to Add New Data Sources

When adding a new dataset:

1. Record the source, license, and access date in this file
2. Add a `source_license` field to the TSV if the file mixes sources. The canonical
   export (schema **v1.1**, US-003) also stamps a per-record SPDX `license` column on every
   exported node and edge, resolved from the record's `source` via the `SOURCE_LICENSES`
   registry in `scripts/export-for-culturescrape.ts` — extend that registry when a new source
   with a distinct licence lands (e.g. a CC-BY-SA source: Glottolog / Wiktionary / PHOIBLE).
3. Prefer CC0 or CC-BY sources
4. If using CC-BY-SA data, note that derivatives must also be CC-BY-SA
5. Never commit proprietary data to this repository
6. For **acquired** rows (Wikidata/etc.), carry per-row provenance columns
   (`wikidata_qid`, `source_url`, `retrieved_at`, `confidence`, `sources`) — the convergence-QA
   attribution gate (`npm run convergence-qa`) fails any acquired row missing them

---

*Last updated: 2026-07-08 — per-domain counts + Wikidata acquisition sources updated for the populated corpus (roadmap §15 / `data-population`).*
