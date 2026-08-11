# Decision D4 — ingest CLDF, adopt Wikibase, tier by licence at ingest

**Status:** Canonical decision, taken 2026-08-11. Both halves approved.
**Source:** `~/Development/ADOPT-DECIDE-REGISTER.md` D4 (+ finding F5), from the completed
prior-art sweep. This file is pinakes's in-repo record of it — the register is the
portfolio-wide ledger; this is the repo's own authority for what changes here and why.
**Tasklists:** `117`–`124` (+ the rewrite of `113` and the re-scope of `107`/`114`/`115`).

**TL;DR** — three changes, in dependency order:

1. **Licence tiering moves to ingest** (`117`). It is at publication today, which is a latent
   legal defect, not a design preference. This blocks everything else.
2. **Published CLDF datasets become the linguistics substrate** (`113`, `118`, `119`);
   hand-curation is retired into them and redirected to the **cross-domain lineage DAG**.
3. **Wikibase becomes the canonical store** (`120`–`124`); Neo4j/DuckDB become derived
   read-indexes and TSV becomes import/export only. A 2–3 month program with a measured
   go/no-go gate and a documented fallback.

---

## 1. What was actually decided

| | Decision | Consequence here |
|---|---|---|
| **D4(a) DATA** | Ingest the published CLDF corpora; reserve curation for the cross-domain lineage DAG | `113` rewritten, `118` + `119` authored, `107` corrected |
| **D4(b) STORE** | Wikibase canonical; Neo4j/DuckDB derived; TSV import/export only | Phase D: `120`–`124` |
| **F5 ⚠ CRITICAL** | Corpus tiering by licence must happen **at ingest**, not at publication | `117`, head of the chain |

---

## 2. D4(a) — retire hand-curation into ingest

**The finding.** Hand-curating 1,100 languages is the largest avoidable cost in this repo,
and the published alternatives are better resourced than we are:

| Dataset | Scale | Licence | Status here |
|---|---|---|---|
| **Glottolog** (CLDF) | ~8,600 language-level languoids inside ~26k total | `CC-BY-4.0` | adapter `107`, run `113` |
| **Grambank** (CLDF) | 195 features × 2,400+ languages | `CC-BY-4.0` | **not ingested** → `118` |
| **WALS** (CLDF) | 192 features × 2,600+ languages | `CC-BY-4.0` | ✅ shipped |
| **PHOIBLE** (CLDF) | 3,000+ languages | data `CC-BY-SA-3.0` ⚠ *repo is GPL-3.0 — verify the split* | ✅ shipped; split to re-verify in `118` |
| **Concepticon** | concept-set catalogue | ⚠ **no SPDX on the repo — verify before ingest** | informal today → `118` |
| **Lexibank / ABVD** (CLDF) | ≥500 languages | `CC-BY-4.0` (per-dataset) | ✅ shipped |
| **wiktextract / kaikki** | etymologies | `CC-BY-SA-3.0` ⚠ share-alike propagates | ✅ shipped |

**CLLD is the framework those datasets already publish through** — the presentation layer
pinakes has been rebuilding. That is not an argument to stop building the atlas; it is an
argument to stop building the *catalogue* underneath it.

**The measured case, from our own tree.** `docs/corpus-tier-report.md` shows the curation
spend is not buying provenance quality: **552 of 1,099** language rows and **0 of 543**
family rows are QID-anchored *and* reference-backed. Glottolog publishes that identity and
genealogy, maintained, with a release cycle.

**What curation is for instead.** The **cross-domain lineage DAG** — cuisine · religion ·
genetics · trade × language, temporally and geographically situated. No CLDF dataset, no
CLLD instance, and no other open project publishes it. It is pinakes's real differentiator
and is currently the least-resourced part of the corpus. `119` gives it a schema, a
coverage report, and a target for the first time.

**What is *not* retired.** Anything nobody publishes stays curated and is now a *known,
countable* set rather than an unbounded backlog: reconstructed proto-languages, historical
variants and dialect-level entries Glottolog does not carry, the language **range polygons**
(`109` — Glottolog publishes point coordinates, not boundaries; the 133/200 gap is real),
and every curated field the ingest has no counterpart for.

**A correction found in the review.** `107` and the superseded `113` both stated Glottolog
is **CC-BY-SA-3.0**. It is **CC-BY-4.0** (`docs/ATTRIBUTION.md` already had it right).
Mis-stamping it share-alike would have propagated a duty the licence does not impose —
which is precisely the class of error §4 exists to prevent, in the opposite direction.

## 3. Sequencing D4(a)

```
117 (licence tiering at ingest)  ─┬─> 118 (Grambank + Concepticon specs) ─┐
106 ─> 107/108/109 (adapters) ────┴──────────────────────────────────────┴─> 113 (run) ─> 119 (retire + redirect)
```

`119` is deliberately separate from `113`: the ingest is reviewed *before* anything curated
is displaced, and the retirement is gated on a committed delta report that classifies every
curated row as **superseded**, **additive**, or **unmatched**.

---

## 4. ⚠ Licence tiering at ingest — the latent defect this closes

**This is the most important part of D4 and the only part that is a defect rather than an
improvement.** Licences propagate *through our own pipeline*: pinakes → lugh's training
corpus → trained models, and pinakes → insimul synthetic worlds. **Seshat is
`CC-BY-NC-SA-4.0`** (blocks commercial use); **Wiktionary-derived etymology is
`CC-BY-SA-3.0`** (share-alike). Neither obligation can be undone by a downstream filter
once a mis-stamped row has left the repo.

**Where enforcement sits today — verified on disk:**

