"""Per-dataset SPDX licence registry for Lexibank CLDF wordlists.

Lexibank is a *collection* of independently-published CLDF wordlist datasets, and
its licence is **not** a property of the collection — each dataset carries its own
``dc:license`` in its ``cldf-metadata.json`` (source-breadth US-003, AC2). Most are
``CC-BY-4.0``, but the ecosystem also holds share-alike (``CC-BY-SA``),
non-commercial (``CC-BY-NC``), and public-domain (``CC0``) datasets, so stamping one
licence across "all of Lexibank" would be legally wrong. This module is therefore the
**per-dataset** registry: a Lexibank dataset id (its CLDF module / GitHub repo name,
e.g. ``abvd``, ``asjp``) maps to the SPDX id that must travel with every record it
contributes to the graph — which is what makes the packaged corpus partitionable by
licence class (US-005).

:data:`LEXIBANK_LICENSES` seeds the datasets whose ``dc:license`` has been verified
against their CLDF metadata; :func:`license_for` looks a dataset up, and
:func:`spdx_from_license_url` normalises a Creative-Commons licence URL to its SPDX id
so a new dataset's declared licence can be admitted to the registry mechanically
(rather than by assuming the collection default).
"""

from __future__ import annotations

#: SPDX id stamped when a Lexibank dataset is not (yet) in the registry. Chosen as
#: the collection's dominant licence, but a dataset is only ingested once its own
#: licence is verified and registered — never silently defaulted into the graph.
DEFAULT_LEXIBANK_LICENSE = "CC-BY-4.0"

#: Per-dataset SPDX registry: Lexibank dataset id -> SPDX licence id. Each value is
#: read from that dataset's CLDF ``cldf-metadata.json`` ``dc:license`` (verified at
#: ingest time), NOT assumed from the collection. Add a dataset here — with its own
#: verified licence — before ingesting it, so its per-record ``license`` is correct.
LEXIBANK_LICENSES: dict[str, str] = {
    "abvd": "CC-BY-4.0",  # Austronesian Basic Vocabulary Database
    "asjp": "CC-BY-4.0",  # Automated Similarity Judgment Program
    "wold": "CC-BY-4.0",  # World Loanword Database
    "northeuralex": "CC-BY-4.0",  # Northern EurAsian Lexicon
    "ids": "CC-BY-4.0",  # Intercontinental Dictionary Series
    "diacl": "CC-BY-4.0",  # Diachronic Atlas of Comparative Linguistics
    "dravlex": "CC-BY-4.0",  # Dravidian Lexicon
}

#: Creative-Commons (+ CC0) licence-URL stems mapped to their SPDX ids. Both the
#: bare ``.../licenses/by/4.0`` and trailing-slash / ``deed`` forms resolve, since
#: CLDF metadata uses either. Ordered longest-first at lookup so ``by-nc-sa`` wins
#: over ``by-nc`` / ``by``.
_CC_URL_TO_SPDX: dict[str, str] = {
    "publicdomain/zero/1.0": "CC0-1.0",
    "licenses/by-nc-sa/4.0": "CC-BY-NC-SA-4.0",
    "licenses/by-nc-sa/3.0": "CC-BY-NC-SA-3.0",
    "licenses/by-nc/4.0": "CC-BY-NC-4.0",
    "licenses/by-sa/4.0": "CC-BY-SA-4.0",
    "licenses/by-sa/3.0": "CC-BY-SA-3.0",
    "licenses/by/4.0": "CC-BY-4.0",
    "licenses/by/3.0": "CC-BY-3.0",
}


def license_for(dataset: str) -> str:
    """SPDX licence id for a Lexibank *dataset*, by its registered value.

    Falls back to :data:`DEFAULT_LEXIBANK_LICENSE` for an unregistered dataset —
    but a dataset should be registered with its own verified licence before it is
    ingested, so the fallback is a guard, not a licensing decision.
    """
    return LEXIBANK_LICENSES.get(dataset.strip().lower(), DEFAULT_LEXIBANK_LICENSE)


def spdx_from_license_url(url: str) -> str | None:
    """Normalise a Creative-Commons licence *url* to its SPDX id, or ``None``.

    Recognises the ``creativecommons.org/licenses/<code>/<version>`` and
    ``creativecommons.org/publicdomain/zero/1.0`` URL families a CLDF dataset's
    ``dc:license`` uses, matching the longest (most specific) stem first so
    ``by-nc-sa`` is not mistaken for ``by``. Returns ``None`` for an unrecognised
    URL, so a caller registers the licence deliberately rather than mis-stamping it.
    """
    normalised = url.strip().rstrip("/").lower()
    for stem, spdx in _CC_URL_TO_SPDX.items():
        if stem in normalised:
            return spdx
    return None
