"""Generate many category specs from one compact domain blueprint.

Hand-writing a ``categories/<id>.yml`` per class does not scale to thousands of
categories. A *blueprint* (``blueprints/<domain>.yml``) collapses that work: it
declares the defaults a whole domain shares (label, dimensions, links) once, then
lists one short stub per category — usually just an id, a gloss, and a Wikidata
class id. :func:`generate` expands every stub into a full, *validated*
``categories/<id>.yml`` (writing the SPARQL or PetScan config for you), and can
emit a runnable ``jobs/<domain>.yml`` that runs the lot end to end.

Blueprint schema (``blueprints/<domain>.yml``)::

    defaults:                         # optional; merged into every stub
      label: Dish;CulturalArtifact    # ;-separated Neo4j label set
      dimensions: [temporal, geographic, linguistic]
      links:
        - {type: ORIGINATES_FROM, to: place}
    categories:                       # required; one stub per category
      - id: peruvian-dishes
        name: Peruvian dish           # -> description "Every Peruvian dish"
        wikidata_class: Q746549       # -> instance-of query: ?item wdt:P31 wd:Q746549
      - id: indo-european-languages
        description: Indo-European languages and their ancestors
        subclass_of: Q19860           # -> transitive wdt:P279+ taxonomy query
        label: Language
        dimensions: [linguistic]
        links: [{type: DESCENDS_FROM, to: language}]
      - id: us-civil-war-battles
        name: battle of the American Civil War
        petscan: {categories: Battles of the American Civil War, depth: 3}

Each stub names exactly one source: ``wikidata_class`` (instance-of a class),
``subclass_of`` (the transitive subclass taxonomy under a class), ``query`` (raw
SPARQL), or ``petscan`` (a Wikipedia category tree). Per-stub ``label`` /
``dimensions`` / ``links`` override the defaults.

**Dump mode.** Passing a :class:`DumpSource` to :func:`generate` /
:func:`build_specs` retargets every ``wikidata_class`` stub at a **local Wikidata
dump** (``source.type: wikidata-dump``) instead of the live Query Service, so a
whole blueprint acquires fully offline from a dump slice (see
``docs/wikidata-dump-runbook.md`` and the US-003 food-drink proof). The generated
job may carry relaxed corpus floors (``min_component_fraction`` /
``min_provenance_completeness``) — a single-domain slice legitimately fragments
below the multi-domain seed corpus's connectivity.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from culturescrape.acquire.categories import (
    CategorySpec,
    CategorySpecError,
    parse_category,
)

#: A Wikidata entity id (``Q`` followed by a positive integer).
_QID_RE = re.compile(r"^Q[1-9][0-9]*$")
#: A category/job id: lowercase, digits, and single hyphens.
_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
#: A stub line naming a class selector, splitting the code from any trailing
#: ``# ...`` comment so the verified count can be (re)written idempotently.
_CLASS_LINE_RE = re.compile(
    r"^(?P<code>(?![ \t]*#).*"
    r"(?:wikidata_class|subclass_of):[ \t]*(?P<qid>Q[1-9][0-9]*)[^#\n]*?)"
    r"(?:[ \t]+#[^\n]*)?$",
    re.MULTILINE,
)

#: Runs a SPARQL ``COUNT`` query and returns the integer it yields. Injected so
#: count verification can be exercised offline against a stubbed Query Service.
CountFn = Callable[[str], int]

#: Keys a category stub may carry. Exactly one must be a source selector.
_SOURCE_SELECTORS = ("wikidata_class", "subclass_of", "query", "petscan")
_STUB_KEYS = frozenset(
    ("id", "name", "description", "label", "dimensions", "links", *_SOURCE_SELECTORS)
)
_DEFAULT_KEYS = frozenset(("label", "dimensions", "links"))
_BLUEPRINT_KEYS = frozenset(("defaults", "categories"))

#: PetScan param defaults a stub's ``petscan`` mapping inherits.
_PETSCAN_DEFAULTS: Mapping[str, str] = {
    "language": "en",
    "project": "wikipedia",
    "combination": "subset",
    "depth": "0",
}


class BlueprintError(ValueError):
    """Raised when a blueprint is unreadable or fails validation.

    The message lists every problem found across all stubs, like the category
    and job loaders.
    """


@dataclass(frozen=True)
class DumpSource:
    """Binds a blueprint's class stubs to a local Wikidata dump.

    When given to :func:`generate` / :func:`build_specs`, every ``wikidata_class``
    stub expands to a ``wikidata-dump`` source that selects the class's members
    from *path* (resolving membership through *index* when set, else a full dump
    scan), rather than a live ``wikidata-sparql`` query — so the blueprint builds
    offline from a dump slice. Only ``wikidata_class`` stubs are expressible as
    dump class-membership; a ``subclass_of`` / ``query`` / ``petscan`` stub is
    rejected in dump mode.

    Attributes:
        path: The local dump/slice the adapter reads (never downloaded).
        index: An optional prebuilt class-membership index beside the dump; when
            unset the adapter uses the conventional sidecar or a full scan.
        hydrate: The hydration profile to opt every category into (e.g.
            ``'default'``), or ``None`` for label-only SPARQL parity.
        transitive: Whether to also keep instances of each class's ``P279``
            subclasses (the ``P31/P279*`` idiom the slice was composed with);
            defaults to ``True`` to mirror ``build-slice``.
    """

    path: Path
    index: Path | None = None
    hydrate: str | None = None
    transitive: bool = True


@dataclass(frozen=True)
class GenerateResult:
    """What a :func:`generate` run produced."""

    blueprint: Path
    categories: tuple[Path, ...]
    job: Path | None


def load_blueprint(
    path: str | Path, *, dump: DumpSource | None = None
) -> tuple[CategorySpec, ...]:
    """Load *path* and return the validated category specs it expands to.

    Pass *dump* to retarget every ``wikidata_class`` stub at a local dump
    (``wikidata-dump`` source) instead of the live Query Service.

    Raises:
        BlueprintError: If the file cannot be read, is not valid YAML, or any
            stub is invalid.
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise BlueprintError(f"cannot read blueprint {path}: {exc}") from exc
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise BlueprintError(f"{path}: invalid YAML: {exc}") from exc
    return build_specs(raw, source=str(path), dump=dump)


