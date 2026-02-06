# Data Attribution & Licensing

This document tracks data sources, licenses, and attribution requirements for all datasets used in LinguaScrape.

---

## Core Language Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/families.tsv` | Glottolog, Ethnologue structure, manual curation | CC-BY / Mixed | 545 language families and subfamilies |
| `lexicons/languages.tsv` | Glottolog, Ethnologue, Wikipedia | CC-BY / Mixed | Language metadata, coordinates, speaker counts |
| `lexicons/words-base.tsv` | CLDF Concepticon, Swadesh lists | CC-BY | Base word concepts for comparison |
| `lexicons/words.tsv` | Wiktionary, CLDF, manual scraping | CC-BY-SA / Mixed | Word forms and IPA transcriptions |

## Geospatial Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/language-ranges.tsv` | Manual curation from historical atlases | CC-BY | 8 language range polygons with temporal validity |
| `lexicons/archaeological-sites.tsv` | Manual curation from archaeological records | CC-BY | 3 sites (Pompeii, Göbekli Tepe, Delphi) |
| `lexicons/civilizations.tsv` | Manual curation from historical sources | CC-BY | 2 civilizations (Roman Empire, Ancient Greece) |
| `lexicons/civilization-boundaries.tsv` | Manual curation from historical atlases | CC-BY | 2 boundary polygons with temporal snapshots |

## Cultural Data

| Dataset | Source | License | Notes |
| --- | --- | --- | --- |
| `lexicons/cuisines.tsv` | Manual curation, Wikipedia | CC-BY | 21 world cuisines with coordinates and temporal data |
| `lexicons/cuisine-items.tsv` | Manual curation | CC-BY | 2100 food items from 21 cuisines |

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
2. Add a `source_license` field to the TSV if the file mixes sources
3. Prefer CC0 or CC-BY sources
4. If using CC-BY-SA data, note that derivatives must also be CC-BY-SA
5. Never commit proprietary data to this repository

---

*Last updated: 2025-02-06*
