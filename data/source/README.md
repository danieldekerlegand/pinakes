# `data/source/` — curated inputs

Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../../docs/UNIFIED-PROJECT-PLAN.md). Unlike the
other skeleton directories this one **already held real data** (`haplogroups.txt`,
`top_100_foods_by_cuisine.csv`); the plan grew it rather than creating it.

## Purpose

Hand-curated, committed inputs — the opposite of `../runtime/` (per-user state,
gitignored) and `../../build/` (regenerable outputs, gitignored). If a file here
is lost, no pipeline can reproduce it.

## Contents

| Path | Note |
|---|---|
| `lexicons/` | the 57 canonical lexicon TSVs — moved here from the repo top level by pinakes:20 US-3, with every reader's path literal rewritten (~60 in `server/tsv-storage.ts` alone; that file is not rewritten in Python until a later tasklist) |
| `haplogroups.txt`, `top_100_foods_by_cuisine.csv` | the raw inputs `lexicons/haplogroups.tsv` and `lexicons/cuisines.tsv` were converted from |

Siblings: `../archive/` (parked data from the data-reorg) and `../runtime/`
(gitignored per-user state — collections, annotations, stewardship, changelog).
