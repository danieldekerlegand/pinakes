"""Execute the runnable examples in ``docs/schema.md`` as doctests.

The schema documentation makes claims about canonical columns, type suffixes,
escaping, and the resolution precedence. Running its ``>>>`` examples here keeps
the doc honest: a code example that drifts from the implementation fails the
suite rather than silently misleading a reader.
"""

from __future__ import annotations

import doctest
from pathlib import Path

#: The documented normalization layer, relative to this test file.
SCHEMA_DOC = Path(__file__).resolve().parent.parent / "docs" / "schema.md"


def test_schema_doc_examples_run() -> None:
    """Every ``>>>`` example in ``docs/schema.md`` produces its stated output."""
    results = doctest.testfile(
        str(SCHEMA_DOC),
        module_relative=False,
        optionflags=doctest.ELLIPSIS,
        verbose=False,
    )
    assert results.failed == 0, f"{results.failed} doctest example(s) failed"
    assert results.attempted > 0, "no doctest examples were found in the doc"
