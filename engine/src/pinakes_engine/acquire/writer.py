"""Write acquired :class:`RawRecord`\\ s to disk as JSON-lines.

Each record is serialized to one JSON object per line (``.jsonl``), carrying its
raw ``fields`` and full ``provenance`` so no acquired fact is ever stored without
its source. Keys are sorted to keep the output deterministic and git-diffable.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import asdict
from pathlib import Path

from pinakes_engine.acquire.records import RawRecord


def record_to_jsonl(record: RawRecord) -> str:
    """Serialize one *record* to a single JSON line (no trailing newline).

    Keys are sorted so output is deterministic and git-diffable.
    """
    return json.dumps(asdict(record), ensure_ascii=False, sort_keys=True)


def write_records(records: Iterable[RawRecord], path: str | Path) -> int:
    """Write *records* to *path* as JSON-lines, returning the number written.

    The parent directory is created if missing. Each line is a JSON object of
    the form ``{"fields": {...}, "provenance": {...}}``.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(record_to_jsonl(record))
            handle.write("\n")
            count += 1
    return count