- `contracts/egress-policy.json` declares `"enforcedAt": "pack-construction"` with
  `licensePolicy.allowedSpdxClasses: ["CC0","CC-BY"]` — i.e. **at publication**.
- `data/source/lexicons/*.tsv` has **no `license` column**. The SPDX id is *derived at
  export time* from the row's `source` cell by `licenseForSource` / `DEFAULT_LICENSE` in
  `scripts/export-for-engine.ts`.
- `engine/.../schema/license_class.py` classifies correctly — but it runs in
  `orchestrate/package.py`, at packaging time.
- `engine/inputs/categories/seshat-polities.yml` *does* stamp `license: CC-BY-NC-SA-4.0`
  at the category level, which is the right instinct in the wrong place: the stamp exists,
  the **gate** does not.

**The three consequences, all live today:**

1. A curated row whose content came from a share-alike or non-commercial upstream but whose
   `source` cell reads `pinakes` is stamped the permissive default and passes the CC0/CC-BY
   filter unchallenged.
2. Share-alike (PHOIBLE, kaikki) and non-commercial (Seshat) records sit in the same corpus
   as the permissive core and are only separated later, by a step that can be skipped.
3. Because the obligations leave the repo, a filter applied at the exit is a filter applied
   too late.

**The decision:** a record acquires its SPDX licence **and its tier at admission**; the tier
is **stored, never re-derived**; an unregistered licence is **fail-closed `unknown`** and is
not admitted; the publication-side filter **stays** as defence-in-depth rather than as the
only gate. Tiers: permissive core (`public-domain` + `attribution`) · **share-alike
overlay**, kept distinct so its duty never propagates onto the core · **non-commercial**,
quarantined out of any commercially-redistributable partition · `synthetic`/proprietary
(insimul worlds, `114`) · `unknown`, never redistributed. That is `117`, and `113`, `114`,
`118` and `122` all depend on it.

---

## 5. D4(b) — Wikibase as the canonical store

**Why.** Wikibase natively models **statements + qualifiers + references + ranks**, so
*"true at time T, place P, per source S"* is a **primitive** rather than a TSV convention
every reader has to reconstruct. Two competing classifications from two sources become two
ranked statements instead of a resolution the corpus has to bake in and lose. The
provenance quartet that rides on every row today becomes a reference block on the statement
it actually supports. And the `117` licence tier becomes a queryable attribute at statement
granularity rather than a per-row approximation.

**Proven in this exact domain**, which is why the risk is adoption rather than research:
**FactGrid**, **Enslaved.org**, **Rhizome ArtBase**, plus a peer-reviewed
CIDOC-CRM-over-Wikibase modelling method to follow rather than reinvent.

**The honest costs — encoded in the tasklists, not discovered during them:**

- A **four-service stack** (MediaWiki + relational backing store + triplestore query service
  + updater), which Wikibase's own guidance says may demand dedicated sysadmin attention.
- An **inherited migration**: the Blazegraph-era query service is end-of-life, the WDQS
  graph split went live **2025-05-09**, and the legacy endpoint sunset in **Dec 2025** — a
  new deployment lands on QLever-era tooling, not on what most tutorials assume.
- Realistically a **2–3 month program** across five tasklists. Sizing it as a sprint is how
  this fails.

**The documented fallback**, a legitimate outcome and not a failure: **Oxigraph**
(Apache-2.0, single binary, no updater, no MediaWiki) with the Wikibase **data model**
replicated on top. pinakes keeps statements/qualifiers/references/ranks and loses the
curation UI and the ecosystem tooling. `120` US-3 must record the outcome either way.

### The program

| # | Tasklist | Delivers | Gate |
|---|---|---|---|
| `120` | assessment + ops gate | the stack stood up for real, measured import/query numbers, the **go / fallback decision with numbers attached** | the whole program is gated on this |
| `121` | property ontology | canonical-schema → items/properties/qualifiers/references/ranks, csid identity preserved, licence tier queryable | round-trip proof on a deliberately hard slice |
| `122` | corpus import | idempotent, resumable, re-runnable import with a **completeness proof that fails loudly** | TSV is still source of truth — safe to re-run |
| `123` | derived read-index rebuild | Neo4j + DuckDB rebuilt from the store, reproducibly; atlas read path unchanged and no slower | benchmarked against the `120` baseline |
| `124` | cutover | writes go to the store; TSV becomes import/export only; every doc that states the authority is corrected | **rollback rehearsed before the flip** |

**What does not change across the migration:** the `cs:` id-space stays stable and
QID-anchored (it is shared data — with lugh and the client — so changing it is a corpus
migration, not a refactor); provenance still rides on every claim; the `117` tier is still
stamped at admission and still gates every export; and `chief/91`/`102`'s citable DOI
snapshots keep working, now fed from the store.

**What `124` deliberately breaks:** `CLAUDE.md`'s first invariant — *"TSV-first.
`data/source/lexicons/*.tsv` is the corpus source of truth"* — becomes false, and correcting
every document that asserts it is one of `124`'s deliverables, not its epilogue. An agent
reading a stale invariant writes to the wrong authority.

---

## 6. Related

- `~/Development/ADOPT-DECIDE-REGISTER.md` — the portfolio decision register (D4, F5).
- [`ROADMAP.md`](../ROADMAP.md) — Phases B and D carry these rows.
- [`docs/ATTRIBUTION.md`](ATTRIBUTION.md) — per-source licences and the redistribution
  partition (rewritten by `117` US-3 to describe ingest-time tiering).
- [`contracts/egress-policy.json`](../contracts/egress-policy.json) — the enforcement point
  `117` re-points.
- [`engine/docs/sources-linguistic.md`](../engine/docs/sources-linguistic.md) — the vetted
  CLDF source candidates.
