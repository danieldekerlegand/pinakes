"""Entity ref → shared-graph ``csid``, at query time.

Ported off `server/services/graph-resolver.ts`. The federated search
(:mod:`pinakes.search.global_search`) is the caller that made this a dependency
of pinakes:63 US-2: an entity present in both stores has to be recognised as
*one* entity, and the only thing the two halves agree on is the csid.

Two passes, in order:

1. **Alias.** The `cs:<node-type>:<pinakes-id>` id `scripts/export-for-engine`
   mints for every node *is* the alias between a lexicon row and its graph node;
   a row may also carry an explicit `csid`/`alias` column written back during
   convergence, and that wins.
2. **Fuzzy.** With no id — or an id no exported node claims — a normalized-name
   Sørensen–Dice match within the same node type, optionally narrowed by region.

**Ambiguity is never silently mis-linked.** Two *distinct* csids tying for best
(or one `(type, id)` mapping to two) logs the candidates and resolves to
``None``. A wrong link here would merge two entities in a search result.

Two things carry over that look like accidents and are not:

* **The entity types global search passes are the app's, not the schema's.**
  `entityType: "civilization"` never matches the canonical node type `culture`,
  and `archaeological-site` never matches `place`, so those domains simply do
  not dedup. That is the Express behaviour, and narrowing it here would make the
  two backends disagree about which results are duplicates mid-cutover.
* **The lexicon read is its own, not** :mod:`pinakes.lexicons.storage`'s. It
  reads *every* node file through the contract's column mapping — including the
  eleven no loader here covers — so it cannot be expressed in terms of the typed
  loaders without either widening them or losing rows.
"""

from __future__ import annotations

import logging
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from pinakes_contracts.canonical_schema import node_type_by_name
from pinakes_contracts.lexicon_mapping import document as lexicon_mapping_document

from pinakes.analytics.jsmath import round_to

logger = logging.getLogger("pinakes.graph_resolver")

#: Default minimum name similarity (Dice coefficient) for a fuzzy match.
DEFAULT_FUZZY_THRESHOLD = 0.6


@dataclass(frozen=True)
class EntityRef:
    """A pinakes entity reference to resolve into a shared-graph csid."""

    type: str
    id: str | None = None
    name: str | None = None
    region: str | None = None


@dataclass(frozen=True)
class ResolvedCsid:
    """A resolved shared-graph id with the confidence and method behind it."""

    csid: str
    #: ``1.0`` for an exact alias hit; the similarity score for a fuzzy match.
    confidence: float
    #: ``"alias"`` or ``"fuzzy"``.
    method: str


@dataclass(frozen=True)
class AliasEntry:
    """One csid ↔ pinakes-entity alias, the unit the resolver indexes."""

    csid: str
    pinakes_id: str
    node_type: str
    name: str
    region: str = ""


class Resolver(Protocol):
    """What :func:`pinakes.search.global_search.merge_graph_results` needs."""

    def resolve(self, ref: EntityRef) -> ResolvedCsid | None: ...


def mint_csid(node_type: str, pinakes_id: str) -> str:
    """The deterministic canonical id (mirrors `scripts/export-for-engine`)."""
    return f"cs:{node_type}:{pinakes_id}"


def normalize_name(value: str) -> str:
    """NFKC, whitespace-collapsed, lowercased.

    Mirrors the reconciliation's ``normalizeKey`` so app-side resolution blocks
    the same way the engine's reconciler does. ``lower()`` rather than
    ``casefold()`` deliberately: the TypeScript is ``toLowerCase``, and the two
    disagree on ``ß``.
    """
    return " ".join(unicodedata.normalize("NFKC", value).split()).lower()


def _bigrams(value: str) -> dict[str, int]:
    """Character-bigram multiset of an already-normalized string."""
    counts: dict[str, int] = {}
    for index in range(len(value) - 1):
        gram = value[index : index + 2]
        counts[gram] = counts.get(gram, 0) + 1
    return counts


def name_similarity(left: str, right: str) -> float:
    """Sørensen–Dice similarity of two normalized strings, in ``[0, 1]``.

    Equal strings score ``1`` (an empty pair scores ``0``); anything shorter than
    two characters has no bigram and compares by equality alone.
    """
    if left == right:
        return 0.0 if left == "" else 1.0
    if len(left) < 2 or len(right) < 2:
        return 0.0
    first = _bigrams(left)
    second = _bigrams(right)
    intersection = sum(
        min(count, second[gram]) for gram, count in first.items() if gram in second
    )
    total = (len(left) - 1) + (len(right) - 1)
    return (2 * intersection) / total


def _round3(value: float) -> float:
    """Three decimal places, so scores are stable and comparable.

    ``Math.round(x * 1000) / 1000`` — half-up, which is not Python's
    round-half-to-even, so :func:`pinakes.analytics.jsmath.round_to` is the rule
    rather than the builtin.
    """
    return round_to(value, 3)


