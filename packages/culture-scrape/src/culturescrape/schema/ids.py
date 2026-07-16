"""Deterministic global ids (``csid``) so re-runs are idempotent.

The canonical primary key ``csid`` (``docs/data-model.md``) is minted as
``cs:<type>:<local>``. Identity is *stable* — minting the same input twice
always yields the identical id — which is what makes acquisition re-runs
idempotent and entity resolution able to recognise a row it has seen before.

There are three minting paths:

* **QID-anchored.** When a Wikidata QID is known it *is* the identity, so the
  local part is the QID verbatim: ``cs:dish:Q12345``. Two rows reconciled to the
  same QID collapse to one node regardless of how their names were spelled.
* **Alias-anchored.** When a source ships a stable local id of its own (e.g. a
  Pinakes id), that id *is* the identity within its type, so the local part
  is the alias verbatim: ``cs:language:aap``. Re-ingesting the same source row
  mints the identical id, and the result matches the ``cs:<type>:<id>`` the
  source's own export already computed (so its edges resolve).
* **Name-anchored.** Otherwise the local part is a readable slug of the name
  plus a hash of the *normalized* ``(name, lang)`` pair: ``cs:dish:ceviche-9a3f…``.
  The hash carries the identity (so casing/whitespace/Unicode differences in the
  name do not fork the id); the slug is a human-readable, diff-friendly prefix.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

#: Scheme prefix for every minted id.
CSID_PREFIX = "cs"

#: A Wikidata QID, optionally trailing an entity URI (no leading zero; no Q0).
_QID_RE = re.compile(r"Q[1-9][0-9]*$")

#: A minted csid, ``cs:<type>:<local>`` (``<local>`` may itself contain colons).
_CSID_RE = re.compile(r"cs:(?P<type>[^:]+):(?P<local>.+)$")

#: Runs of characters that are not slug-safe (collapsed to a single hyphen).
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")

#: Separator between the slug and hash in a name-anchored local part.
_LOCAL_SEP = "-"

#: Field separator inside the hashed string (cannot occur in normalized input).
_HASH_SEP = "\x1f"

#: Hex digits of the name hash retained (64 bits — ample against collisions).
_HASH_LEN = 16

#: Maximum slug length kept as the readable prefix (the hash ensures identity).
_SLUG_MAX = 48


class IdError(ValueError):
    """Raised when an id cannot be minted from the given input."""


def normalize_type(node_type: str) -> str:
    """Return the slug form of *node_type* used in the id's ``<type>`` field."""
    slug = _slugify(node_type)
    if not slug:
        raise IdError(f"node type {node_type!r} has no slug-safe characters")
    return slug


def normalize_name(name: str) -> str:
    """Return the canonical form of *name* used for hashing.

    Unicode is NFKC-normalized, surrounding whitespace stripped, internal
    whitespace runs collapsed to one space, and the result casefolded — so
    ``"  Café\\tCriollo "`` and ``"café criollo"`` hash identically.
    """
    folded = unicodedata.normalize("NFKC", name)
    return " ".join(folded.split()).casefold()


def normalize_qid(qid: str) -> str:
    """Return the canonical ``Q<number>`` for *qid* (accepts an entity URI).

    Raises :class:`IdError` if no well-formed QID is present.
    """
    match = _QID_RE.search(qid.strip())
    if match is None:
        raise IdError(f"{qid!r} is not a Wikidata QID")
    return match.group(0)


def mint_csid(
    node_type: str,
    *,
    qid: str | None = None,
    alias: str | None = None,
    name: str | None = None,
    lang: str | None = None,
) -> str:
    """Mint the deterministic ``csid`` for an entity.

    The anchor is chosen in strict precedence: a well-formed *qid* yields a
    QID-anchored id (``cs:<type>:Q<number>``); failing that, a stable source-local
    *alias* yields an alias-anchored id (``cs:<type>:<alias>``); failing that,
    *name* is required and the id is name-anchored (``cs:<type>:<slug>-<hash>``).
    *lang* (the BCP-47 code of *name*) participates in the hash so the same
    spelling in two languages mints distinct ids. The same arguments always
    produce the same id.
    """
    type_slug = normalize_type(node_type)
    if qid is not None:
        local = normalize_qid(qid)
    elif alias is not None:
        local = _alias_local(alias)
    elif name is not None:
        local = _name_local(name, lang or "")
    else:
        raise IdError("mint_csid requires a qid, an alias, or a name")
    return f"{CSID_PREFIX}:{type_slug}:{local}"


def csid_type(csid: str) -> str:
    """Return the ``<type>`` segment of a minted *csid* (``cs:<type>:<local>``).

    Raises :class:`IdError` if *csid* is not a well-formed ``cs:<type>:<local>``.
    """
    match = _CSID_RE.fullmatch(csid.strip())
    if match is None:
        raise IdError(f"{csid!r} is not a well-formed csid")
    return match.group("type")


def csid_qid(csid: str) -> str | None:
    """Return the Wikidata QID a **QID-anchored** *csid* carries, else ``None``.

    A QID-anchored id has the QID verbatim as its local part
    (``cs:dish:Q12345`` → ``Q12345``); an alias- or name-anchored id (or a
    malformed string) has no QID and yields ``None``. This is the inverse of the
    QID-anchoring path in :func:`mint_csid`, letting an incremental refresh recover
    which Wikidata entity a corpus node stands for straight from its ``csid``.
    """
    match = _CSID_RE.fullmatch(csid.strip())
    if match is None:
        return None
    local = match.group("local")
    return local if _QID_RE.fullmatch(local) else None


def _alias_local(alias: str) -> str:
    """Return the local part for an alias-anchored id (the alias verbatim).

    The alias *is* the identity, so — unlike a name — it is used as-is (only
    surrounding whitespace trimmed), not slugified or hashed. This keeps the
    minted id byte-identical to the ``cs:<type>:<id>`` the source's own export
    computes, so edges that reference those ids still resolve after ingestion.
    """
    local = alias.strip()
    if not local:
        raise IdError("alias is empty")
    return local


def _name_local(name: str, lang: str) -> str:
    """Build the ``<slug>-<hash>`` local part for a name-anchored id."""
    norm_name = normalize_name(name)
    if not norm_name:
        raise IdError(f"name {name!r} is empty after normalization")
    norm_lang = lang.strip().casefold()
    digest = hashlib.sha256(
        f"{norm_lang}{_HASH_SEP}{norm_name}".encode()
    ).hexdigest()[:_HASH_LEN]
    slug = _slugify(name)[:_SLUG_MAX].strip(_LOCAL_SEP)
    return f"{slug}{_LOCAL_SEP}{digest}" if slug else digest


def _slugify(text: str) -> str:
    """Return an ASCII ``[a-z0-9-]`` slug of *text* (may be empty)."""
    ascii_text = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    return _NON_SLUG_RE.sub(_LOCAL_SEP, ascii_text.lower()).strip(_LOCAL_SEP)