def build_specs(
    raw: object, *, source: str = "<blueprint>", dump: DumpSource | None = None
) -> tuple[CategorySpec, ...]:
    """Expand a parsed blueprint *raw* into validated :class:`CategorySpec`s.

    Every stub is rendered to a category mapping and run through the category
    schema validator, so an invalid stub fails here rather than at acquisition.

    Raises:
        BlueprintError: If the blueprint shape is wrong or any stub is invalid.
    """
    errors: list[str] = []
    if not isinstance(raw, dict):
        raise BlueprintError(
            f"{source}: expected a YAML mapping at the top level, got "
            f"{type(raw).__name__}"
        )
    unknown = sorted(set(raw) - _BLUEPRINT_KEYS)
    if unknown:
        errors.append(f"unknown keys: {', '.join(map(str, unknown))}")

    defaults = _parse_defaults(raw.get("defaults", {}), errors)
    stubs = raw.get("categories")
    if not isinstance(stubs, list) or not stubs:
        errors.append("'categories' must be a non-empty list of stubs")
        stubs = []

    mappings: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, stub in enumerate(stubs):
        label = _stub_label(stub, index)
        mapping = _expand_stub(stub, defaults, label, errors, dump)
        if mapping is None:
            continue
        cid = mapping["id"]
        if cid in seen:
            errors.append(f"{label}: duplicate id {cid!r}")
        seen.add(cid)
        mappings.append(mapping)

    if errors:
        raise BlueprintError(
            f"{source}: invalid blueprint:\n  - " + "\n  - ".join(errors)
        )

    specs: list[CategorySpec] = []
    for mapping in mappings:
        try:
            specs.append(parse_category(mapping, source=f"{source}#{mapping['id']}"))
        except CategorySpecError as exc:  # pragma: no cover - defensive
            errors.append(str(exc))
    if errors:
        raise BlueprintError(
            f"{source}: invalid blueprint:\n  - " + "\n  - ".join(errors)
        )
    return tuple(specs)


