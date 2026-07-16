"""A committed, deterministic manifest of a built corpus's type counts.

A corpus dataset (``nodes/*.tsv`` + ``edges/*.tsv``) is regenerable and stays
gitignored (``docs/storage.md``), so the repo cannot diff the corpus itself to
catch a build that silently gains or drops rows. The manifest is the small,
committed fingerprint that closes that gap: it records how many nodes each
``:LABEL`` and how many edges each ``:TYPE`` the build produced, plus the
Pinakes-origin edge breakdown (US-004), so a review sees the shape of the
merged corpus change even though the corpus is not committed.

It is deliberately **content-only** — node/edge *type counts*, no wall-clock, no
paths — so the same corpus always serialises to the same bytes and a fresh build
can be asserted byte-for-byte against the committed snapshot in CI (the same
snapshot-and-assert pattern the TS export manifest uses).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from culturescrape.ontology.linker import Edge, Node
from culturescrape.ontology.metrics import (
    edges_by_type_for_source,
    nodes_by_label,
)
from culturescrape.ontology.metrics import (
    read_dataset as _read_dataset,
)

#: Provenance ``source`` id Pinakes-origin rows carry.
PINAKES_SOURCE = "pinakes"


@dataclass(frozen=True)
class CorpusManifest:
    """Deterministic type-count fingerprint of a built corpus.

    Attributes:
        job: The job the corpus was built from.
        node_count: Total node rows.
        edge_count: Total edge rows.
        nodes_by_label: Node counts keyed by primary ``:LABEL``, sorted by label.
        edges_by_type: Edge counts keyed by ``:TYPE``, sorted by type.
        pinakes_edges_by_type: Edge counts for the ``pinakes``-origin
            subset, keyed by ``:TYPE`` — how many edges of each type Pinakes
            contributed to the merged corpus.
    """

    job: str
    node_count: int
    edge_count: int
    nodes_by_label: dict[str, int]
    edges_by_type: dict[str, int]
    pinakes_edges_by_type: dict[str, int]

    def to_dict(self) -> dict[str, object]:
        """Render the manifest as a plain, JSON-ready dict (stable key order)."""
        return {
            "job": self.job,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "nodes_by_label": dict(self.nodes_by_label),
            "edges_by_type": dict(self.edges_by_type),
            "pinakes_edges_by_type": dict(self.pinakes_edges_by_type),
        }

    def to_json(self) -> str:
        """Render the manifest as pretty JSON (no trailing newline)."""
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)

    def write(self, path: str | Path) -> None:
        """Write the manifest JSON to *path* (with a trailing newline)."""
        Path(path).write_text(self.to_json() + "\n", encoding="utf-8")


def build_manifest(
    job: str, nodes: Sequence[Node], edges: Sequence[Edge]
) -> CorpusManifest:
    """Fingerprint the *nodes* / *edges* of the corpus built for *job*."""
    return CorpusManifest(
        job=job,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes_by_label=nodes_by_label(nodes),
        edges_by_type=edges_by_type(edges),
        pinakes_edges_by_type=edges_by_type_for_source(edges, PINAKES_SOURCE),
    )


def manifest_for_dataset(job: str, directory: str | Path) -> CorpusManifest:
    """Read the corpus under *directory* and fingerprint it for *job*."""
    nodes, edges = _read_dataset(directory)
    return build_manifest(job, nodes, edges)


def edges_by_type(edges: Sequence[Edge]) -> dict[str, int]:
    """Count *edges* by ``:TYPE``, sorted by type (all sources)."""
    counts: dict[str, int] = {}
    for edge in edges:
        value = edge.get(":TYPE")
        key = value.strip() if isinstance(value, str) else ""
        if key:
            counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))
