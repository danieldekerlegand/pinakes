"""`server/services/export-pipeline.ts`, ported — the open-dataset exporter.

Two layers, in the order the TypeScript stacks them:

1. **Per-profile export.** Five :data:`DATASET_PROFILES` name the lexicon files
   that make up a publishable dataset and the CLDF-ish column names their
   internal headers are renamed to. :func:`export_dataset` reads those TSVs,
   filters, renames and re-serialises them as CSV/TSV/JSON/CLDF.
2. **Versioned releases.** :func:`build_dataset_snapshot` exports every profile
   at once and stamps the bundle with a semver version (derived from the shared
   changelog), a licence, row counts and — when a minter is configured — a DOI.

Things that look like details and are contract:

* **The column "remap" never reorders anything.** `remapHeaders` pushes `i` onto
  the index map on *both* branches, so the map is the identity and the only
  observable effect of :func:`_remap_row` is that every cell is **trimmed** and
  a short row is padded with ``""``. Written the way it was written rather than
  simplified, because the padding is what makes a ragged corpus row exportable.
* **A filter is a case-insensitive substring test, and an unknown column is
  ignored** — not an error and not an empty result. `headers.indexOf(col) === -1`
  `continue`s, so `?nonsense=x` exports the whole file.
* **A file that is missing, or empty, is skipped silently** — it contributes no
  entry to `files`, so `fileCount` is the number of files that *had* data.
* **`exportDate` / `releaseDate` are wall-clock.** Both are injectable here
  (`now=`) for the same reason the TypeScript made `releaseDate` an option: a
  snapshot whose metadata cannot be pinned cannot be diffed.
* **The download route's content type is derived from the format and is wrong
  for TSV** (`format === "json" ? "application/json" : "text/csv"`). That lives
  in the router, but it is the reason :func:`extension_for` and the content type
  are computed separately rather than as one table.
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, Final

from pinakes.contributions.store import iso_now
from pinakes.paths import lexicons_dir

#: `content.split(/\r?\n/)` — a lone `\r` is *not* a line break here.
_LINES: Final = re.compile(r"\r?\n")

#: The four spellings `validateExportOptions` admits, in message order.
VALID_FORMATS: Final[tuple[str, ...]] = ("cldf", "csv", "tsv", "json")

#: Default semver for the published corpus — the seed / first release.
DATASET_RELEASE_VERSION: Final = "1.0.0"

#: Open licence the whole corpus is released under.
DATASET_LICENSE: Final = "CC-BY-4.0"

#: `source:` on every export and every release. Verbatim, including the fact
#: that the URL names an organisation rather than a repository.
DATASET_SOURCE: Final = "pinakes (https://github.com/pinakes)"


class UnknownDatasetError(ValueError):
    """`throw new Error("Unknown dataset: …")` — an export of a profile that is not one.

    A ``ValueError`` because every caller of :func:`export_dataset` turns it into
    a **400** carrying ``str(error)`` verbatim; the message below is that body.
    """


# ── The profiles ─────────────────────────────────────────────────────────────
#
# A straight transcription of `DATASET_PROFILES`. Order matters twice: it is the
# order `GET /api/export/datasets` lists them in, and the order
# `buildDatasetSnapshot` exports them in when no subset is named.

DATASET_PROFILES: Final[tuple[dict[str, Any], ...]] = (
    {
        "id": "languages",
        "name": "Languages",
        "description": (
            "Core language catalog with ISO codes, classification, and "
            "geographic data"
        ),
        "files": ["languages.tsv", "families.tsv"],
        "columnMappings": {
            "languages.tsv": {
                "id": "ID",
                "name": "Name",
                "iso639_1": "ISO639P1code",
                "iso639_2": "ISO639P3code",
                "family_id": "Family_ID",
                "latitude": "Latitude",
                "longitude": "Longitude",
                "status": "Status",
                "region": "Macroarea",
                "countries": "Countries",
                "native_speakers": "Speakers",
                "classification": "Classification",
            },
            "families.tsv": {
                "id": "ID",
                "name": "Name",
                "region": "Macroarea",
            },
        },
    },
    {
        "id": "phonology",
        "name": "Phonological Inventories",
        "description": (
            "Phoneme inventories and phonological features for PHOIBLE/CLDF "
            "contribution"
        ),
        "files": ["phonological-inventories.tsv", "sound-changes.tsv"],
        "columnMappings": {
            "phonological-inventories.tsv": {
                "id": "ID",
                "language_id": "Language_ID",
                "consonants": "Consonants",
                "vowels": "Vowels",
                "tones": "Tones",
            },
            "sound-changes.tsv": {
                "id": "ID",
                "source_language": "Source_Language_ID",
                "target_language": "Target_Language_ID",
            },
        },
    },
    {
        "id": "grammar",
        "name": "Grammatical Features",
        "description": "Typological features suitable for WALS contribution",
        "files": ["grammar-features.tsv"],
        "columnMappings": {
            "grammar-features.tsv": {
                "id": "ID",
                "language_id": "Language_ID",
                "word_order": "Word_Order",
                "morphological_type": "Morphological_Type",
                "case_system": "Case_System",
                "gender_system": "Gender_System",
                "number_system": "Number_System",
            },
        },
    },
    {
        "id": "etymology",
        "name": "Etymology Relations",
        "description": (
            "Cognate sets and etymological relations for open etymological "
            "databases"
        ),
        "files": ["etymology-relations.tsv", "words-base.tsv"],
        "columnMappings": {
            "etymology-relations.tsv": {
                "id": "ID",
                "source_word": "Source_Form",
                "source_language": "Source_Language_ID",
                "target_word": "Target_Form",
                "target_language": "Target_Language_ID",
                "relation_type": "Relation_Type",
            },
            "words-base.tsv": {
                "id": "ID",
                "concept": "Parameter_ID",
                "english": "English",
            },
        },
    },
    {
        "id": "writing-systems",
        "name": "Writing Systems",
        "description": "Script and writing system data",
        "files": ["writing-systems.tsv"],
        "columnMappings": {
            "writing-systems.tsv": {
                "id": "ID",
                "name": "Name",
                "language_id": "Language_ID",
            },
        },
    },
)


def dataset_profiles() -> list[dict[str, Any]]:
    """`getDatasetProfiles()` — every profile, in declaration order."""
    return [dict(profile) for profile in DATASET_PROFILES]


def dataset_profile(identifier: Any) -> dict[str, Any] | None:
    """`getDatasetProfile(id)` — ``None`` for anything that is not a profile id.

    The comparison is `p.id === id`, so a non-string argument matches nothing
    rather than raising; that is what makes `POST /api/export` with
    ``{"dataset": 7}`` a validation error instead of a 500.
    """
    for profile in DATASET_PROFILES:
        if profile["id"] == identifier:
            return dict(profile)
    return None


def profile_ids() -> str:
    """The ``Available: …`` tail both error messages carry."""
    return ", ".join(str(profile["id"]) for profile in DATASET_PROFILES)


# ── Reading, filtering, formatting ───────────────────────────────────────────


def _read_tsv(directory: Path, filename: str) -> tuple[list[str], list[list[str]]]:
    """`readTsvFile` — headers trimmed, blank lines dropped, missing file empty.

    Deliberately not :func:`pinakes.analytics.tsv.parse_tsv`: that one keeps the
    header cells untrimmed and answers ``([""], [])`` for an empty file, where
    this one has to answer ``([], [])`` because `headers.length === 0` is the
    signal :func:`export_dataset` skips a file on.

    ``newline=""`` because the split is JavaScript's ``/\\r?\\n/``: Python's
    universal-newline translation would turn a lone ``\\r`` into a row boundary
    that does not exist over there.
    """
    path = Path(directory) / filename
    if not path.is_file():
        return [], []
    with open(path, encoding="utf-8", newline="") as handle:
        content = handle.read()
    lines = [line for line in _LINES.split(content) if line.strip() != ""]
    if not lines:
        return [], []
    return (
        [cell.strip() for cell in lines[0].split("\t")],
        [line.split("\t") for line in lines[1:]],
    )


def apply_filters(
    headers: Sequence[str],
    rows: Iterable[Sequence[str]],
    filters: Mapping[str, str],
) -> list[list[str]]:
    """Keep rows whose every named column *contains* the filter value.

    Case-insensitive substring, not equality — and a column the file does not
    have is skipped rather than failing the row, so an unknown filter key is a
    no-op. An empty filter bag short-circuits to the whole set.
    """
    materialised = [list(row) for row in rows]
    if not filters:
        return materialised

    kept: list[list[str]] = []
    for row in materialised:
        matched = True
        for column, value in filters.items():
            index = headers.index(column) if column in headers else -1
            if index == -1:
                continue
            cell = (row[index] if index < len(row) else "").strip().lower()
            if value.lower() not in cell:
                matched = False
                break
        if matched:
            kept.append(row)
    return kept


def remap_headers(
    headers: Sequence[str], mappings: Mapping[str, str]
) -> list[str]:
    """Rename what the profile names; keep everything else as found.

    The TypeScript returned an `indexMap` alongside this and it is always the
    identity (both branches push `i`) — so it is not returned here, and
    :func:`_remap_row` takes the column *count* instead.
    """
    return [
        mappings[header] if mappings.get(header) else header for header in headers
    ]


def _remap_row(row: Sequence[str], columns: int) -> list[str]:
    """`indexMap.map(i => (row[i] ?? "").trim())` — trim every cell, pad short rows."""
    return [
        (row[index] if index < len(row) else "").strip()
        for index in range(columns)
    ]


def escape_csv(value: str) -> str:
    """Quote a cell that carries a comma, a quote or a newline; double its quotes.

    Note what is **not** escaped: a bare ``\\r``, and a tab. The corpus has
    neither in a cell that reaches CSV, and widening the rule would change bytes
    the TypeScript already published.
    """
    if "," in value or '"' in value or "\n" in value:
        return '"' + value.replace('"', '""') + '"'
    return value


def format_output(
    headers: Sequence[str], rows: Sequence[Sequence[str]], fmt: str
) -> str:
    """Serialise to one of the four formats. ``cldf`` is CSV; anything else is TSV.

    The JSON branch is `JSON.stringify(objects, null, 2)`: two-space indent, and
    a **duplicate header wins later**, because it is an object key. Both are
    reproduced — `ensure_ascii=False` because JavaScript does not escape
    non-ASCII, and a dict comprehension because Python resolves a repeated key
    the same last-wins way.
    """
    if fmt in ("csv", "cldf"):
        return "\n".join(
            [",".join(escape_csv(cell) for cell in headers)]
            + [",".join(escape_csv(cell) for cell in row) for row in rows]
        )
    if fmt == "json":
        objects = [
            {
                headers[index]: (row[index] if index < len(row) else "").strip()
                for index in range(len(headers))
            }
            for row in rows
        ]
        return json.dumps(objects, indent=2, ensure_ascii=False)
    return "\n".join(["\t".join(headers)] + ["\t".join(row) for row in rows])


def extension_for(fmt: str) -> str:
    """`getExtension` — ``.csv`` for csv/cldf, ``.json`` for json, else ``.tsv``."""
    if fmt in ("csv", "cldf"):
        return ".csv"
    if fmt == "json":
        return ".json"
    return ".tsv"


def export_dataset(
    dataset: Any,
    fmt: str,
    *,
    filters: Mapping[str, str] | None = None,
    include_files: Any = None,
    directory: Path | None = None,
    now: Callable[[], str] = iso_now,
) -> dict[str, Any]:
    """`exportDataset(options)` — one profile's files, filtered and re-serialised.

    Raises :class:`UnknownDatasetError` for a profile that does not exist; a
    caller that already ran :func:`validate_export_options` will never see it,
    which is why the route can afford a bare 400.
    """
    profile = dataset_profile(dataset)
    if profile is None:
        raise UnknownDatasetError(
            f"Unknown dataset: {dataset}. Available: {profile_ids()}"
        )

    corpus = Path(directory) if directory is not None else lexicons_dir()
    files: list[str] = list(profile["files"])
    if include_files is not None:
        files = [name for name in files if _js_includes(include_files, name)]

    exported: list[dict[str, Any]] = []
    for filename in files:
        headers, rows = _read_tsv(corpus, filename)
        if not headers:
            continue

        filtered = apply_filters(headers, rows, filters) if filters else rows
        mappings = profile["columnMappings"].get(filename, {})
        mapped_headers = remap_headers(headers, mappings)
        mapped_rows = [_remap_row(row, len(mapped_headers)) for row in filtered]

        base = filename[: -len(".tsv")] if filename.endswith(".tsv") else filename
        exported.append(
            {
                "filename": f"{base}{extension_for(fmt)}",
                "content": format_output(mapped_headers, mapped_rows, fmt),
                "rowCount": len(mapped_rows),
            }
        )

    return {
        "dataset": dataset,
        "format": fmt,
        "files": exported,
        "metadata": {
            "title": f"pinakes Export: {profile['name']}",
            "description": profile["description"],
            "exportDate": now(),
            "source": DATASET_SOURCE,
            "license": DATASET_LICENSE,
            "fileCount": len(exported),
            "totalRows": sum(int(entry["rowCount"]) for entry in exported),
        },
    }


def _js_includes(haystack: Any, needle: str) -> bool:
    """`haystack.includes(needle)` — an **array** membership or a **string** substring.

    Both readings are live: `includeFiles` arrives from a JSON body (an array)
    *or* from `?includeFiles=a,b` split into one (also an array), but a caller
    can post a bare string and `"languages.tsv,families.tsv".includes(...)` is a
    perfectly good substring test over there. Anything else has no `.includes`
    and throws, which the route turns into its 500.
    """
    if isinstance(haystack, str):
        return needle in haystack
    if isinstance(haystack, list):
        return needle in haystack
    raise TypeError("options.includeFiles.includes is not a function")


def validate_export_options(
    dataset: Any, fmt: Any, *, include_files: Any = None
) -> list[str]:
    """Every complaint about an export request, in the TypeScript's order.

    An empty list is valid. `!options.dataset` is JavaScript truthiness, so
    ``""`` and ``0`` are both "required" rather than "unknown" — and a
    *non-string* truthy dataset falls through to the unknown-dataset branch,
    where `String(dataset)` is what the message prints.
    """
    errors: list[str] = []

    if not _truthy(dataset):
        errors.append("Dataset is required")
    elif dataset_profile(dataset) is None:
        errors.append(
            f"Unknown dataset: {_js_text(dataset)}. Available: {profile_ids()}"
        )

    if not _truthy(fmt):
        errors.append("Format is required")
    elif fmt not in VALID_FORMATS:
        errors.append(
            f"Invalid format: {_js_text(fmt)}. Available: {', '.join(VALID_FORMATS)}"
        )

    if _truthy(include_files):
        profile = dataset_profile(dataset)
        if profile is not None:
            for name in _js_iterate(include_files):
                if name not in profile["files"]:
                    errors.append(
                        f"File {_js_text(name)} is not part of dataset "
                        f"{_js_text(dataset)}. Available: "
                        f"{', '.join(profile['files'])}"
                    )

    return errors


def _truthy(value: Any) -> bool:
    """``!!value``: an empty list or dict is **truthy**, an empty string is not."""
    if value is None or value is False:
        return False
    if value is True:
        return True
    if isinstance(value, str):
        return value != ""
    if isinstance(value, (int, float)):
        return value != 0 and not (isinstance(value, float) and math.isnan(value))
    return True


def _js_text(value: Any) -> str:
    """`${value}` — how a template literal prints it into an error message."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float) and value.is_integer() and math.isfinite(value):
        return str(int(value))
    if isinstance(value, (list, dict)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    return str(value)


def _js_iterate(value: Any) -> list[Any]:
    """`for (const x of value)` — arrays and strings iterate; nothing else does."""
    if isinstance(value, list):
        return list(value)
    if isinstance(value, str):
        return list(value)
    raise TypeError("options.includeFiles is not iterable")


# ── Semver ───────────────────────────────────────────────────────────────────

#: `^(\\d+)\\.(\\d+)\\.(\\d+)$` — ASCII digits only. Python's `\\d` is Unicode-wide,
#: so an Arabic-Indic "٣" would parse here and not over there; hence `[0-9]`.
_SEMVER = re.compile(r"^([0-9]+)\.([0-9]+)\.([0-9]+)$")


def parse_semver(version: Any) -> tuple[int, int, int] | None:
    """`parseSemver` — ``None`` when malformed. A non-string is `(x ?? "")`'d away."""
    text = version.strip() if isinstance(version, str) else ""
    match = _SEMVER.match(text)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def format_semver(version: tuple[int, int, int]) -> str:
    """`formatSemver` — `major.minor.patch`."""
    return f"{version[0]}.{version[1]}.{version[2]}"


def bump_version(version: Any, level: str) -> str:
    """Raise one component and reset the ones below it. Throws on a bad input.

    The throw is the reachable failure of `POST /api/dataset/release`: a body
    carrying ``{"previousVersion": "1.0"}`` becomes a 400 whose message is
    ``Invalid semver: 1.0``.
    """
    parsed = parse_semver(version)
    if parsed is None:
        raise ValueError(f"Invalid semver: {_js_text(version)}")
    major, minor, patch = parsed
    if level == "major":
        return format_semver((major + 1, 0, 0))
    if level == "minor":
        return format_semver((major, minor + 1, 0))
    return format_semver((major, minor, patch + 1))


def determine_version_bump(counts: Mapping[str, int]) -> str:
    """Removals ⇒ major, additions ⇒ minor, otherwise patch.

    "Otherwise" includes *no changes at all*: a release with an empty changelog
    is a patch re-release, never a no-op.
    """
    if int(counts.get("removed", 0)) > 0:
        return "major"
    if int(counts.get("added", 0)) > 0:
        return "minor"
    return "patch"


def next_version_from_changelog(
    previous_version: Any, counts: Mapping[str, int]
) -> str:
    """`nextVersionFromChangelog` — the bump the recorded changes imply."""
    return bump_version(previous_version, determine_version_bump(counts))


# ── DOI minting ──────────────────────────────────────────────────────────────

#: Zenodo credentials. Both optional: with no token, minting is **off** and a
#: release still ships with `doi: null` — the `GEONAMES_USERNAME` posture.
ZENODO_TOKEN_ENV: Final = "ZENODO_TOKEN"
ZENODO_SANDBOX_ENV: Final = "ZENODO_SANDBOX"

#: Overridable so a test can point at a stub rather than monkeypatching
#: `urllib` — the seam :mod:`pinakes.media.images` opens for the same reason.
ZENODO_BASE_URL_ENV: Final = "ZENODO_BASE_URL"

#: Upstream timeout, in seconds.
ZENODO_TIMEOUT_S: Final = 30.0

#: A minter: release metadata in, ``{"doi", "doiUrl"}`` or ``None`` out.
DoiMinter = Callable[[Mapping[str, Any]], "dict[str, str] | None"]


def null_doi_minter(_metadata: Mapping[str, Any]) -> dict[str, str] | None:
    """`nullDoiMinter` — never mints. The safe default the GET routes use."""
    return None


def zenodo_base_url(*, sandbox: bool | None = None) -> str:
    """Which Zenodo to talk to: the sandbox when asked, production otherwise."""
    override = os.environ.get(ZENODO_BASE_URL_ENV)
    if override:
        return override.rstrip("/")
    use_sandbox = (
        sandbox
        if sandbox is not None
        else os.environ.get(ZENODO_SANDBOX_ENV) == "true"
    )
    return "https://sandbox.zenodo.org" if use_sandbox else "https://zenodo.org"


def zenodo_doi_minter(
    *, token: str | None = None, sandbox: bool | None = None
) -> DoiMinter:
    """`createZenodoDoiMinter` — reserve a DOI by opening a draft deposition.

    **Disabled without a token**: `mint` answers ``None`` and the release ships
    with a null DOI, so a checkout with no Zenodo account still releases. An
    upstream that answers non-2xx raises, and the route turns that into a 400
    naming the status — a failed mint must not quietly publish an un-citable
    release.
    """

    def mint(metadata: Mapping[str, Any]) -> dict[str, str] | None:
        resolved = token if token is not None else os.environ.get(ZENODO_TOKEN_ENV)
        if not resolved:
            return None
        url = (
            f"{zenodo_base_url(sandbox=sandbox)}/api/deposit/depositions"
            f"?access_token={urllib.parse.quote(resolved, safe='')}"
        )
        body = json.dumps(
            {
                "metadata": {
                    "title": f"{metadata['title']} v{metadata['version']}",
                    "upload_type": "dataset",
                    "description": metadata["description"],
                    "version": metadata["version"],
                    "license": str(metadata["license"]).lower(),
                }
            }
        ).encode("utf-8")
        request = urllib.request.Request(  # noqa: S310 - https, built above
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(  # noqa: S310 - as above
                request, timeout=ZENODO_TIMEOUT_S
            ) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"Zenodo DOI minting failed: {error.code}"
            ) from error
        doi = ((payload.get("metadata") or {}).get("prereserve_doi") or {}).get("doi")
        if not doi:
            return None
        return {"doi": doi, "doiUrl": f"https://doi.org/{doi}"}

    return mint


# ── Snapshots ────────────────────────────────────────────────────────────────

#: `title.replace(/^pinakes Export:\s*/, "")` — the per-dataset display name.
#: JavaScript's `\s` spelled out: Python's differs at both ends — it matches
#: `\x1c`-`\x1f`, which JavaScript does not, and misses U+FEFF, which it does.
_EXPORT_TITLE = re.compile(
    r"^pinakes Export:"
    r"[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*"
)


def assemble_snapshot_metadata(
    exports: Sequence[Mapping[str, Any]],
    *,
    version: str,
    release_date: str,
    fmt: str,
    license_name: str | None = None,
    doi: str | None = None,
    doi_url: str | None = None,
) -> dict[str, Any]:
    """`assembleSnapshotMetadata` — pure: row counts, licence, DOI, per-dataset."""
    datasets = [
        {
            "id": export["dataset"],
            "name": _EXPORT_TITLE.sub(
                "", str(export["metadata"]["title"])
            ),
            "fileCount": len(export["files"]),
            "totalRows": sum(int(entry["rowCount"]) for entry in export["files"]),
        }
        for export in exports
    ]
    return {
        "title": "pinakes Open Dataset",
        "description": (
            "Versioned, citable snapshot of the pinakes open linguistic + "
            "cultural corpus."
        ),
        "version": version,
        "releaseDate": release_date,
        "doi": doi,
        "doiUrl": doi_url,
        "license": license_name if license_name is not None else DATASET_LICENSE,
        "source": DATASET_SOURCE,
        "format": fmt,
        "datasets": datasets,
        "fileCount": sum(int(entry["fileCount"]) for entry in datasets),
        "totalRows": sum(int(entry["totalRows"]) for entry in datasets),
    }


def build_dataset_snapshot(
    *,
    fmt: str = "json",
    datasets: Sequence[str] | None = None,
    version: str | None = None,
    previous_version: str | None = None,
    change_counts: Mapping[str, int] | None = None,
    release_date: str | None = None,
    license_name: str | None = None,
    doi_minter: DoiMinter | None = None,
    filters: Mapping[str, str] | None = None,
    directory: Path | None = None,
    now: Callable[[], str] = iso_now,
) -> dict[str, Any]:
    """Export every (or a named subset of) profile and stamp release metadata on it.

    Version precedence, as documented over there: an explicit *version*, then
    the changelog-derived bump over *previous_version*, then the seed
    :data:`DATASET_RELEASE_VERSION`. **Both** of the middle branch's inputs are
    required for it to apply — a `previousVersion` with no change counts falls
    all the way through to the seed rather than bumping by nothing.
    """
    profiles = list(datasets) if datasets else [str(p["id"]) for p in DATASET_PROFILES]

    exports = [
        export_dataset(
            identifier, fmt, filters=filters, directory=directory, now=now
        )
        for identifier in profiles
    ]

    if version is not None:
        resolved_version = version
    elif previous_version and change_counts is not None:
        resolved_version = next_version_from_changelog(previous_version, change_counts)
    else:
        resolved_version = DATASET_RELEASE_VERSION

    metadata = assemble_snapshot_metadata(
        exports,
        version=resolved_version,
        release_date=release_date if release_date is not None else now(),
        fmt=fmt,
        license_name=license_name,
    )

    if doi_minter is not None:
        minted = doi_minter(metadata)
        if minted:
            metadata = {**metadata, "doi": minted["doi"], "doiUrl": minted["doiUrl"]}

    files = [
        {
            "dataset": export["dataset"],
            "filename": entry["filename"],
            "content": entry["content"],
            "rowCount": entry["rowCount"],
        }
        for export in exports
        for entry in export["files"]
    ]

    return {"metadata": metadata, "files": files}
