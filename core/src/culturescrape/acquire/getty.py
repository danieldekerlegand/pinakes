"""Getty vocabulary N-Triples dump adapter.

The Getty `AAT/TGN/ULAN <https://www.getty.edu/research/tools/vocabularies/>`_
vocabularies have **no live SPARQL endpoint we may hammer**; they are published
as monthly N-Triples dumps under the `ODC-By <https://opendatacommons.org/licenses/by/>`_
licence. This adapter reads such a dump *from local disk* and emits one
:class:`~culturescrape.acquire.records.RawRecord` per vocabulary subject — an
AAT concept, a TGN place, or a ULAN agent — carrying its id, preferred label,
and type. These anchor entity normalization downstream (Tasklist 2).

A Getty dump interleaves many triples per subject (labels, scope notes, parent
links). The adapter groups triples by subject, keeps only subjects in a known
Getty namespace that carry a ``skos:prefLabel``, and stamps each record with
provenance naming the vocabulary (``getty_aat``/``getty_tgn``/``getty_ulan``),
the subject URI, and the ODC-By licence string so attribution travels with the
data.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.confidence import confidence_for

#: The ODC-By licence Getty publishes its vocabularies under.
GETTY_LICENSE = "ODC-By 1.0"

#: Getty vocabulary URI namespaces mapped to their provenance ``source`` id.
GETTY_NAMESPACES: dict[str, str] = {
    "http://vocab.getty.edu/aat/": "getty_aat",
    "http://vocab.getty.edu/tgn/": "getty_tgn",
    "http://vocab.getty.edu/ulan/": "getty_ulan",
}

_SKOS = "http://www.w3.org/2004/02/skos/core#"
_PREF_LABEL = f"{_SKOS}prefLabel"
_RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"

_NT_ESCAPES = {
    "\\": "\\",
    '"': '"',
    "n": "\n",
    "r": "\r",
    "t": "\t",
}


class GettyDumpError(RuntimeError):
    """Raised when a Getty dump is missing or cannot be parsed."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class GettyDumpAdapter(SourceAdapter):
    """Read a local Getty N-Triples dump and yield vocabulary records.

    The dump path comes from ``source.query`` (falling back to
    ``source.params['path']``). Optional ``source.params['license']`` overrides
    the stamped licence (default :data:`GETTY_LICENSE`).

    Args:
        confidence: Provenance confidence stamped on every record.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "getty-dump"
    source_type = "dump"

    def __init__(
        self,
        *,
        confidence: float = confidence_for("qid-anchored"),
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one record per Getty subject in the dump."""
        params = category_spec.source.params
        raw_path = (category_spec.source.query or params.get("path") or "").strip()
        if not raw_path:
            raise GettyDumpError(
                f"category {category_spec.id!r} has no dump path "
                "(source.query or source.params.path) to read"
            )
        path = Path(raw_path)
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise GettyDumpError(f"cannot read Getty dump {path}: {exc}") from exc
        license_ = params.get("license") or GETTY_LICENSE
        retrieved_at = self._now().isoformat()
        return self._iter_records(lines, license_, retrieved_at)

    def _iter_records(
        self, lines: list[str], license_: str, retrieved_at: str
    ) -> Iterator[RawRecord]:
        # Group consecutive triples by subject; Getty dumps are subject-sorted,
        # but we tolerate interleaving by flushing on each subject change.
        labels: dict[str, str] = {}
        langs: dict[str, str] = {}
        types: dict[str, str] = {}
        order: list[str] = []
        for number, line in enumerate(lines, start=1):
            triple = _parse_nt_line(line, number)
            if triple is None:
                continue
            subject, predicate, obj = triple
            if _source_for(subject) is None:
                continue
            if subject not in labels and subject not in types:
                order.append(subject)
            if predicate == _PREF_LABEL and obj.is_literal:
                labels[subject] = obj.value
                if obj.lang:
                    langs[subject] = obj.lang
            elif predicate == _RDF_TYPE and not obj.is_literal:
                # Prefer a domain-specific type over the generic SKOS one.
                if subject not in types or types[subject].startswith(_SKOS):
                    types[subject] = obj.value
        for subject in order:
            if subject not in labels:
                continue  # not a labelled vocabulary entry (e.g. a label node)
            source = _source_for(subject)
            assert source is not None  # _source_for gated entry into `order`
            fields = {
                "id": _local_id(subject),
                "uri": subject,
                "name": labels[subject],
                "type": types.get(subject, ""),
            }
            if subject in langs:
                fields["lang"] = langs[subject]
            provenance = Provenance(
                source=source,
                source_url=subject,
                source_query=subject,
                retrieved_at=retrieved_at,
                confidence=self._confidence,
                license=license_,
            )
            yield RawRecord(fields=fields, provenance=provenance)


