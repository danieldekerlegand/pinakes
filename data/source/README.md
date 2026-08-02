# `data/source/` — curated inputs

Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../../docs/UNIFIED-PROJECT-PLAN.md). Unlike the
other skeleton directories this one **already holds real data** (`haplogroups.txt`,
`top_100_foods_by_cuisine.csv`); the plan grows it rather than creating it.

## Purpose

Hand-curated, committed inputs — the opposite of `../runtime/` (per-user state,
gitignored) and `../../build/` (regenerable outputs, gitignored). If a file here
is lost, no pipeline can reproduce it.

## Moves in later

| Current | Note |
|---|---|
| `lexicons/` (top level) | becomes `data/source/lexicons/`; cheap only once the readers are rewritten (§4 — ~60 hardcoded path literals in `server/tsv-storage.ts` today) |

Siblings: `../archive/` (parked data from the data-reorg) and `../runtime/`
(gitignored per-user state — collections, annotations, stewardship, changelog).