@dataclass
class _Indexed:
    entry: AliasEntry
    norm_name: str
    norm_region: str


@dataclass
class GraphResolver:
    """An in-memory resolver over a set of alias entries.

    Entries colliding on `csid` are merged (the first wins for reverse lookup);
    a `(type, id)` pair mapping to two *distinct* csids is ambiguous and never
    auto-resolved.
    """

    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD
    _by_csid: dict[str, _Indexed] = field(default_factory=dict)
    _by_type_id: dict[tuple[str, str], set[str]] = field(default_factory=dict)
    _by_type: dict[str, list[_Indexed]] = field(default_factory=dict)

    @property
    def size(self) -> int:
        """Number of indexed alias entries (distinct csids)."""
        return len(self._by_csid)

    def add(self, entry: AliasEntry) -> None:
        """Index one alias entry. A blank csid is skipped, as it was there."""
        if entry.csid == "":
            return
        indexed = _Indexed(
            entry=entry,
            norm_name=normalize_name(entry.name),
            norm_region=normalize_name(entry.region),
        )
        self._by_csid.setdefault(indexed.entry.csid, indexed)

        if indexed.entry.pinakes_id != "":
            key = (indexed.entry.node_type, indexed.entry.pinakes_id)
            self._by_type_id.setdefault(key, set()).add(indexed.entry.csid)

        # A csid can recur across rows (duplicate ids collapse to one node).
        pool = self._by_type.setdefault(indexed.entry.node_type, [])
        if not any(other.entry.csid == indexed.entry.csid for other in pool):
            pool.append(indexed)

    def resolve(self, ref: EntityRef) -> ResolvedCsid | None:
        """Resolve a ref to a csid, or ``None`` when unresolved/ambiguous."""
        return self._resolve_by_alias(ref) or self._resolve_by_fuzzy(ref)

    def reverse(self, csid: str) -> EntityRef | None:
        """Reverse lookup: a known csid back to its pinakes entity ref."""
        indexed = self._by_csid.get(csid)
        if indexed is None:
            return None
        return EntityRef(
            type=indexed.entry.node_type,
            id=indexed.entry.pinakes_id,
            name=indexed.entry.name,
            region=indexed.entry.region,
        )

    # ── The two passes ───────────────────────────────────────────────────────

    def _resolve_by_alias(self, ref: EntityRef) -> ResolvedCsid | None:
        if not ref.id:
            return None
        csids = self._by_type_id.get((ref.type, ref.id))
        if not csids:
            # No indexed row for this id: fall back to the deterministic mint if
            # the node exists in the index, else defer to the fuzzy pass.
            minted = mint_csid(ref.type, ref.id)
            if minted in self._by_csid:
                return ResolvedCsid(csid=minted, confidence=1.0, method="alias")
            return None
        if len(csids) > 1:
            self._ambiguous(
                ref, "alias", [(csid, 1.0) for csid in sorted(csids)]
            )
            return None
        return ResolvedCsid(csid=next(iter(csids)), confidence=1.0, method="alias")

    def _resolve_by_fuzzy(self, ref: EntityRef) -> ResolvedCsid | None:
        if ref.name is None or ref.name.strip() == "":
            return None
        query = normalize_name(ref.name)
        if query == "":
            return None

        pool = (
            self._by_type.get(ref.type, [])
            if ref.type
            else list(self._by_csid.values())
        )
        if not pool:
            return None

        want_region = normalize_name(ref.region) if ref.region else ""
        regional = (
            [item for item in pool if item.norm_region == want_region]
            if want_region
            else []
        )
        candidates = regional or pool

        best: tuple[str, float] | None = None
        runner_up: tuple[str, float] | None = None
        for item in candidates:
            score = name_similarity(query, item.norm_name)
            if score < self.fuzzy_threshold:
                continue
            if best is None or score > best[1]:
                runner_up = best
                best = (item.entry.csid, score)
            elif (
                runner_up is None or score > runner_up[1]
            ) and item.entry.csid != best[0]:
                runner_up = (item.entry.csid, score)

        if best is None:
            return None

        # A distinct csid tying the best score is ambiguous — never linked.
        if (
            runner_up is not None
            and runner_up[0] != best[0]
            and abs(runner_up[1] - best[1]) < 1e-9
        ):
            self._ambiguous(
                ref,
                "fuzzy",
                sorted(
                    ((csid, _round3(score)) for csid, score in (best, runner_up)),
                    key=lambda candidate: candidate[0],
                ),
            )
            return None

        return ResolvedCsid(
            csid=best[0], confidence=_round3(best[1]), method="fuzzy"
        )

    def _ambiguous(
        self,
        ref: EntityRef,
        method: str,
        candidates: Sequence[tuple[str, float]],
    ) -> None:
        listed = ", ".join(f"{csid}@{score:.3f}" for csid, score in candidates)
        logger.warning(
            "ambiguous %s match for %s:%s — not linked; candidates: %s",
            method,
            ref.type,
            ref.id or ref.name or "?",
            listed,
        )


