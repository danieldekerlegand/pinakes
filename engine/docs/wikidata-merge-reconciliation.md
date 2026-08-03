# Merged-corpus reconciliation — language & myth-religion (US-004)

When the language and myth-religion dump domains are stitched with the existing
pinakes convergence corpus (`pinakes_engine merge … --pinakes …`,
[wikidata-dump-runbook.md](wikidata-dump-runbook.md) §US-004), every acquired node
is classified against the nearest overlapping curated lexicon by the **offline
cascade** (`schema.lexicon_reconcile.reconcile_corpus_against_lexicon` →
`reconcile_pinakes`): language code → exact `(name, type, region)` → fuzzy
name (cross-source floor **0.93** — a wrong merge corrupts a curated node, a
missed one only surfaces a duplicate). **Ambiguous rows are never auto-merged** —
they are withheld for human triage.

Built from the reference slice (`wikidata-20260712-blueprint-slice`, 5,691
entities) merged with the live pinakes export (`build/corpus`),
2026-07-12. The built corpus is gitignored; these counts are the committed record.

## language nodes vs `data/source/lexicons/languages.tsv`

| metric | count |
| --- | --- |
| acquired (incoming corpus `language` nodes) | 1,459 |
| existing (lexicon rows) | 1,099 |
| **matched** (already curated) | **97** |
| **new** (candidates to add) | **1,362** |
| **ambiguous** (held for triage) | **0** |
| union distinct | 2,461 |

The 97 matches are the major curated languages the Wikidata `Q34770` slice also
carries — e.g. Abkhaz → `cs:language:abk`, Armenian → `cs:language:hye`,
Basque → `cs:language:eus`, Bengali → `cs:language:ben`, Bulgarian →
`cs:language:bul`, English → `cs:language:eng`, Dutch → `cs:language:nld` (all at
confidence 0.95, exact-name after normalization). The 1,362 `new` rows are
mostly minor / unwritten languages pinakes does not yet curate (Acehnese,
Afar, Ahom, …) plus a handful of QID-only rows the slice carried without an
English label. **0 ambiguous** — no acquired language collided with two rival
curated rows.

## deity nodes vs `data/source/lexicons/deities.tsv`

| metric | count |
| --- | --- |
| acquired (incoming corpus `deity` nodes) | 221 |
| existing (lexicon rows) | 206 |
| **matched** (already curated) | **198** |
| **new** (candidates to add) | **23** |
| **ambiguous** (held for triage) | **0** |
| union distinct | 229 |

198 of the 221 corpus deities reconcile onto a curated `deities.tsv` row — the
pinakes-origin deities (Aphrodite, Anubis, Brahma, …) re-match their own
curated rows, and the Wikidata `Q178885` members whose names align (Ahura Mazda,
Baal, Beelzebub, …) fold onto the curated entity. The 23 `new` deities (Abellio,
Abraxas, Am-heh, Anshar, Bennu, …) are candidates pinakes does not yet
curate. **0 ambiguous.**

## Why the merge is lossless

`csid` is `cs:<node-type>:<QID>`, so a shared Wikidata entity that two sources
type differently (a deity typed `Concept` by the dump vs `Deity` by pinakes,
a script typed `Language` vs `WritingSystem`, a place-hub the linker mints for a
QID pinakes curates as a `Culture`) would otherwise land as **two** nodes.
The merged build runs `ontology.reconcile_qid.reconcile_shared_qids` (opt-in via
the job's `reconcile_shared_qids: true`), which collapses same-QID nodes into one
— unioning their labels and redirecting edges — so **one QID is one node**. On
the reference merge this collapsed 14 cross-type duplicates, driving the corpus
`duplicate rate` gate to 0. This is the identity-preservation the reconciliation
above depends on; nothing is silently dropped and nothing ambiguous is merged.
