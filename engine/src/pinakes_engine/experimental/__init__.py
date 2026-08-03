"""Experimental prototypes — NOT part of the production acquisition/export path.

Code in this package backs *evaluations* (should we adopt source X?), not the live
pipeline. It is imported only by its own tests and its evaluation docs, never by
``pinakes_engine.acquire`` / ``pinakes_engine.datalog`` / the CLI's production commands.
Anything here may change or be deleted once the evaluation it supports is decided.

Current contents:

* :mod:`pinakes_engine.experimental.yago` — the YAGO 4.5 facts+SHACL evaluation
  (rules-layer US-005). See ``docs/yago-evaluation.md``.
"""

from __future__ import annotations

__all__: list[str] = []
