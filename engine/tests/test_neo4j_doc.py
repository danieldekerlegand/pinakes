"""Execute the runnable examples in ``docs/neo4j.md`` as doctests.

The Neo4j operator guide makes claims about the generated import command, the
constraint statements, and the example-query linter. Running its ``>>>`` examples
here keeps the doc honest: a snippet that drifts from the implementation fails the
suite rather than silently misleading an operator.
"""

from __future__ import annotations

import doctest
from pathlib import Path

#: The Neo4j round-trip guide, relative to this test file.
NEO4J_DOC = Path(__file__).resolve().parent.parent / "docs" / "neo4j.md"


def test_neo4j_doc_examples_run() -> None:
    """Every ``>>>`` example in ``docs/neo4j.md`` produces its stated output."""
    results = doctest.testfile(
        str(NEO4J_DOC),
        module_relative=False,
        optionflags=doctest.ELLIPSIS,
        verbose=False,
    )
    assert results.failed == 0, f"{results.failed} doctest example(s) failed"
    assert results.attempted > 0, "no doctest examples were found in the doc"
