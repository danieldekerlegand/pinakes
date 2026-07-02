# Linguistic sources — vetted candidates

The prior-art pass (`docs/prior-art.md`) closed with linguistic sources marked
**unconfirmed**: "Linguistic sources (language-family trees, etymological
networks) … have no confirmed open structured source yet." This document closes
that gap. It evaluates each candidate lead for **coverage**, **format**, and
**license**, records the **Wikidata properties** that express the ontology's
linguistic edges (`DESCENDS_FROM` / `BORROWED_FROM` / `COGNATE_WITH`, see
`docs/data-model.md`), and picks one source that is **ingestible today** with the
existing acquisition stack.

## Candidate comparison

| Source | Coverage | Format | License | Ingestible now? |
|---|---|---|---|---|
| **Glottolog** 5.x | ~26k languoids; full genealogical family trees; glottocodes + ISO 639-3 | CLDF StructureDataset (CSV, tab/comma); GitHub + Zenodo dumps | CC-BY-SA 3.0 | Dump adapter (not yet built) |
| **Wikidata** language-family properties | Languages, families, proto-languages as items; lexemes for etymology | SPARQL → native TSV/CSV/JSON | CC0 1.0 | **Yes** — existing `wikidata-sparql` adapter |
| **WALS** (2020) | ~2.6k languages × ~190 structural features (phonology/grammar/lexicon) | CLDF StructureDataset (CSV); GitHub + Zenodo dumps | CC-BY 4.0 | Dump adapter (not yet built) |
| **PHOIBLE** 2.0 | ~3k inventories, ~2.1k languages; segment/phoneme inventories | CLDF dataset (CSV); GitHub + Zenodo dumps | CC-BY-SA 3.0 | Dump adapter (not yet built) |
| **Wiktionary** etymology | Broad cross-language etymologies/cognates/borrowings (free text + templates) | Wikitext dumps; no clean structured etymology export | CC-BY-SA 3.0 + GFDL | No — needs heavy wikitext parsing |

### Glottolog
The canonical open **language-family tree**: every languoid carries its
`Family_ID` (top-level family glottocode) and `Language_ID` (parent language for
dialects), which is exactly the `DESCENDS_FROM` genealogy this project links on.
The CLDF release `languages.csv` columns are:
`ID, Name, Macroarea, Latitude, Longitude, Glottocode, ISO639P3code, Level,
Countries, Family_ID, Language_ID, Closest_ISO369P3code,
First_Year_Of_Documentation, Last_Year_Of_Documentation, Is_Isolate`.
Best next target for a dedicated dump adapter; CC-BY-SA requires attribution +
share-alike, so the licence string must travel with each record (as the Getty
and Pleiades adapters already do).

### Wikidata language-family properties — **the pick**
Items model languages (`instance of` language, `Q34770`), language families
(`Q25295`), and proto-languages; the genealogy is the **`subclass of` (`P279`)
chain** up to a family root such as Indo-European (`Q19860`). Etymology lives at
the **lexeme** layer. Coverage is uneven versus Glottolog but it is **CC0** and,
crucially, reachable **with no new code**: the existing `wikidata-sparql` adapter
already returns native TSV. This is the source the shipped category spec uses
(`categories/indo-european-languages.yml`).

### WALS / PHOIBLE
Typological and phonological **feature** datasets rather than genealogies — they
enrich language nodes (structural attributes, phoneme inventories) but do not by
themselves yield the linguistic *edges*. Both are clean CLDF/CSV dumps and good
later dump-adapter targets; WALS is CC-BY 4.0, PHOIBLE CC-BY-SA 3.0.

### Wiktionary etymology
Richest etymological/cognate coverage in principle, but it is unstructured
wikitext (etymology templates inside prose) with no faithful structured export;
extracting it reliably is a research effort of its own (would ride the existing
`wikitext` adapter + `mwparserfromhell`). Deferred.

## Wikidata properties for the linguistic ontology edges

The ontology's linguistic `:TYPE`s (`src/culturescrape/ontology/registry.py`)
map onto Wikidata as follows. Wikidata has **no single dedicated "descends from
language" property**; the community convention is the `subclass of` chain, and
etymology is expressed at the lexeme layer.

| Ontology `:TYPE` | Wikidata expression | Notes |
|---|---|---|
| `DESCENDS_FROM` (language → ancestor) | **`P279`** `subclass of` (transitive chain to a family root); **`P4913`** `dialect of` for dialect → parent | No dedicated property; the family tree is the `wdt:P279*` path. |
| `BORROWED_FROM` (term → source) | **`P5191`** `derived from lexeme`, qualified by **`P5886`** `mode of derivation` = *linguistic borrowing* | Lexeme-layer; references recommended (default constraint on `P5191`). |
| `COGNATE_WITH` (term ↔ term) | No dedicated property — inferred: two lexemes sharing a `P5191` etymon are cognate | `P5886` separates inheritance from borrowing along the shared chain. |

Supporting properties: `P220` ISO 639-3 code, `P1394` Glottolog code (anchor
language nodes to Glottolog), `P5238` `combines lexemes`, `P5920` `root`.

## Decision

1. **Ship now:** a Wikidata SPARQL category spec
   (`categories/indo-european-languages.yml`) — ingestible immediately via the
   existing adapter, demonstrates the linguistic dimension and `DESCENDS_FROM`.
2. **Next:** a **Glottolog** CLDF dump adapter (`source.type: dump`) for
   authoritative family trees, modelled on the Getty/Pleiades dump adapters.
3. **Later:** WALS/PHOIBLE dump adapters for feature enrichment; Wiktionary
   etymology via the wikitext adapter once structured extraction is viable.

## Sources

- Glottolog CLDF — <https://github.com/glottolog/glottolog-cldf>, downloads <https://glottolog.org/meta/downloads>
- Wikidata `subclass of` (P279) — <https://www.wikidata.org/wiki/Property:P279>
- Wikidata `derived from lexeme` (P5191) — <https://www.wikidata.org/wiki/Property:P5191>
- Wikidata `mode of derivation` (P5886) — <https://www.wikidata.org/wiki/Property:P5886>
- WALS CLDF — <https://github.com/cldf-datasets/wals>
- PHOIBLE — <https://en.wikipedia.org/wiki/PHOIBLE>, CLDF <https://github.com/cldf-datasets/phoible>
