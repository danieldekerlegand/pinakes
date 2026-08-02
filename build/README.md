# `build/` — regenerable outputs (gitignored)

**Status: empty placeholder.** Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md).

## Purpose

Every artifact a pipeline can rebuild from committed inputs. Nothing here is a
source of truth, so nothing here is versioned: the directory is **gitignored** and
only this README is tracked (`.gitignore` carries a `!/build/README.md` negation
to keep the placeholder visible).

DVC used to version some of these trees; it was stranded and has been removed —
see [`docs/artifact-versioning.md`](../docs/artifact-versioning.md) for the
one-command path to re-enable artifact versioning later against a *cloud* remote.

## Moves in later

| Current | Note |
|---|---|
| `export/culturescrape/` | already gitignored today |
| `core/out/` | already gitignored today |
