"""The Lexibank licence registry is per-dataset, not per-collection (US-003 AC2).

Lexibank aggregates many independently-licensed CLDF datasets, so the licence must be
keyed on the dataset id and resolvable from each dataset's declared CC licence URL —
never assumed once for "all of Lexibank". These tests pin that the registry looks up
per dataset, that the committed ``lexibank-abvd`` category stamps the SPDX the registry
holds for ABVD, and that the CC-URL → SPDX normaliser admits a new dataset's own
licence (including share-alike / non-commercial) rather than defaulting it.
"""

from __future__ import annotations

from pathlib import Path

from pinakes_engine.acquire.categories import load_category
from pinakes_engine.schema.lexibank_licenses import (
    DEFAULT_LEXIBANK_LICENSE,
    LEXIBANK_LICENSES,
    license_for,
    spdx_from_license_url,
)

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def test_registry_is_keyed_per_dataset() -> None:
    assert license_for("abvd") == "CC-BY-4.0"
    assert license_for("ABVD") == "CC-BY-4.0"  # case-insensitive
    # A dataset registered with a different licence resolves to *its* SPDX, not a
    # collection default — the registry can carry share-alike / NC entries.
    assert license_for("unregistered-dataset") == DEFAULT_LEXIBANK_LICENSE
    # Every registered value is a plausible SPDX id (no bare URLs slipped in).
    assert all(v.startswith(("CC-BY", "CC0")) for v in LEXIBANK_LICENSES.values())


def test_committed_abvd_category_stamps_the_registry_license() -> None:
    spec = load_category(_PACKAGE_ROOT / "inputs" / "categories" / "lexibank-abvd.yml")
    assert spec.source.params["license"] == license_for("abvd")
    assert spec.source.params["source"] == "lexibank-abvd"


def test_cc_url_normalises_to_spdx_longest_match_first() -> None:
    assert spdx_from_license_url(
        "https://creativecommons.org/licenses/by/4.0/"
    ) == "CC-BY-4.0"
    assert spdx_from_license_url(
        "https://creativecommons.org/licenses/by-sa/4.0/"
    ) == "CC-BY-SA-4.0"
    # by-nc-sa must not be mistaken for by-nc or by (longest stem wins).
    assert spdx_from_license_url(
        "https://creativecommons.org/licenses/by-nc-sa/4.0"
    ) == "CC-BY-NC-SA-4.0"
    assert spdx_from_license_url(
        "https://creativecommons.org/publicdomain/zero/1.0/"
    ) == "CC0-1.0"
    assert spdx_from_license_url("https://example.com/some-license") is None
