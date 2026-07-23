"""Smoke tests asserting the package skeleton imports and is well-formed."""

import culturescrape
from culturescrape import acquire


def test_version_exposed() -> None:
    assert culturescrape.__version__ == "0.1.0"


def test_acquire_subpackage_importable() -> None:
    assert acquire.__doc__ is not None
