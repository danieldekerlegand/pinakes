"""Keep ``docs/ontology.md`` honest against the formal vocabulary and the tests.

The ontology documentation makes two promises the acceptance criteria require:
every registered ``:TYPE`` is documented, and every inference rule references the
test that exercises it. Both rot silently — a new relation type, a renamed test —
so this suite enforces them:

* every name in :data:`~culturescrape.ontology.registry.REGISTRY` appears in the
  doc, and the doc names no type the registry does not (the registry is the single
  source of truth);
* every ``test_file.py::test_func`` reference in the doc resolves to a test that
  actually exists, so a documented rule always points at a live test.
"""

from __future__ import annotations

import re
from pathlib import Path

from culturescrape.ontology.registry import REGISTRY

#: The ontology doc and the test directory, relative to this file.
_ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY_DOC = _ROOT / "docs" / "ontology.md"
TESTS_DIR = _ROOT / "tests"

#: A ``test_file.py::test_func`` reference as written in the doc tables.
_TEST_REF_RE = re.compile(r"(test_[\w]+\.py)::(test_[\w]+)")

#: A backtick-wrapped ``UPPER_SNAKE`` token — how ``:TYPE`` names are written.
_TYPE_TOKEN_RE = re.compile(r"`([A-Z][A-Z_]+)`")


def _doc_text() -> str:
    return ONTOLOGY_DOC.read_text(encoding="utf-8")


def test_every_registered_type_is_documented() -> None:
    """Each ``:TYPE`` in the registry appears as a token in the doc."""
    tokens = set(_TYPE_TOKEN_RE.findall(_doc_text()))
    missing = sorted(name for name in REGISTRY if name not in tokens)
    assert not missing, f"undocumented relationship types: {missing}"


def test_doc_names_no_unregistered_type() -> None:
    """Every relationship-shaped token in the doc is a registered ``:TYPE``.

    Guards against documenting a type that was renamed or never existed. Tokens
    that are column types (``:LABEL``) or known prose words are not relation
    names, so they are excluded.
    """
    known_non_types = {"TYPE", "LABEL", "START_ID", "END_ID", "ID", "BCE", "AAT"}
    tokens = set(_TYPE_TOKEN_RE.findall(_doc_text()))
    unknown = sorted(
        tok for tok in tokens if tok not in REGISTRY and tok not in known_non_types
    )
    assert not unknown, f"doc names unregistered types: {unknown}"


def test_every_referenced_rule_test_exists() -> None:
    """Each ``file.py::test_func`` reference resolves to a defined test."""
    references = _TEST_REF_RE.findall(_doc_text())
    assert references, "no rule tests are referenced in the ontology doc"
    missing: list[str] = []
    for filename, func in references:
        path = TESTS_DIR / filename
        if not path.exists() or f"def {func}(" not in path.read_text(encoding="utf-8"):
            missing.append(f"{filename}::{func}")
    assert not missing, f"referenced rule tests do not exist: {missing}"


def test_diagram_is_present() -> None:
    """The doc includes the dimension-interconnection diagram."""
    assert "```mermaid" in _doc_text(), "ontology doc is missing the mermaid diagram"