def generate(
    blueprint: str | Path,
    out_dir: str | Path,
    *,
    job: str | Path | None = None,
    force: bool = False,
    verify: bool = False,
    count_fn: CountFn | None = None,
    dump: DumpSource | None = None,
    min_component_fraction: float | None = None,
    min_provenance_completeness: float | None = None,
) -> GenerateResult:
    """Expand *blueprint* into ``<out_dir>/<id>.yml`` files (and an optional job).

    Args:
        blueprint: The blueprint file to expand.
        out_dir: Directory the ``categories/<id>.yml`` files are written to.
        job: When given, also write a runnable job file listing every generated
            category, with ``output_root`` defaulting to ``out/<blueprint-stem>``.
        force: Overwrite existing category/job files instead of refusing.
        verify: Query each class stub's live entity count via *count_fn*, record
            it as a trailing ``# ~N`` comment in the blueprint, and refuse a
            class that resolves to zero entities. Off by default so generation
            stays fully offline.
        count_fn: Runs one SPARQL ``COUNT`` query and returns the count;
            required when *verify* is set (the CLI wires it to the Query
            Service). Ignored otherwise.
        dump: When set, retarget every ``wikidata_class`` stub at this local dump
            (``wikidata-dump`` source) so the blueprint acquires offline.
        min_component_fraction: When set, written to the generated job so the
            corpus connectivity floor is relaxed (a single-domain dump slice
            legitimately fragments below the multi-domain seed corpus's 90%).
        min_provenance_completeness: When set, written to the generated job to
            relax the corpus provenance floor.

    Raises:
        BlueprintError: If the blueprint is invalid, a class stub fails count
            verification, or a target file already exists and *force* is not set.
    """
    blueprint = Path(blueprint)
    out_dir = Path(out_dir)
    specs = load_blueprint(blueprint, dump=dump)
    if verify:
        if count_fn is None:
            raise BlueprintError("verification requires a count function")
        verify_counts(blueprint, count_fn)

    out_dir.mkdir(parents=True, exist_ok=True)
    header = (
        f"# Generated by `culturescrape generate` from {blueprint.name}.\n"
        "# Edit the blueprint and regenerate rather than editing this file.\n"
        '# Schema: docs/data-model.md ("Category specification (input)").\n'
    )
    written: list[Path] = []
    for spec in specs:
        dest = out_dir / f"{spec.id}.yml"
        if dest.exists() and not force:
            raise BlueprintError(
                f"{dest} already exists; pass force=True to overwrite"
            )
        dest.write_text(header + _render_yaml(_spec_to_mapping(spec)), encoding="utf-8")
        written.append(dest)

    job_path: Path | None = None
    if job is not None:
        job_path = _write_job(
            Path(job),
            blueprint.stem,
            written,
            force=force,
            min_component_fraction=min_component_fraction,
            min_provenance_completeness=min_provenance_completeness,
        )

    return GenerateResult(
        blueprint=blueprint, categories=tuple(written), job=job_path
    )


