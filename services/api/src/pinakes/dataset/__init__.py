"""The open-dataset publication half of the corpus: export, release, ingest.

Four TypeScript files land here, and they are one unit because the top of each
is the bottom of the next:

* :mod:`pinakes.dataset.export` — `server/services/export-pipeline.ts`. The
  per-profile exporter (`/api/export/*`) **and** the semver/DOI snapshot
  machinery built on top of it (`/api/dataset/*`).
* :mod:`pinakes.dataset.living` — `server/services/living-dataset.ts`. When the
  next annual release is due and which acquisition domains are stale, plus the
  one JSON file that records both (`/api/living-dataset/*`).
* :mod:`pinakes.dataset.bulk_import` — `server/services/bulk-import.ts`. The
  only route group in this package that **writes into the live corpus**
  (`/api/import/*`), and the only reason `.backups/` exists.

The three share `data/source/lexicons/` and nothing else; the release routes
compose the exporter rather than re-reading the corpus themselves, exactly as
the TypeScript did.
"""
