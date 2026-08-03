"""Anchor the suite's working directory to the engine root.

A handful of committed category specs (``inputs/categories/*.yml``) name their
fixture dumps with **engine-relative** paths (``tests/fixtures/kaikki/…``), which
resolve against the process cwd — see the cwd note in ``engine/CLAUDE.md``. That
is fine for the CLI, which is documented as being run from this directory, but it
made the suite silently cwd-dependent: ``pytest`` from ``engine/`` passed while
``uv run --project engine pytest`` from the repo root failed six tests on
``FileNotFoundError``.

Chdir once per session so both invocations mean the same thing. Tests that need a
different cwd still chdir themselves (``monkeypatch.chdir(tmp_path)``); this only
fixes the starting point.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

#: ``engine/`` — one level up from ``engine/tests/``.
ENGINE_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def _cwd_is_the_engine_root() -> Iterator[None]:
    previous = Path.cwd()
    os.chdir(ENGINE_ROOT)
    try:
        yield
    finally:
        os.chdir(previous)
