"""Cross-store link resolution for the explorer (T7-US-009).

The canonical TSV, the Neo4j export, and the Datalog program are three views of
one dataset, joined by the ``csid``. This module maps a csid to a locator in each
representation so a node detail can deep-link the same entity across all three —
making the stores feel like one dataset. It is a pure mapping (no I/O): the route
validates that the csid names a real node before handing it here.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

from culturescrape.neo4j.constraints import ENTITY_LABEL


@dataclass(frozen=True)
class EntityLinks:
    """Where one entity — identified by its shared *csid* — lives in each store.

    *tsv*, *graph*, *neo4j*, and *datalog* are explorer URLs that focus the
    entity in each view. *neo4j_cypher* is the Cypher that locates the node by
    csid, *datalog_atom* the ``node/3`` atom that names it, and *datalog_goal*
    the runnable ``main/0`` query the Datalog console is pre-filled with.
    """

    csid: str
    tsv: str
    graph: str
    neo4j: str
    neo4j_cypher: str
    datalog: str
    datalog_atom: str
    datalog_goal: str


def neo4j_locator(csid: str) -> str:
    """The Cypher that selects the entity node by its shared ``csid`` key."""
    return f"MATCH (n:{ENTITY_LABEL} {{csid: '{csid}'}}) RETURN n"


def datalog_atom(csid: str) -> str:
    """The ``node/3`` atom naming the entity in the projected program."""
    return f"node('{csid}', Type, Name)"


def datalog_goal(csid: str) -> str:
    """A runnable ``main/0`` goal printing the entity's ``node/3`` atom."""
    return (
        f"% node {csid}\n"
        f"main :- forall({datalog_atom(csid)}, format('~w\\t~w~n', [Type, Name]))."
    )


def resolve_links(csid: str) -> EntityLinks:
    """Map *csid* to its locator in the TSV, Neo4j, and Datalog views."""
    goal = datalog_goal(csid)
    # The csid rides the /nodes/{csid:path} route raw (matching every other
    # detail link); only the query-string locators are percent-encoded.
    encoded = quote(csid, safe="")
    return EntityLinks(
        csid=csid,
        tsv=f"/nodes/{csid}",
        graph=f"/graph?csid={encoded}",
        neo4j=f"/neo4j?csid={encoded}",
        neo4j_cypher=neo4j_locator(csid),
        datalog=f"/datalog?goal={quote(goal, safe='')}",
        datalog_atom=datalog_atom(csid),
        datalog_goal=goal,
    )


__all__ = [
    "EntityLinks",
    "datalog_atom",
    "datalog_goal",
    "neo4j_locator",
    "resolve_links",
]