def _source_for(uri: str) -> str | None:
    """Return the provenance ``source`` for a Getty subject URI, else ``None``."""
    for namespace, source in GETTY_NAMESPACES.items():
        if uri.startswith(namespace):
            return source
    return None


def _local_id(uri: str) -> str:
    """Return the trailing local id of a Getty URI (e.g. ``300000000``)."""
    return uri.rstrip("/").rsplit("/", 1)[-1]


class _Term:
    """A parsed N-Triples object term: a URI/bnode or a (possibly tagged) literal."""

    __slots__ = ("value", "is_literal", "lang")

    def __init__(self, value: str, *, is_literal: bool, lang: str | None) -> None:
        self.value = value
        self.is_literal = is_literal
        self.lang = lang


def _parse_nt_line(
    line: str, number: int
) -> tuple[str, str, _Term] | None:
    """Parse one N-Triples line into ``(subject, predicate, object)``.

    Returns ``None`` for blank lines and comments. Subject and predicate are
    returned as bare URI/bnode strings; the object is a :class:`_Term`. Raises
    :class:`GettyDumpError` (naming the line) on malformed input.
    """
    text = line.strip()
    if not text or text.startswith("#"):
        return None
    try:
        subject, index = _read_term(text, 0)
        predicate, index = _read_term(text, index)
        obj, _ = _read_term(text, index)
    except (ValueError, IndexError) as exc:
        raise GettyDumpError(
            f"malformed N-Triples on line {number}: {line!r} ({exc})"
        ) from exc
    if subject.is_literal or predicate.is_literal:
        raise GettyDumpError(
            f"subject/predicate must be IRIs on line {number}: {line!r}"
        )
    return subject.value, predicate.value, obj


def _read_term(text: str, start: int) -> tuple[_Term, int]:
    """Read one term from *text* at/after *start*, returning it and the next index."""
    index = start
    while index < len(text) and text[index].isspace():
        index += 1
    char = text[index]
    if char == "<":
        end = text.index(">", index)
        return _Term(text[index + 1 : end], is_literal=False, lang=None), end + 1
    if char == "_":  # blank node, e.g. _:b0
        end = index
        while end < len(text) and not text[end].isspace():
            end += 1
        return _Term(text[index:end], is_literal=False, lang=None), end
    if char == '"':
        return _read_literal(text, index)
    raise ValueError(f"unexpected term start {char!r} at {index}")


def _read_literal(text: str, start: int) -> tuple[_Term, int]:
    """Read a quoted literal (with optional ``@lang``/``^^<type>``) from *text*."""
    buffer: list[str] = []
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            buffer.append(_NT_ESCAPES.get(text[index + 1], text[index + 1]))
            index += 2
            continue
        if char == '"':
            index += 1
            break
        buffer.append(char)
        index += 1
    else:
        raise ValueError("unterminated literal")
    lang: str | None = None
    if index < len(text) and text[index] == "@":
        end = index + 1
        while end < len(text) and (text[end].isalnum() or text[end] == "-"):
            end += 1
        lang = text[index + 1 : end]
        index = end
    elif text[index : index + 2] == "^^":
        end = text.index(">", index)
        index = end + 1
    return _Term("".join(buffer), is_literal=True, lang=lang), index