def verify_counts(blueprint: str | Path, count_fn: CountFn) -> dict[str, int]:
    """Query each class stub's live entity count and record it in *blueprint*.

    For every stub naming a ``wikidata_class`` (``wdt:P31``) or ``subclass_of``
    (``wdt:P279+``) class, run a SPARQL ``COUNT`` via *count_fn* and rewrite the
    stub's trailing ``# ~N`` comment in place — the format the shipped blueprints
    already carry. A class that resolves to zero entities (or does not exist) is
    refused, naming the stub, so a domain never ships an empty category. Stubs
    using a raw ``query`` or ``petscan`` source carry no single class and are
    skipped. Rewriting is idempotent: unchanged counts leave the file untouched.

    Returns:
        The observed count per QID.

    Raises:
        BlueprintError: If the blueprint is unreadable, or any class resolves to
            zero entities.
    """
    blueprint = Path(blueprint)
    try:
        text = blueprint.read_text(encoding="utf-8")
    except OSError as exc:
        raise BlueprintError(f"cannot read blueprint {blueprint}: {exc}") from exc
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise BlueprintError(f"{blueprint}: invalid YAML: {exc}") from exc

    stubs = raw.get("categories") if isinstance(raw, dict) else None
    if not isinstance(stubs, list):
        raise BlueprintError(f"{blueprint}: 'categories' must be a list of stubs")

    counts: dict[str, int] = {}
    errors: list[str] = []
    for index, stub in enumerate(stubs):
        if not isinstance(stub, dict):
            continue
        selector = next(
            (s for s in ("wikidata_class", "subclass_of") if s in stub), None
        )
        if selector is None:
            continue
        qid = stub[selector]
        if not isinstance(qid, str) or not _QID_RE.match(qid):
            continue  # parse_category already reported this shape error
        n = count_fn(_count_query(selector, qid))
        if n <= 0:
            errors.append(
                f"{_stub_label(stub, index)}: {selector} {qid} resolves to "
                "zero entities or does not exist"
            )
            continue
        counts[qid] = n

    if errors:
        raise BlueprintError(
            f"{blueprint}: count verification failed:\n  - " + "\n  - ".join(errors)
        )

    new_text = _apply_counts(text, counts)
    if new_text != text:
        blueprint.write_text(new_text, encoding="utf-8")
    return counts


def _count_query(selector: str, qid: str) -> str:
    predicate = "wdt:P31" if selector == "wikidata_class" else "wdt:P279+"
    return (
        "SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE {\n"
        f"  ?item {predicate} wd:{qid} .\n"
        "}\n"
    )


def _apply_counts(text: str, counts: Mapping[str, int]) -> str:
    """Rewrite each class stub's trailing ``# ~N`` comment from *counts*."""

    def repl(match: re.Match[str]) -> str:
        qid = match.group("qid")
        if qid not in counts:
            return match.group(0)
        return f"{match.group('code')}  # ~{counts[qid]:,}"

    return _CLASS_LINE_RE.sub(repl, text)


def _parse_defaults(value: object, errors: list[str]) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        errors.append("'defaults' must be a mapping when present")
        return {}
    unknown = sorted(set(value) - _DEFAULT_KEYS)
    if unknown:
        errors.append(f"defaults: unknown keys: {', '.join(map(str, unknown))}")
    return value


def _stub_label(stub: object, index: int) -> str:
    if isinstance(stub, dict) and isinstance(stub.get("id"), str):
        return f"categories[{index}] ({stub['id']})"
    return f"categories[{index}]"


def _expand_stub(
    stub: object,
    defaults: Mapping[str, Any],
    label: str,
    errors: list[str],
    dump: DumpSource | None = None,
) -> dict[str, Any] | None:
    """Merge one stub with *defaults* into a category mapping, or ``None``."""
    before = len(errors)
    if not isinstance(stub, dict):
        errors.append(f"{label} must be a mapping")
        return None

    unknown = sorted(set(stub) - _STUB_KEYS)
    if unknown:
        errors.append(f"{label}: unknown keys: {', '.join(map(str, unknown))}")

    cid = stub.get("id")
    if not isinstance(cid, str) or not _ID_RE.match(cid):
        errors.append(f"{label}: 'id' must be a lowercase-hyphenated string")

    description = _stub_description(stub, label, errors)
    source = (
        _build_dump_source(stub, label, errors, dump)
        if dump is not None
        else _build_source(stub, label, errors)
    )

    mapping: dict[str, Any] = {}
    if isinstance(cid, str):
        mapping["id"] = cid
    if "label" in stub:
        mapping["label"] = stub["label"]
    elif "label" in defaults:
        mapping["label"] = defaults["label"]
    else:
        errors.append(f"{label}: no 'label' (set one on the stub or in defaults)")
    if description is not None:
        mapping["description"] = description
    if source is not None:
        mapping["source"] = source
    mapping["dimensions"] = stub.get("dimensions", defaults.get("dimensions", []))
    links = stub.get("links", defaults.get("links"))
    if links:
        mapping["links"] = links

    # Bail if this stub contributed any error: parse_category would re-report it.
    return mapping if len(errors) == before else None


