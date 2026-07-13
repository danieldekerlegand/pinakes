"""Group per-record SPDX licences into redistribution classes.

Every canonical node carries a per-record SPDX ``license`` (schema v1.1,
source-breadth US-001/003) — several new sources are CC-BY-SA share-alike, so at
aggregate scale the packaged corpus must be able to *self-describe* by what may be
redistributed under which terms (source-breadth US-005). This module is the pure,
tested bridge from an individual SPDX id to the small set of **licence classes**
the package manifest partitions on, plus the plain-language redistribution / model-
training statement each class carries.

The classes, from most-permissive (the redistributable *core*) to most-restrictive:

- ``public-domain`` — CC0 / public-domain dedication: redistribute freely, no
  attribution, nothing inherited by a trained model.
- ``attribution`` — CC-BY (any version): redistribute with credit; no share-alike.
- ``share-alike`` — CC-BY-SA (any version): redistribute with credit **and** under
  the same/compatible licence; an adapted database inherits the share-alike duty.
- ``non-commercial`` — CC-BY-NC / CC-BY-NC-SA: the above **plus** a non-commercial
  restriction (kept out of any commercially-redistributable partition).
- ``unstamped`` — a blank ``license`` cell: structural / synthetic rows (the
  per-category ``type`` + ``category`` hub nodes are sourceless by design) that
  carry no third-party content.
- ``unknown`` — an SPDX id this registry does not recognise: treated as
  all-rights-reserved until a human verifies and registers it (never redistributed).

Keep this module free of I/O so it is unit-testable without a build;
:mod:`culturescrape.orchestrate.package` calls it to embed the licence partition in
the published manifest.
"""

from __future__ import annotations

from collections.abc import Mapping

#: The licence classes, ordered most-permissive → most-restrictive. The package
#: manifest emits per-class counts in this order so a reviewer reads the corpus's
#: redistribution profile top-down (free core first, restrictions last).
LICENSE_CLASSES: tuple[str, ...] = (
    "public-domain",
    "attribution",
    "share-alike",
    "non-commercial",
    "unstamped",
    "unknown",
)

#: SPDX id (upper-cased, stripped) → licence class. Only the ids that actually reach
#: the corpus need listing; an unlisted id falls to ``unknown`` (a deliberate
#: verify-before-redistribute guard, never silently treated as permissive).
_SPDX_TO_CLASS: dict[str, str] = {
    "CC0-1.0": "public-domain",
    "CC-PDDC": "public-domain",
    "CC-BY-4.0": "attribution",
    "CC-BY-3.0": "attribution",
    "CC-BY-2.5": "attribution",
    "CC-BY-2.0": "attribution",
    "CC-BY-1.0": "attribution",
    "CC-BY-SA-4.0": "share-alike",
    "CC-BY-SA-3.0": "share-alike",
    "CC-BY-SA-2.5": "share-alike",
    "CC-BY-SA-2.0": "share-alike",
    "CC-BY-SA-1.0": "share-alike",
    "CC-BY-NC-4.0": "non-commercial",
    "CC-BY-NC-3.0": "non-commercial",
    "CC-BY-NC-SA-4.0": "non-commercial",
    "CC-BY-NC-SA-3.0": "non-commercial",
}

#: Per-class redistribution + model-training statement (source-breadth US-005 AC3).
#: ``redistribute`` — what a downstream may share and under which terms;
#: ``model`` — what a model trained on this class inherits. Reviewed against each
#: Creative-Commons deed; the share-alike ML caveat is deliberately hedged because
#: whether trained weights are an "adaptation" of a CC-BY-SA database is unsettled.
REDISTRIBUTION: dict[str, dict[str, str]] = {
    "public-domain": {
        "redistribute": (
            "Freely, under any terms, with or without attribution — no obligations."
        ),
        "model": "A trained model inherits no licensing obligation from these records.",
    },
    "attribution": {
        "redistribute": (
            "Yes, provided the source (dataset, author, licence, and any changes) is "
            "credited. No share-alike obligation — may be combined with the "
            "public-domain core and redistributed under compatible terms."
        ),
        "model": (
            "Attribution to the listed sources must accompany the model or its data "
            "card; the model output is not itself encumbered by share-alike."
        ),
    },
    "share-alike": {
        "redistribute": (
            "Yes, with attribution AND under the same or a compatible CC-BY-SA "
            "licence: an adapted database built from these records must itself be "
            "released CC-BY-SA. Keep this partition as a distinct overlay so the "
            "share-alike duty is not silently propagated onto the permissive core."
        ),
        "model": (
            "An adapted dataset inherits the CC-BY-SA share-alike duty. Whether ML "
            "model weights are an 'adaptation' is legally unsettled — attribute the "
            "sources and treat any redistributed derivative dataset as CC-BY-SA."
        ),
    },
    "non-commercial": {
        "redistribute": (
            "Only for non-commercial purposes, with attribution (and share-alike for "
            "the -NC-SA variants). Excluded from any commercially-redistributable "
            "partition of the corpus."
        ),
        "model": (
            "A model trained on these records may not be used commercially without "
            "separate permission from the rightsholder."
        ),
    },
    "unstamped": {
        "redistribute": (
            "Structural / synthetic rows carrying no third-party content (e.g. the "
            "per-category type and category hub nodes); safe to ship with the "
            "permissive core."
        ),
        "model": "No third-party content, so no obligation is inherited.",
    },
    "unknown": {
        "redistribute": (
            "Do NOT redistribute until the licence is identified and registered — "
            "treat as all-rights-reserved."
        ),
        "model": "Unverified — must be resolved before training or redistribution.",
    },
}


def classify_license(spdx: str) -> str:
    """Return the redistribution class for an SPDX licence id.

    A blank id classifies as ``unstamped`` (structural rows); an unrecognised id
    classifies as ``unknown`` (verify before redistributing), never silently
    promoted to a permissive class.
    """
    key = spdx.strip().upper()
    if not key:
        return "unstamped"
    return _SPDX_TO_CLASS.get(key, "unknown")


def class_registry(
    spdx_ids: Mapping[str, int] | tuple[str, ...] | list[str],
) -> dict[str, str]:
    """Map each present SPDX id to its class, in sorted-id order.

    Accepts either a ``{spdx: count}`` map or an iterable of ids; the blank id is
    rendered as the sentinel ``"(unstamped)"`` so the registry stays a valid, human-
    readable string→string map even when some rows carry no licence.
    """
    ids = spdx_ids.keys() if isinstance(spdx_ids, Mapping) else spdx_ids
    registry: dict[str, str] = {}
    for spdx in sorted(set(ids)):
        label = spdx.strip() or "(unstamped)"
        registry[label] = classify_license(spdx)
    return registry


def partition_by_class(records_by_license: Mapping[str, int]) -> dict[str, int]:
    """Roll a ``{spdx: count}`` map up into ``{class: count}`` (present classes only).

    Classes are emitted in :data:`LICENSE_CLASSES` order (permissive → restrictive);
    a class with no records is omitted, so the partition reflects exactly what the
    corpus holds.
    """
    totals: dict[str, int] = {}
    for spdx, count in records_by_license.items():
        cls = classify_license(spdx)
        totals[cls] = totals.get(cls, 0) + count
    return {cls: totals[cls] for cls in LICENSE_CLASSES if cls in totals}


def redistribution_for(
    classes: tuple[str, ...] | list[str],
) -> dict[str, dict[str, str]]:
    """The redistribution/model statements for the given classes, in class order."""
    present = set(classes)
    return {
        cls: REDISTRIBUTION[cls] for cls in LICENSE_CLASSES if cls in present
    }
