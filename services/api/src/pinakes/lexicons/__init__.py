"""The general corpus reader — `server/tsv-storage.ts`, ported.

Two earlier ports read the lexicon corpus and both say in their docstring that
they are *not* the storage layer: :mod:`pinakes.collab.citable` resolves one row
by id out of four files, and :mod:`pinakes.analytics.corpus` reads nine files for
the columns four computations score on. This package is what they were deferring
to — whole tables, every column, the record shapes the client parses.

Three modules, along the same seam the TypeScript had:

* :mod:`~pinakes.lexicons.storage` — the loaders (`server/tsv-storage.ts`).
* :mod:`~pinakes.lexicons.entity` — the canonical-URL registry
  (`server/services/entity-resolver.ts`).
* :mod:`~pinakes.lexicons.summary` — the progressive-loading projection
  (`server/services/entity-summary.ts`).

The package is named for the directory it reads (`data/source/lexicons`, which
:func:`pinakes.paths.lexicons_dir` locates) rather than "corpus", because two
other things in this service already own that word: ``pinakes.engine.corpus`` is
the *engine's* build artifact under `build/corpus`, and
``pinakes.analytics.corpus`` is the analytics slice of these same TSVs.
"""

from __future__ import annotations
