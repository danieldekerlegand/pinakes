"""Single-entity ingest — the routes that turn one paste into one draft.

The Python side of `server/routes/{text-extractor,url-extractor,translate}.ts`
(docs/UNIFIED-PROJECT-PLAN.md §7, pinakes:64 US-1). Three small pipelines that
share one shape: take something a person pasted, resolve it against an outside
source, and land the result in the **contribution review queue** — never in the
live dataset.

Same discipline as :mod:`pinakes.contributions` and :mod:`pinakes.lexicons`:
plain arguments in, JSON-ready dicts out, no FastAPI import. What is different
here is that every module in the package *reaches the network*, and it does so
through exactly one door — :mod:`pinakes.ingest.http`, which hands out the
engine's own rate-limited, retrying, disk-cached client. Nothing in this package
constructs a client of its own.

This is **not** bulk acquisition. A pasted URL is one entity, so it is resolved
through Wikidata's single-entity REST endpoint rather than the SPARQL query
service; a category is a *set*, and that stays :mod:`pinakes.engine.acquisition`'s
job.
"""

from __future__ import annotations
