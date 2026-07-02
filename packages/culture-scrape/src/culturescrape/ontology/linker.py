"""Pluggable link inference: the :class:`Linker` interface and the pipeline.

Tasklist 3 turns a flat set of category nodes into a dense network by *inferring*
edges across the temporal, geographic, linguistic, and genetic dimensions
(``docs/data-model.md``). Each dimension's inference is its own concern, so this
module defines the contract — a :class:`Linker` that reads the node and edge sets
and returns *new* edges — and the machinery to compose them:

* a :class:`LinkerRegistry` grouping linkers by their
  :class:`~culturescrape.ontology.registry.Dimension`;
* a :class:`Pipeline` that runs registered linkers in order, **never mutating the
  source rows**, and appends every inferred edge tagged with
  ``source='inferred:<linker>'`` and a confidence.

Linkers build their candidate edges with :func:`inferred_edge`, which validates
the ``:TYPE`` against the formal ontology and records the confidence; the
pipeline stamps the ``source`` from the linker's :attr:`Linker.name` so a linker
cannot mislabel its own output. Each subsequent linker sees the edges inferred by
the ones before it, so inferences compose.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import ClassVar

from culturescrape.ontology.registry import Dimension, validate_type
from culturescrape.schema.tsvio import Row

#: A node or edge row, in the same shape :mod:`culturescrape.schema.tsvio` reads
#: and writes (scalar cells are ``str``, multi-value cells are ``list[str]``).
Node = Row
Edge = Row


class LinkerError(ValueError):
    """Raised on a misconfigured linker, registry, or inferred edge."""


def _format_confidence(confidence: float) -> str:
    """Render *confidence* for a ``confidence:float`` cell, rejecting bad input."""
    if not 0.0 <= confidence <= 1.0:
        raise LinkerError(f"confidence must be in [0, 1], got {confidence!r}")
    return str(confidence)


def inferred_edge(
    start: str,
    end: str,
    rel_type: str,
    confidence: float,
    **extra: str | list[str],
) -> Edge:
    """Build a candidate inferred edge a linker can return.

    Validates *rel_type* against the formal ontology (an unregistered ``:TYPE``
    is rejected here, not silently written) and stores *confidence* in the
    ``confidence:float`` cell. The ``source`` cell is intentionally left unset:
    :meth:`Pipeline.run` stamps it from the emitting linker's name so the tag is
    always correct. Any *extra* cells (e.g. ``weight``) are passed through.
    """
    validate_type(rel_type)
    edge: Edge = {
        ":START_ID": start,
        ":END_ID": end,
        ":TYPE": rel_type,
        "confidence": _format_confidence(confidence),
    }
    edge.update(extra)
    return edge


@dataclass(frozen=True)
class LinkResult:
    """A linker's full output: nodes to merge by ``csid`` plus inferred edges.

    *nodes* are node rows the linker wants folded into the dataset *by ``csid``*:
    a row whose ``csid`` is new is **added** (e.g. a place a geographic linker
    minted), while a row whose ``csid`` already exists **replaces** it (e.g. the
    genetic linker's denormalized entity copy). *edges* are the inferred edges,
    carrying ``confidence`` but not ``source`` — the orchestration stamps that
    from the linker name, exactly as :meth:`Pipeline.run` does.
    """

    edges: list[Edge]
    nodes: list[Node] = field(default_factory=list)


class Linker(ABC):
    """One dimension's edge-inference rule.

    A concrete linker sets :attr:`name` (the stable token written into
    ``source='inferred:<name>'``) and :attr:`dimension`, and implements
    :meth:`link` to return the new edges it infers from the node and edge sets.
    A linker must treat its inputs as read-only — the pipeline relies on it not
    mutating the source rows — and should build its results with
    :func:`inferred_edge`.
    """

    #: Stable identifier, used in ``source='inferred:<name>'``.
    name: ClassVar[str]
    #: The cross-dimensional axis this linker infers on.
    dimension: ClassVar[Dimension]

    @abstractmethod
    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return new edges inferred from *nodes* and *edges* (no mutation)."""
        raise NotImplementedError

    def link_full(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinkResult:
        """Return the inferred edges *and* any nodes the linker creates or updates.

        The :class:`Pipeline` only threads edges, but a linker that mints place /
        period / language nodes (or rewrites an entity) needs those rows written
        too. The default returns just :meth:`link`'s edges and no nodes; a linker
        that produces nodes overrides this to surface them for
        :func:`~culturescrape.ontology.run.run_linkers`.
        """
        return LinkResult(edges=self.link(nodes, edges))


class LinkerRegistry:
    """A registry of :class:`Linker` instances, queryable by dimension.

    Registration order is preserved so :meth:`all` and :meth:`by_dimension`
    return linkers in a deterministic, caller-controlled order — the order the
    :class:`Pipeline` runs them in.
    """

    def __init__(self) -> None:
        self._by_name: dict[str, Linker] = {}

    def register(self, linker: Linker) -> Linker:
        """Register *linker*, returning it; reject a duplicate :attr:`name`."""
        if linker.name in self._by_name:
            raise LinkerError(f"linker {linker.name!r} already registered")
        self._by_name[linker.name] = linker
        return linker

    def get(self, name: str) -> Linker:
        """Return the registered linker called *name*."""
        try:
            return self._by_name[name]
        except KeyError:
            raise LinkerError(f"unknown linker {name!r}") from None

    def all(self) -> tuple[Linker, ...]:
        """Every registered linker, in registration order."""
        return tuple(self._by_name.values())

    def by_dimension(self, dimension: Dimension) -> tuple[Linker, ...]:
        """Registered linkers on *dimension*, in registration order."""
        return tuple(
            linker
            for linker in self._by_name.values()
            if linker.dimension is dimension
        )


#: The process-wide registry concrete linkers (US-003+) register into.
DEFAULT_REGISTRY = LinkerRegistry()


class Pipeline:
    """Runs a sequence of linkers in order, appending their inferred edges.

    :meth:`run` returns a fresh edge list — the original edges followed by every
    inferred edge — and never mutates the rows it is given: source edges are
    copied into the result list and each inferred edge is a new dict. Linkers run
    in sequence and each sees the edges inferred by the ones before it, so
    inferences compose.
    """

    def __init__(self, linkers: Sequence[Linker]) -> None:
        self._linkers = tuple(linkers)

    @classmethod
    def from_registry(
        cls,
        registry: LinkerRegistry = DEFAULT_REGISTRY,
        dimensions: Iterable[Dimension] | None = None,
    ) -> Pipeline:
        """Build a pipeline from *registry*.

        With *dimensions* given, only linkers on those dimensions run, ordered by
        the dimension sequence (then registration order within a dimension);
        otherwise every registered linker runs in registration order.
        """
        if dimensions is None:
            return cls(registry.all())
        linkers: list[Linker] = []
        for dimension in dimensions:
            linkers.extend(registry.by_dimension(dimension))
        return cls(linkers)

    @property
    def linkers(self) -> tuple[Linker, ...]:
        """The linkers this pipeline runs, in order."""
        return self._linkers

    def run(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return *edges* plus every inferred edge, leaving the inputs untouched."""
        result: list[Edge] = list(edges)
        for linker in self._linkers:
            for edge in linker.link(nodes, tuple(result)):
                result.append(tag_inferred_edge(edge, linker.name))
        return result


def tag_inferred_edge(edge: Edge, linker_name: str) -> Edge:
    """Return a copy of *edge* stamped ``source='inferred:<linker_name>'``.

    Validates the ``:TYPE`` against the ontology and requires a ``confidence``
    cell, so a linker cannot smuggle an unregistered or unscored edge through.
    Shared by :meth:`Pipeline.run` and
    :func:`~culturescrape.ontology.run.run_linkers` so both stamp identically.
    """
    tagged: Edge = dict(edge)
    validate_type(_require_type(tagged))
    if "confidence" not in tagged:
        raise LinkerError(
            f"linker {linker_name!r} emitted an edge without a confidence"
        )
    tagged["source"] = f"inferred:{linker_name}"
    return tagged


def _require_type(edge: Edge) -> str:
    """Return *edge*'s ``:TYPE`` as a scalar, rejecting a missing or list value."""
    value = edge.get(":TYPE")
    if not isinstance(value, str) or not value:
        raise LinkerError(f"inferred edge is missing a :TYPE: {edge!r}")
    return value
