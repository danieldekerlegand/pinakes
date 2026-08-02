"""Execute the runnable examples in ``docs/datalog.md`` as doctests.

The Datalog export guide makes claims about the predicate schema and, crucially,
about how atoms and facts are quoted and escaped for each dialect. Running its
``>>>`` examples here keeps the doc honest: an example that drifts from the
implementation fails the suite rather than silently misleading a reader.
"""

from __future__ import annotations

import doctest
from pathlib import Path

#: The documented Datalog export layer, relative to this test file.
DATALOG_DOC = Path(__file__).resolve().parent.parent / "docs" / "datalog.md"


def test_datalog_doc_examples_run() -> None:
    """Every ``>>>`` example in ``docs/datalog.md`` produces its stated output."""
    results = doctest.testfile(
        str(DATALOG_DOC),
        module_relative=False,
        optionflags=doctest.ELLIPSIS,
        verbose=False,
    )
    assert results.failed == 0, f"{results.failed} doctest example(s) failed"
    assert results.attempted > 0, "no doctest examples were found in the doc"
