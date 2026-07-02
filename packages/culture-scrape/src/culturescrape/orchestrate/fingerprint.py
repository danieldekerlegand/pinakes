"""Stage-level input fingerprinting for incremental, idempotent re-runs.

Re-running a job should be cheap: a stage whose inputs are byte-for-byte
unchanged since the last run has nothing to recompute, so the runner skips it.
This module makes "unchanged" decidable. It supplies a stable content
fingerprint over a stage's inputs and the small per-stage manifest the runner
leaves in each output directory to remember the fingerprint it last produced.

A stage's input fingerprint folds in everything that determines its output:

* the category spec — so editing a category re-runs its stages; and
* the content of the upstream stage's output directory — so new source data
  cascades downstream, re-normalizing and re-linking only what changed.

Because ``acquire``'s fingerprint is the spec alone, an unchanged spec means the
fetch is skipped outright: no network call. The runner's ``force`` switch
recomputes every stage regardless.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from culturescrape.acquire.categories import CategorySpec

#: Filename of the manifest a completed stage writes into its output directory.
MANIFEST_NAME = ".stage.json"


@dataclass(frozen=True)
class StageManifest:
    """The fingerprint record a completed stage leaves in its output directory.

    Persisting the *input* fingerprint (not the output) is what lets the next
    run decide, without recomputing the stage, whether its inputs still match.
    The row count is carried along so a skipped stage can report the same tally
    the original run did.
    """

    stage: str
    input_fingerprint: str
    rows: int

    def write(self, out_dir: Path) -> None:
        """Write this manifest as :data:`MANIFEST_NAME` under *out_dir*."""
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / MANIFEST_NAME).write_text(
            json.dumps(asdict(self), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    @classmethod
    def read(cls, out_dir: Path) -> StageManifest | None:
        """Return the manifest under *out_dir*, or ``None`` if absent/unreadable.

        A missing, malformed, or partial manifest reads as ``None`` — the stage
        is simply treated as never having run, so it runs now.
        """
        try:
            data = json.loads((out_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        try:
            return cls(
                stage=str(data["stage"]),
                input_fingerprint=str(data["input_fingerprint"]),
                rows=int(data["rows"]),
            )
        except (KeyError, TypeError, ValueError):
            return None


def fingerprint_spec(spec: CategorySpec) -> str:
    """Return a stable fingerprint of everything in *spec* that shapes output."""
    return _hash_json(
        {
            "id": spec.id,
            "label": spec.label,
            "description": spec.description,
            "source": {
                "type": spec.source.type,
                "query": spec.source.query,
                "params": dict(spec.source.params),
            },
            "dimensions": list(spec.dimensions),
            "links": [{"type": link.type, "to": link.to} for link in spec.links],
        }
    )


def fingerprint_directory(root: Path) -> str:
    """Return a content fingerprint of every file under *root*.

    Files are hashed in sorted relative-path order, each path folded in with its
    bytes so a rename is as detectable as an edit. The stage manifest itself is
    excluded, so a directory's fingerprint reflects only the data a stage
    produced — never the bookkeeping the runner wrote beside it. A missing
    directory hashes to the same value as an empty one.
    """
    if not root.is_dir():
        return _EMPTY_DIR
    digest = hashlib.sha256()
    files = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    )
    for path in files:
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def combine(*parts: str) -> str:
    """Fold *parts* (a stage label and its input fingerprints) into one digest."""
    return _hash_json(list(parts))


def _hash_json(payload: object) -> str:
    """SHA-256 of *payload* serialized to canonical, key-sorted JSON."""
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


#: Fingerprint of a directory with no data files (also used for a missing dir).
_EMPTY_DIR = hashlib.sha256().hexdigest()
