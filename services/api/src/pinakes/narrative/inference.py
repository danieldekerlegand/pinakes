"""Datalog augmentation for the connection narrative.

The port of `liveInferFacts` in `server/routes/connection-narrative.ts`, with
one substitution that is the whole point of pinakes:50: it asks
:mod:`pinakes.engine.datalog` **in process** where the Express route posted to
the sidecar's `/datalog` console over HTTP. Same goal, same both-directions
probe, same answer.

Best-effort by contract. It depends on the Datalog layer *and* on the ruleset
having something to say, so every failure — no console, no SWI-Prolog, a lint
error, a malformed goal — degrades to no facts. The graph path is the primary
evidence; inference only ever adds to it.
"""

from __future__ import annotations

from pinakes.engine import datalog
from pinakes.narrative.connection import DatalogFact

#: The relation probed between the two endpoints.
ANCESTOR_RELATION = "ancestor"


def _escape(value: str) -> str:
    """``s.replace(/['\\\\]/g, "\\\\$&")`` — quote and backslash, for a Prolog atom."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _holds(subject: str, ancestor: str) -> bool:
    """Whether ``ancestor(subject, ancestor)`` is derivable. Never raises."""
    goal = (
        f"main :- {ANCESTOR_RELATION}('{_escape(subject)}', "
        f"'{_escape(ancestor)}'), format(\"~w~n\", ['yes'])."
    )
    try:
        outcome = datalog.run(goal=goal)
    except Exception:  # noqa: BLE001 - inference is best-effort, see the header
        return False
    rows = outcome.get("rows")
    return bool(outcome.get("ran")) and isinstance(rows, list) and len(rows) > 0


def infer_facts(from_csid: str, to_csid: str) -> list[DatalogFact]:
    """Any inferred ancestry between the two endpoints, in either direction.

    Only the **first** direction that holds is reported: the two are mutually
    exclusive in a well-formed descent closure, and reporting both would state a
    cycle as though it were evidence.
    """
    if _holds(from_csid, to_csid):
        return [
            DatalogFact(
                relation=ANCESTOR_RELATION,
                statement=(
                    f"{to_csid} is an ancestor of {from_csid} "
                    "(inferred via descent closure)."
                ),
                csids=[from_csid, to_csid],
            )
        ]
    if _holds(to_csid, from_csid):
        return [
            DatalogFact(
                relation=ANCESTOR_RELATION,
                statement=(
                    f"{from_csid} is an ancestor of {to_csid} "
                    "(inferred via descent closure)."
                ),
                csids=[to_csid, from_csid],
            )
        ]
    return []


__all__ = ["ANCESTOR_RELATION", "infer_facts"]
