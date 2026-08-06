"""`server/services/bulk-import.ts`, ported — CSV/TSV straight into the corpus.

**This is the only module in the service that writes a lexicon file without a
review step.** `routers/ai_review.py` promotes one draft at a time after a human
accepted it; this takes a pasted file and appends — or, in `replace` mode,
*overwrites the whole table*. That is what it did on Express and it is the
contract, but it is why the backup is unconditional and taken before either
branch.

Rules worth reading before touching this:

* **Column matching is by trimmed, case-folded header name, not by position.**
  An incoming column with no counterpart is reported under `Unmapped columns
  (ignored)` and dropped; a target column nothing maps to is written blank. If
  *nothing* matches, the import stops with the target's header in the message.
* **`Unmapped columns` is a warning wearing an error's clothes.** It lands in
  `errors[]`, and the route then answers **200** anyway — `hasErrors` filters
  precisely that prefix out. Any other entry is a 400. So the array is two kinds
  of thing and the prefix is the only discriminator.
* **Dedup is by the *first target column*, whatever it is called.** The id
  source is whichever incoming column mapped to target index 0; when no incoming
  column did, `skipDuplicates` silently does nothing.
* **The seen-id set is updated as rows are read**, so a batch that repeats an id
  internally keeps the first occurrence and skips the rest.
* **`replace` writes through a `.tmp` and renames**, `append` appends in place
  after topping up a missing trailing newline. Neither takes a lock; the
  TypeScript did not either, and a second writer is not a case this surface has.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any, Final

from pinakes.analytics.jsmath import locale_key
from pinakes.contributions.store import iso_now
from pinakes.paths import lexicons_dir

#: `content.split(/\r?\n/)` — the same split the exporter uses, and not
#: Python's universal newlines, which would break a lone `\r` into two rows.
_LINES: Final = re.compile(r"\r?\n")

#: `.replace(/[:.]/g, "-")` on an ISO timestamp — a filename-safe stamp.
_STAMP_UNSAFE: Final = re.compile(r"[:.]")

#: The prefix that makes an `errors[]` entry a warning rather than a refusal.
UNMAPPED_PREFIX: Final = "Unmapped columns"


def detect_delimiter(header_line: str) -> str:
    """Tab wins ties, so a single-column CSV with no comma imports as TSV."""
    tabs = header_line.count("\t")
    commas = header_line.count(",")
    return "\t" if tabs >= commas else ","


def parse_delimited(content: str, delimiter: str) -> tuple[list[str], list[list[str]]]:
    """Header + rows. Blank lines are dropped; **only the header is trimmed**.

    Row cells are trimmed later, by :func:`_remap_row` — which means a row that
    maps to no target column never has its whitespace looked at at all.
    """
    lines = [line for line in _LINES.split(content) if line.strip() != ""]
    if not lines:
        return [], []
    return (
        [cell.strip() for cell in lines[0].split(delimiter)],
        [line.split(delimiter) for line in lines[1:]],
    )


def import_targets(directory: Path | None = None) -> list[dict[str, Any]]:
    """Every `*.tsv` in the corpus with its header, sorted by `localeCompare`.

    The header split is **always on a tab** here, whatever the file turns out to
    contain — these are the targets, and a target is a TSV by definition.

    A **missing corpus raises**, because `fs.promises.readdir` did and the route
    answers 500. That is the `analytics.quality` posture rather than the usual
    "an absent file is an empty domain": an empty list of import targets would
    read as "this corpus admits no imports", which is a different claim.
    """
    corpus = Path(directory) if directory is not None else lexicons_dir()
    targets: list[dict[str, Any]] = []
    entries = (entry for entry in corpus.iterdir() if entry.name.endswith(".tsv"))
    for path in sorted(entries):
        with open(path, encoding="utf-8", newline="") as handle:
            content = handle.read()
        first = _LINES.split(content)[0] if content else ""
        targets.append(
            {"file": path.name, "headers": [cell.strip() for cell in first.split("\t")]}
        )
    return sorted(targets, key=lambda entry: locale_key(str(entry["file"])))


def map_headers(
    incoming: list[str], target: list[str]
) -> tuple[dict[int, int], list[str]]:
    """Incoming column index → target column index, plus the ones that matched none.

    `indexOf` on the normalized target list, so a target header that repeats
    after case-folding claims all of its incoming matches at its **first**
    position — and the later duplicate is written blank.
    """
    normalized = [header.lower().strip() for header in target]
    mapping: dict[int, int] = {}
    unmapped: list[str] = []
    for index, header in enumerate(incoming):
        wanted = header.lower().strip()
        if wanted in normalized:
            mapping[index] = normalized.index(wanted)
        else:
            unmapped.append(header)
    return mapping, unmapped


def _remap_row(row: list[str], mapping: dict[int, int], columns: int) -> list[str]:
    """Move each mapped cell into its target column; everything else stays blank."""
    output = [""] * columns
    for source, destination in mapping.items():
        cell = row[source] if source < len(row) else None
        output[destination] = cell.strip() if cell is not None else ""
    return output


def _existing_ids(path: Path) -> set[str]:
    """The first tab-separated column of every data row. Missing file ⇒ empty."""
    if not path.is_file():
        return set()
    with open(path, encoding="utf-8", newline="") as handle:
        content = handle.read()
    lines = [line for line in _LINES.split(content) if line.strip() != ""]
    ids: set[str] = set()
    for line in lines[1:]:
        first = line.split("\t")[0].strip()
        if first:
            ids.add(first)
    return ids


def _create_backup(path: Path, *, stamp: str | None = None) -> str:
    """Copy the target into `.backups/<base>_<timestamp><ext>` and name the copy.

    The stamp is `new Date().toISOString()` with `:` and `.` replaced by `-`, so
    two imports inside the same millisecond would collide — as they did over
    there. *stamp* is injectable so a test can pin the filename.
    """
    moment = _STAMP_UNSAFE.sub("-", stamp if stamp is not None else iso_now())
    backups = path.parent / ".backups"
    backups.mkdir(parents=True, exist_ok=True)
    destination = backups / f"{path.stem}_{moment}{path.suffix}"
    shutil.copyfile(path, destination)
    return str(destination)


def bulk_import(
    *,
    target: str,
    content: str,
    mode: str,
    skip_duplicates: bool = True,
    directory: Path | None = None,
    stamp: str | None = None,
) -> dict[str, Any]:
    """Import *content* into `<lexicons>/<target>`. Returns the outcome, never raises.

    Every refusal is an `errors[]` entry on an otherwise-zero result, which is
    what lets the route answer 400 with a body a human can act on. The early
    returns happen **before** the backup, so a rejected import leaves no trace.
    """
    result: dict[str, Any] = {
        "target": target,
        "rowsImported": 0,
        "rowsSkipped": 0,
        "errors": [],
    }
    errors: list[str] = result["errors"]

    corpus = Path(directory) if directory is not None else lexicons_dir()
    target_path = corpus / target

    # `path.join` first and validate after, exactly as written — the guard is
    # the check that matters and it refuses `..` and any separator outright.
    if not target.endswith(".tsv") or ".." in target or "/" in target:
        errors.append(f"Invalid target file: {target}")
        return result
    if not target_path.is_file():
        errors.append(f"Target file does not exist: {target}")
        return result

    with open(target_path, encoding="utf-8", newline="") as handle:
        existing_content = handle.read()
    target_first = _LINES.split(existing_content)[0] if existing_content else ""
    target_headers = [cell.strip() for cell in target_first.split("\t")]

    first_line = _LINES.split(content)[0] if content else ""
    delimiter = detect_delimiter(first_line)
    incoming_headers, incoming_rows = parse_delimited(content, delimiter)

    if not incoming_headers:
        errors.append("No headers found in import data")
        return result
    if not incoming_rows:
        errors.append("No data rows found in import data")
        return result

    mapping, unmapped = map_headers(incoming_headers, target_headers)
    if not mapping:
        errors.append(
            f"No matching columns found. Expected: {', '.join(target_headers)}"
        )
        return result
    if unmapped:
        errors.append(f"{UNMAPPED_PREFIX} (ignored): {', '.join(unmapped)}")

    result["backupPath"] = _create_backup(target_path, stamp=stamp)

    if mode == "replace":
        remapped = [
            _remap_row(row, mapping, len(target_headers)) for row in incoming_rows
        ]
        lines = ["\t".join(target_headers)] + ["\t".join(row) for row in remapped]
        temp = target_path.with_name(target_path.name + ".tmp")
        temp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        temp.replace(target_path)
        result["rowsImported"] = len(remapped)
        return result

    seen = _existing_ids(target_path) if skip_duplicates else set()
    # Which incoming column feeds target column 0. `find` takes the FIRST such
    # entry in insertion order, which is incoming-column order.
    id_source: int | None = next(
        (source for source, dest in mapping.items() if dest == 0), None
    )

    new_rows: list[str] = []
    for row in incoming_rows:
        if skip_duplicates and id_source is not None:
            cell = row[id_source] if id_source < len(row) else None
            identifier = cell.strip() if cell is not None else ""
            if identifier and identifier in seen:
                result["rowsSkipped"] += 1
                continue
            if identifier:
                seen.add(identifier)
        new_rows.append("\t".join(_remap_row(row, mapping, len(target_headers))))

    if new_rows:
        with open(target_path, encoding="utf-8", newline="") as handle:
            current = handle.read()
        prefix = "" if current.endswith("\n") else "\n"
        with open(target_path, "a", encoding="utf-8", newline="") as handle:
            handle.write(prefix + "\n".join(new_rows) + "\n")

    result["rowsImported"] = len(new_rows)
    return result


def has_blocking_errors(errors: list[str]) -> bool:
    """`errors.some(e => !e.startsWith("Unmapped columns"))` — the 400/200 decision."""
    return any(not error.startswith(UNMAPPED_PREFIX) for error in errors)