def _stub_description(
    stub: Mapping[str, Any], label: str, errors: list[str]
) -> str | None:
    if isinstance(stub.get("description"), str):
        return str(stub["description"])
    name = stub.get("name")
    if isinstance(name, str) and name.strip():
        return f"Every {name.strip()}"
    errors.append(f"{label}: needs a 'description' or a 'name'")
    return None


def _build_source(
    stub: Mapping[str, Any], label: str, errors: list[str]
) -> dict[str, Any] | None:
    present = [key for key in _SOURCE_SELECTORS if key in stub]
    if len(present) != 1:
        errors.append(
            f"{label}: set exactly one source selector "
            f"({', '.join(_SOURCE_SELECTORS)}); found {len(present)}"
        )
        return None
    selector = present[0]

    if selector == "petscan":
        return _petscan_source(stub["petscan"], label, errors)

    if selector == "query":
        query = stub["query"]
        if not isinstance(query, str) or not query.strip():
            errors.append(f"{label}: 'query' must be a non-empty string")
            return None
        return {"type": "wikidata-sparql", "query": _ensure_trailing_newline(query)}

    qid = stub[selector]
    if not isinstance(qid, str) or not _QID_RE.match(qid):
        errors.append(f"{label}: '{selector}' must be a Wikidata id like 'Q42'")
        return None
    if selector == "wikidata_class":
        query = _instance_query(qid)
    else:
        query = _subclass_query(qid)
    return {"type": "wikidata-sparql", "query": query}


def _build_dump_source(
    stub: Mapping[str, Any], label: str, errors: list[str], dump: DumpSource
) -> dict[str, Any] | None:
    """Expand a class stub into a ``wikidata-dump`` source over *dump*.

    Only a ``wikidata_class`` stub is expressible as dump class-membership: the
    adapter selects a class's ``P31`` instances (plus, transitively, instances of
    its ``P279`` subclasses). A ``subclass_of`` / ``query`` / ``petscan`` stub has
    no dump equivalent and is rejected, naming the stub.
    """
    present = [key for key in _SOURCE_SELECTORS if key in stub]
    if len(present) != 1:
        errors.append(
            f"{label}: set exactly one source selector "
            f"({', '.join(_SOURCE_SELECTORS)}); found {len(present)}"
        )
        return None
    selector = present[0]
    if selector != "wikidata_class":
        errors.append(
            f"{label}: dump mode supports only 'wikidata_class' stubs, not "
            f"{selector!r} (a dump selects class membership, not a raw query)"
        )
        return None

    qid = stub[selector]
    if not isinstance(qid, str) or not _QID_RE.match(qid):
        errors.append(f"{label}: '{selector}' must be a Wikidata id like 'Q42'")
        return None

    params: dict[str, Any] = {"path": str(dump.path), "class": qid}
    if dump.transitive:
        params["transitive"] = "true"
    if dump.index is not None:
        params["index"] = str(dump.index)
    if dump.hydrate:
        params["hydrate"] = dump.hydrate
    return {"type": "wikidata-dump", "params": params}