def create_graph_resolver(
    entries: Iterable[AliasEntry],
    *,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> GraphResolver:
    """Build a resolver over the given alias entries."""
    resolver = GraphResolver(fuzzy_threshold=fuzzy_threshold)
    for entry in entries:
        resolver.add(entry)
    return resolver


# ── Lexicon-backed loading ───────────────────────────────────────────────────


def _read_tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    """``{headers, rows}``; a missing file yields empties.

    Not :func:`pinakes.analytics.tsv.parse_tsv`: this reader **trims the
    headers** (the mapping's column names are matched against them) and drops
    whitespace-only lines rather than empty ones. Both are the TypeScript's, and
    the difference is only visible on a corpus with padded headers.
    """
    if not path.is_file():
        return [], []
    lines = [
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() != ""
    ]
    if not lines:
        return [], []
    return [column.strip() for column in lines[0].split("\t")], [
        line.split("\t") for line in lines[1:]
    ]


def _target_column_index(
    file_mapping: Mapping[str, Any] | None, headers: list[str], target: str
) -> int:
    """Position of the header the contract maps to canonical *target*, else -1."""
    if file_mapping is None:
        return -1
    for column in file_mapping.get("columns", []):
        if column.get("target") == target:
            name = column.get("column")
            return headers.index(name) if name in headers else -1
    return -1


def _csid_column_index(headers: list[str]) -> int:
    """First header exactly `csid` or `alias` (a convergence write-back)."""
    for index, header in enumerate(headers):
        if header.lower() in {"csid", "alias"}:
            return index
    return -1


def _region_column_index(headers: list[str]) -> int:
    """First header ending in `region` (region/origin_region/proposed_region)."""
    for index, header in enumerate(headers):
        lowered = header.lower()
        if lowered == "region" or lowered.endswith("_region"):
            return index
    return -1


def _cell(row: list[str], index: int) -> str:
    """A trimmed cell; an out-of-range index is blank."""
    if index < 0 or index >= len(row):
        return ""
    return row[index].strip()


def load_alias_entries(lexicons: Path) -> list[AliasEntry]:
    """One alias entry per canonical node row in the corpus.

    Keyed by the row's explicit `csid`/`alias` column when it has one, else by
    the deterministic minted csid. Pure over a lexicons directory.
    """
    entries: list[AliasEntry] = []
    files: list[Mapping[str, Any]] = lexicon_mapping_document()["files"]
    for file_mapping in files:
        if file_mapping.get("kind") != "node":
            continue
        node = file_mapping.get("node")
        if node is None or node_type_by_name(node) is None:
            continue

        headers, rows = _read_tsv(Path(lexicons) / file_mapping["file"])
        if not headers:
            continue

        id_index = _target_column_index(file_mapping, headers, "pinakes_id")
        name_index = _target_column_index(file_mapping, headers, "name")
        region_index = _region_column_index(headers)
        csid_index = _csid_column_index(headers)

        for row in rows:
            pinakes_id = _cell(row, id_index)
            if pinakes_id == "":
                continue
            explicit = _cell(row, csid_index)
            entries.append(
                AliasEntry(
                    csid=explicit if explicit != "" else mint_csid(node, pinakes_id),
                    pinakes_id=pinakes_id,
                    node_type=node,
                    name=_cell(row, name_index),
                    region=_cell(row, region_index),
                )
            )
    return entries


#: The memoised resolver and the directory it indexes. Keyed on the *path*, not
#: a bare singleton like the TypeScript's: `paths.lexicons_dir()` re-reads its
#: environment override on every call precisely so a test can point one request
#: at a temp corpus, and an index cached without that check would be an index of
#: whatever directory the first caller happened to ask for. Same rule as
#: `analytics.index.get_analytical_index`.
_CACHED: tuple[Path, GraphResolver] | None = None


def graph_resolver(lexicons: Path) -> GraphResolver:
    """A resolver over the corpus at *lexicons*, memoised on that directory.

    Building one reads every node file in the corpus (~24 of them), and the
    federated search wants one per request — so unlike the loaders in
    :mod:`pinakes.lexicons.storage` this *is* cached, on the resolved path.
    """
    global _CACHED
    resolved = Path(lexicons).resolve()
    if _CACHED is not None and _CACHED[0] == resolved:
        return _CACHED[1]
    built = create_graph_resolver(load_alias_entries(resolved))
    _CACHED = (resolved, built)
    return built


def reset_graph_resolver() -> None:
    """Drop the memoised resolver (after a corpus write, or between tests)."""
    global _CACHED
    _CACHED = None


__all__ = [
    "DEFAULT_FUZZY_THRESHOLD",
    "AliasEntry",
    "EntityRef",
    "GraphResolver",
    "ResolvedCsid",
    "Resolver",
    "create_graph_resolver",
    "graph_resolver",
    "load_alias_entries",
    "mint_csid",
    "name_similarity",
    "normalize_name",
    "reset_graph_resolver",
]
