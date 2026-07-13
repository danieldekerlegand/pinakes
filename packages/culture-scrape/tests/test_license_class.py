"""Tests for the SPDX-licence → redistribution-class registry (source-breadth US-005).

Pins the classification every new share-alike source relies on: CC0 → public-domain,
CC-BY → attribution, CC-BY-SA → share-alike, CC-BY-NC(-SA) → non-commercial, blank →
unstamped, and an unrecognised id → unknown (never silently promoted to permissive).
"""

from __future__ import annotations

import pytest

from culturescrape.schema.license_class import (
    LICENSE_CLASSES,
    REDISTRIBUTION,
    class_registry,
    classify_license,
    partition_by_class,
    redistribution_for,
)


@pytest.mark.parametrize(
    ("spdx", "expected"),
    [
        ("CC0-1.0", "public-domain"),
        ("CC-BY-4.0", "attribution"),
        ("CC-BY-3.0", "attribution"),
        ("CC-BY-SA-3.0", "share-alike"),  # PHOIBLE, kaikki/Wiktionary
        ("CC-BY-SA-4.0", "share-alike"),
        ("CC-BY-NC-4.0", "non-commercial"),
        ("CC-BY-NC-SA-3.0", "non-commercial"),
        ("", "unstamped"),
        ("   ", "unstamped"),
        ("all-rights-reserved", "unknown"),
        ("MIT", "unknown"),
    ],
)
def test_classify_license(spdx: str, expected: str) -> None:
    assert classify_license(spdx) == expected


def test_classify_is_case_and_whitespace_insensitive() -> None:
    assert classify_license(" cc-by-sa-3.0 ") == "share-alike"


def test_partition_by_class_rolls_up_and_orders_permissive_first() -> None:
    partition = partition_by_class(
        {
            "CC-BY-SA-3.0": 10,
            "CC-BY-4.0": 5,
            "CC0-1.0": 2,
            "": 1,
        }
    )
    # Ordered public-domain → share-alike (permissive → restrictive); empty dropped.
    assert list(partition) == [
        "public-domain",
        "attribution",
        "share-alike",
        "unstamped",
    ]
    assert partition == {
        "public-domain": 2,
        "attribution": 5,
        "share-alike": 10,
        "unstamped": 1,
    }


def test_class_registry_maps_every_present_id() -> None:
    registry = class_registry({"CC-BY-4.0": 3, "CC-BY-SA-3.0": 1, "": 2})
    assert registry == {
        "(unstamped)": "unstamped",
        "CC-BY-4.0": "attribution",
        "CC-BY-SA-3.0": "share-alike",
    }


def test_redistribution_covers_every_class_and_present_only() -> None:
    # Every declared class has a redistribute + model statement.
    for cls in LICENSE_CLASSES:
        assert REDISTRIBUTION[cls]["redistribute"]
        assert REDISTRIBUTION[cls]["model"]
    # redistribution_for returns only the requested classes, in class order.
    picked = redistribution_for(("share-alike", "attribution"))
    assert list(picked) == ["attribution", "share-alike"]