def _petscan_source(
    value: object, label: str, errors: list[str]
) -> dict[str, Any] | None:
    if not isinstance(value, dict) or not isinstance(value.get("categories"), str):
        errors.append(f"{label}: 'petscan' must be a mapping with 'categories'")
        return None
    params: dict[str, Any] = {**_PETSCAN_DEFAULTS}
    for key, raw_value in value.items():
        params[str(key)] = raw_value
    return {"type": "petscan", "params": params}


def _instance_query(qid: str) -> str:
    return (
        "SELECT ?item ?itemLabel ?image WHERE {\n"
        f"  ?item wdt:P31 wd:{qid} .\n"
        '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n'
        "}\n"
    )


def _subclass_query(qid: str) -> str:
    return (
        "SELECT ?item ?itemLabel ?parent ?parentLabel WHERE {\n"
        f"  ?item wdt:P279+ wd:{qid} .\n"
        "  OPTIONAL { ?item wdt:P279 ?parent . }\n"
        '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n'
        "}\n"
    )


def _ensure_trailing_newline(text: str) -> str:
    return text if text.endswith("\n") else text + "\n"


def _spec_to_mapping(spec: CategorySpec) -> dict[str, Any]:
    """Render a validated spec back to an ordered category mapping for YAML."""
    source: dict[str, Any] = {"type": spec.source.type}
    if spec.source.query is not None:
        source["query"] = spec.source.query
    if spec.source.params:
        source["params"] = dict(spec.source.params)
    mapping: dict[str, Any] = {
        "id": spec.id,
        "label": spec.label,
        "description": spec.description,
        "source": source,
        "dimensions": list(spec.dimensions),
    }
    if spec.links:
        mapping["links"] = [{"type": link.type, "to": link.to} for link in spec.links]
    return mapping


def _write_job(
    job_path: Path,
    name: str,
    categories: Sequence[Path],
    *,
    force: bool,
    min_component_fraction: float | None = None,
    min_provenance_completeness: float | None = None,
) -> Path:
    """Write a runnable job listing *categories*, paths relative to the job.

    *min_component_fraction* / *min_provenance_completeness*, when given, are
    written as the job's corpus-floor overrides (dump mode relaxes them for a
    single-domain slice).
    """
    if job_path.exists() and not force:
        raise BlueprintError(f"{job_path} already exists; pass force=True to overwrite")
    job_path.parent.mkdir(parents=True, exist_ok=True)
    base = job_path.parent
    rels = [_relative(path, base) for path in categories]
    # Mirror the shipped seed job: outputs land in a sibling `out/` tree one
    # level up from the jobs directory (e.g. jobs/x.yml -> ../out/x).
    output_root = _relative(base.parent / "out" / name, base)
    mapping: dict[str, Any] = {
        "name": name,
        "description": f"Generated from {name} blueprint.",
        "categories": rels,
        "output_root": output_root,
    }
    if min_component_fraction is not None:
        mapping["min_component_fraction"] = min_component_fraction
    if min_provenance_completeness is not None:
        mapping["min_provenance_completeness"] = min_provenance_completeness
    header = (
        f"# Generated by `culturescrape generate` from the {name} blueprint.\n"
        f"# Run with: culturescrape run {job_path}\n"
    )
    job_path.write_text(header + _render_yaml(mapping), encoding="utf-8")
    return job_path


def _relative(path: Path, base: Path) -> str:
    return os.path.relpath(path, base)


class _LiteralDumper(yaml.SafeDumper):
    """SafeDumper that renders multi-line strings as ``|`` block scalars."""


def _represent_str(dumper: yaml.SafeDumper, data: str) -> yaml.ScalarNode:
    style = "|" if "\n" in data else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


_LiteralDumper.add_representer(str, _represent_str)


def _render_yaml(mapping: Mapping[str, Any]) -> str:
    return yaml.dump(
        dict(mapping),
        Dumper=_LiteralDumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    )


def iter_blueprints(directory: str | Path) -> Iterable[Path]:
    """Yield the ``*.yml`` blueprint files under *directory*, sorted by name."""
    return sorted(Path(directory).glob("*.yml"))
