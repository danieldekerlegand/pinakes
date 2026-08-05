"""Bulk Wikidata acquisition, filed into the contribution review queue.

The half of `server/services/engine-acquisition.ts` that is *not* plumbing: the
four-domain catalog, the SPARQL each domain runs, and the record → contribution
mapping. The plumbing — render a YAML spec, spawn
``python -m pinakes_engine.cli fetch``, read the ``.jsonl`` back — is already
gone: :mod:`pinakes.engine.acquisition` calls the engine in this process.

It lives here rather than under :mod:`pinakes.kcb` because it is not a bus
concept. Today its only caller is the MCP ``reconcile`` tool; ``POST
/api/scraping/engine`` is a different port unit (`tasks/chief/70-unify-scrapers`)
and should call :func:`~pinakes.acquire.job.run` rather than grow a second copy
of this table.
"""

from pinakes.acquire.catalog import (
    ACQUISITION_CATALOG,
    AcquisitionCategory,
    build_acquisition_query,
    category_spec,
    list_acquisition_categories,
    resolve_acquisition_category,
)
from pinakes.acquire.job import AcquisitionOutcome, record_to_contribution, run

__all__ = [
    "ACQUISITION_CATALOG",
    "AcquisitionCategory",
    "AcquisitionOutcome",
    "build_acquisition_query",
    "category_spec",
    "list_acquisition_categories",
    "record_to_contribution",
    "resolve_acquisition_category",
    "run",
]
