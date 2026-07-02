"""The naming linker: ``NAMED_IN`` (an entity's name attested in a language).

The other linguistic edges (``DESCENDS_FROM`` / ``SPOKEN_IN`` / ``BORROWED_FROM``
/ ``COGNATE_WITH``) run *between* language and term nodes; ``NAMED_IN`` instead
records the cross-dimensional fact that an ordinary entity *has a name in a
language* (``docs/data-model.md`` — "entity's name is attested in a language").
That fact is exactly what the bulk Wikidata dump is rich in: a single entity
carries labels and aliases in dozens of languages, far more than a lightweight
SPARQL ``SELECT`` returns. The dump-backed enrichment pass
(:mod:`culturescrape.acquire.wikidata_enrich`) writes those languages onto a node
as a ``named_in_langs`` list, and this linker turns each into a ``NAMED_IN`` edge.

Given the node and edge sets the linker, for every node carrying *names_field*:

* resolves each language **code** to a **language node** — *reusing* an existing
  ``Language`` that already carries that ``language_code`` (so it merges with the
  nodes the :class:`~culturescrape.ontology.linguistic.LinguisticLinker` mints) or
  *creating* a minimal one at the same ``cs:language:lang-<code>`` id the
  linguistic linker uses — and links the entity to it with **``NAMED_IN``**.

Language-node creation needs more than the
:class:`~culturescrape.ontology.linker.Linker` contract returns (which is edges
only), so the full result — new language nodes *and* edges — is exposed through
:meth:`NamedInLinker.link_named`; :meth:`link` satisfies the pipeline interface by
returning just that result's edges. The linker is inert on a node that carries no
*names_field*, so a corpus that has not been dump-enriched is unaffected.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar

from culturescrape.ontology.linker import (
    DEFAULT_REGISTRY,
    Edge,
    Linker,
    LinkResult,
    Node,
    inferred_edge,
)
from culturescrape.ontology.registry import Dimension

#: The ``:LABEL`` token a language node carries (shared with the linguistic linker).
LANGUAGE_LABEL = "Language"

#: The node field the enrichment pass writes the attested language codes into.
NAMED_IN_FIELD = "named_in_langs"

#: Runs of non-slug characters in a language code, collapsed to ``-``.
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _scalar(row: Node | Edge, key: str) -> str:
    """Return *row*'s scalar cell for *key*, or ``""`` if missing or multi-value."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _multi(row: Node | Edge, key: str) -> list[str]:
    """Return *row*'s cell for *key* as a list (tolerating a scalar or missing)."""
    value = row.get(key)
    if isinstance(value, list):
        return [v for v in value if v]
    if isinstance(value, str) and value:
        return [value]
    return []


def _labels(node: Node) -> list[str]:
    """Return *node*'s ``:LABEL`` tokens (tolerating a scalar or missing cell)."""
    value = node.get(":LABEL")
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        return [value]
    return []


def _code_local(code: str) -> str | None:
    """Return the ``csid`` local part for a language code, or ``None`` if empty.

    Mirrors :func:`culturescrape.ontology.linguistic._code_local` so a language a
    ``NAMED_IN`` edge points at shares its ``csid`` with the same language minted
    by the linguistic linker, and the two fold into one node.
    """
    safe = _NON_SLUG_RE.sub("-", code.lower()).strip("-")
    return f"lang-{safe}" if safe else None


@dataclass(frozen=True)
class NamedInResult:
    """The naming linker's full output: new language nodes plus inferred edges.

    *nodes* are the ``Language`` nodes the linker had to create (reused languages
    are already in the input and are not repeated here); *edges* are the
    ``NAMED_IN`` edges. The edges carry ``confidence`` but not ``source`` — when
    run through the pipeline that tag is stamped from the linker name; callers
    using :meth:`NamedInLinker.link` directly get the same untagged edges.
    """

    nodes: list[Node]
    edges: list[Edge]


class NamedInLinker(Linker):
    """Infers ``NAMED_IN`` edges from a node's attested-language codes.

    Configuration:

    * *names_field* — the node cell holding the ``;``-separated language codes the
      entity has a name in (written by the dump enrichment pass);
    * *confidence* — confidence stamped on each ``NAMED_IN`` edge (an attested
      label is a strong, direct signal).
    """

    name: ClassVar[str] = "named_in"
    dimension: ClassVar[Dimension] = Dimension.LINGUISTIC

    def __init__(
        self,
        *,
        names_field: str = NAMED_IN_FIELD,
        confidence: float = 0.95,
    ) -> None:
        self.names_field = names_field
        self.confidence = confidence

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return the inferred edges only (the :class:`Linker` contract)."""
        return self.link_named(nodes, edges).edges

    def link_full(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinkResult:
        """Return the inferred edges plus the language nodes the linker created."""
        result = self.link_named(nodes, edges)
        return LinkResult(edges=result.edges, nodes=result.nodes)

    def link_named(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> NamedInResult:
        """Infer ``NAMED_IN`` edges and resolve language nodes from the dataset."""
        # Index existing languages by code so an attestation reuses a language
        # node already in the set (including any the linguistic linker minted).
        lang_by_code: dict[str, str] = {}
        for node in nodes:
            if LANGUAGE_LABEL in _labels(node) and (
                code := _scalar(node, "language_code")
            ):
                lang_by_code.setdefault(code, _scalar(node, "csid"))

        created: dict[str, Node] = {}
        emitted: set[tuple[str, str, str]] = {
            (_scalar(e, ":START_ID"), _scalar(e, ":END_ID"), _scalar(e, ":TYPE"))
            for e in edges
        }
        result_edges: list[Edge] = []

        def emit(start: str, end: str, confidence: float) -> None:
            key = (start, end, "NAMED_IN")
            if start and end and start != end and key not in emitted:
                emitted.add(key)
                result_edges.append(inferred_edge(start, end, "NAMED_IN", confidence))

        for node in nodes:
            source = _scalar(node, "csid")
            if not source:
                continue
            for code in _multi(node, self.names_field):
                language = self._reuse_or_create(code, lang_by_code, created)
                if language is not None:
                    emit(source, language, self.confidence)

        return NamedInResult(nodes=list(created.values()), edges=result_edges)

    def _reuse_or_create(
        self, code: str, lang_by_code: dict[str, str], created: dict[str, Node]
    ) -> str | None:
        """Return the language ``csid`` for *code*, creating the node if unseen.

        On a miss a minimal ``Language`` node is minted at the
        ``cs:language:lang-<code>`` id the linguistic linker also uses, so the two
        linkers' languages coincide; an empty/unsluggable code yields ``None``.
        """
        if code in lang_by_code:
            return lang_by_code[code]
        local = _code_local(code)
        if local is None:
            return None
        csid = f"cs:language:{local}"
        lang_by_code[code] = csid
        if csid not in created:
            created[csid] = {
                "csid": csid,
                ":LABEL": [LANGUAGE_LABEL],
                "name": code,
                "language_code": code,
                "source": f"inferred:{self.name}",
                "confidence": str(self.confidence),
            }
        return csid


#: Register a default-config naming linker into the process-wide registry.
DEFAULT_REGISTRY.register(NamedInLinker())
