"""``culturescrape`` command-line entrypoint.

Exposes the acquisition engine as a CLI. ``culturescrape fetch <category.yml>
--out <dir>`` loads and validates a category spec, selects the adapter its
``source.type`` calls for, runs the fetch, and writes the raw records to
``<dir>/<category-id>.jsonl`` with provenance (see ``docs/data-model.md``). A
JSON run report is written alongside it as ``<dir>/<category-id>.report.json``
so each run is auditable.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from culturescrape.acquire.categories import CategorySpecError, load_category
from culturescrape.acquire.factory import AdapterSelectionError, build_adapter
from culturescrape.acquire.http import HttpClient, HttpStats
from culturescrape.acquire.records import RawRecord
from culturescrape.acquire.run import run_acquisition
from culturescrape.acquire.wikidata import WikidataSparqlError
from culturescrape.acquire.wikidata_dump import DumpReadStats, WikidataDumpError
from culturescrape.acquire.wikidata_dump_index import build_index, default_index_path
from culturescrape.acquire.wikidata_enrich import (
    build_qid_lookup,
    corpus_qids,
    enrich_nodes,
    resolve_dump_version,
)
from culturescrape.acquire.wikidata_hydration import UnknownProfileError, get_profile
from culturescrape.acquire.wikidata_slice import (
    SliceClass,
    WikidataSliceError,
    blueprint_classes,
    build_slice,
)
from culturescrape.acquire.writer import record_to_jsonl
from culturescrape.datalog.export import (
    DatalogExportError,
    Engine,
    collect_facts,
    engines_for_choice,
    export_dataset,
)
from culturescrape.datalog.materialize import MaterializeError, summarize
from culturescrape.datalog.rules import RULES
from culturescrape.neo4j import Neo4jConfigError, Neo4jDriverNotInstalled
from culturescrape.neo4j.admin_import import (
    AdminImportError,
    generate_import_script,
)
from culturescrape.neo4j.counts import count_summary
from culturescrape.neo4j.export import Neo4jExportError, export_to_tsv
from culturescrape.neo4j.load_csv import load_corpus
from culturescrape.ontology.metrics import (
    metrics_for_dataset,
    read_dataset,
    render_summary,
    to_json,
)
from culturescrape.ontology.registry import Dimension
from culturescrape.ontology.run import run_linkers, select_linkers
from culturescrape.orchestrate.catalog import load_catalog, render_table
from culturescrape.orchestrate.corpus import (
    CorpusBuild,
    CorpusBuildError,
    build_corpus,
    corpus_component_fraction,
    corpus_qa_policy,
)
from culturescrape.orchestrate.generate import BlueprintError, DumpSource, generate
from culturescrape.orchestrate.jobs import (
    STAGE_ORDER,
    Job,
    JobConfigError,
    load_job,
)
from culturescrape.orchestrate.package import PackageError, package_corpus
from culturescrape.orchestrate.qa import GateThresholds, evaluate_directory
from culturescrape.orchestrate.runner import DEFAULT_WORKERS, run_job
from culturescrape.orchestrate.schedule import (
    DurationError,
    parse_duration,
    select_stale,
    write_refresh_log,
)
from culturescrape.schema.anchor import GettyIndex
from culturescrape.schema.categorize import CategorizeError
from culturescrape.schema.mapper import MapperError
from culturescrape.schema.pipeline import (
    NormalizationResult,
    PipelineError,
    normalize_records,
    read_raw_records,
    write_result,
)
from culturescrape.schema.reconcile import WikidataReconciler
from culturescrape.schema.validate import validate_directory


def main(argv: Sequence[str] | None = None) -> int:
    """Parse *argv* (default ``sys.argv``) and run the selected command."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = args.handler
    assert callable(handler)  # set via set_defaults on every subcommand
    return int(handler(args))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="culturescrape",
        description="Acquire, normalize, and validate cultural-data categories.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch = subparsers.add_parser(
        "fetch", help="fetch one category's raw records to disk"
    )
    fetch.add_argument(
        "category", type=Path, help="path to the category .yml spec"
    )
    fetch.add_argument(
        "--out",
        required=True,
        type=Path,
        help="directory the raw records .jsonl is written to",
    )
    fetch.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="HTTP cache directory for network sources "
        "(default: <out>/.http-cache)",
    )
    fetch.set_defaults(handler=_cmd_fetch)

    normalize = subparsers.add_parser(
        "normalize",
        help="normalize raw records .jsonl into validated canonical TSV",
    )
    normalize.add_argument(
        "raw", type=Path, help="path to the raw records .jsonl from acquisition"
    )
    normalize.add_argument(
        "--category",
        required=True,
        type=Path,
        help="path to the category .yml spec the records were acquired under",
    )
    normalize.add_argument(
        "--out",
        required=True,
        type=Path,
        help="directory the nodes/ and edges/ .tsv files are written to",
    )
    normalize.add_argument(
        "--reconcile",
        action="store_true",
        help="reconcile names to Wikidata QIDs (requires network access)",
    )
    normalize.add_argument(
        "--getty-dump",
        type=Path,
        default=None,
        help="Getty dump .jsonl used to anchor types/places/people to Getty ids",
    )
    normalize.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="HTTP cache directory for reconciliation "
        "(default: <out>/.http-cache)",
    )
    normalize.set_defaults(handler=_cmd_normalize)

    validate = subparsers.add_parser(
        "validate", help="validate node/edge TSV files in a directory"
    )
    validate.add_argument(
        "directory",
        type=Path,
        help="directory holding node and edge .tsv files to validate",
    )
    validate.set_defaults(handler=_cmd_validate)

    metrics = subparsers.add_parser(
        "metrics", help="report connectivity metrics for a node/edge TSV dataset"
    )
    metrics.add_argument(
        "directory",
        type=Path,
        help="directory holding node and edge .tsv files to measure",
    )
    metrics.add_argument(
        "--out",
        type=Path,
        default=None,
        help="path to write the metrics JSON to (default: print summary only)",
    )
    metrics.set_defaults(handler=_cmd_metrics)

    link = subparsers.add_parser(
        "link",
        help="infer cross-dimensional edges over a node/edge TSV dataset",
    )
    link.add_argument(
        "directory",
        type=Path,
        help="directory holding the canonical node/edge .tsv files to link",
    )
    link.add_argument(
        "--dimensions",
        default="temporal,geographic,linguistic,genetic",
        help="comma-separated dimensions to link on, in order "
        "(default: temporal,geographic,linguistic,genetic)",
    )
    link.add_argument(
        "--out",
        required=True,
        type=Path,
        help="directory the augmented nodes/ and edges/ .tsv files plus "
        "metrics.json are written to",
    )
    link.set_defaults(handler=_cmd_link)

    enrich = subparsers.add_parser(
        "enrich",
        help="enrich an existing corpus from a local Wikidata dump by QID",
    )
    enrich.add_argument(
        "directory",
        type=Path,
        help="directory holding the canonical node/edge .tsv files to enrich",
    )
    enrich.add_argument(
        "dump",
        type=Path,
        help="local Wikidata JSON dump (latest-all.json.gz/.bz2/.json)",
    )
    enrich.add_argument(
        "--out",
        required=True,
        type=Path,
        help="directory the enriched, linked nodes/ and edges/ .tsv files plus "
        "metrics.json are written to",
    )
    enrich.add_argument(
        "--profile",
        default="default",
        help="hydration profile naming the attributes to fill "
        "(default: 'default'; see docs/acquisition.md)",
    )
    enrich.add_argument(
        "--languages",
        default="en",
        help="comma-separated language codes to collect names in and attest "
        "NAMED_IN for (default: en)",
    )
    enrich.add_argument(
        "--dimensions",
        default="temporal,geographic,linguistic,genetic",
        help="comma-separated dimensions to link on, in order "
        "(default: temporal,geographic,linguistic,genetic)",
    )
    enrich.set_defaults(handler=_cmd_enrich)

    to_neo4j = subparsers.add_parser(
        "to-neo4j",
        help="import a canonical TSV dataset into Neo4j",
    )
    to_neo4j.add_argument(
        "directory",
        type=Path,
        help="dataset root holding nodes/ and edges/ .tsv files",
    )
    to_neo4j.add_argument(
        "--mode",
        choices=["admin", "loadcsv"],
        default="admin",
        help="admin: write a neo4j-admin bulk-import script (no live DB); "
        "loadcsv: run idempotent LOAD CSV against the connected DB "
        "(default: admin)",
    )
    to_neo4j.add_argument(
        "--out",
        type=Path,
        default=None,
        help="directory the admin-import script and transformed copies are "
        "written to (admin mode only; default: <directory>)",
    )
    to_neo4j.add_argument(
        "--no-constraints",
        action="store_true",
        help="loadcsv mode: skip applying csid constraints/indexes before the "
        "load (default: apply the global + per-label constraints first)",
    )
    to_neo4j.set_defaults(handler=_cmd_to_neo4j)

    neo4j_counts = subparsers.add_parser(
        "neo4j-counts",
        help="print node/edge counts by type from the connected Neo4j graph",
    )
    neo4j_counts.set_defaults(handler=_cmd_neo4j_counts)

    from_neo4j = subparsers.add_parser(
        "from-neo4j",
        help="export the connected Neo4j database to canonical TSV",
    )
    from_neo4j.add_argument(
        "--out",
        required=True,
        type=Path,
        help="directory the nodes/ and edges/ .tsv files are written to",
    )
    from_neo4j.set_defaults(handler=_cmd_from_neo4j)

    to_datalog = subparsers.add_parser(
        "to-datalog",
        help="project a canonical TSV dataset into a logic program",
    )
    to_datalog.add_argument(
        "directory",
        type=Path,
        help="dataset root holding nodes/ and edges/ .tsv files",
    )
    to_datalog.add_argument(
        "--engine",
        choices=["swipl", "souffle", "problog", "both"],
        default="both",
        help="target engine(s): swipl (.pl), souffle (.dl), problog "
        "(annotated .problog.pl), or both (swipl+souffle; default: both)",
    )
    to_datalog.add_argument(
        "--rules",
        action="store_true",
        help="attach the shared inference-rule library to the program(s)",
    )
    to_datalog.add_argument(
        "--out",
        required=True,
        type=Path,
        help="directory the .pl and/or .dl program is written to",
    )
    to_datalog.set_defaults(handler=_cmd_to_datalog)

    datalog_materialize = subparsers.add_parser(
        "datalog-materialize",
        help="materialise the inference rules over a dataset and count them "
        "(engine-free)",
    )
    datalog_materialize.add_argument(
        "directory",
        type=Path,
        help="dataset root holding nodes/ and edges/ .tsv files",
    )
    datalog_materialize.add_argument(
        "--json",
        type=Path,
        default=None,
        help="write the base/derived count manifest to this path as JSON",
    )
    datalog_materialize.add_argument(
        "--exclude",
        nargs="+",
        default=None,
        metavar="RULE",
        help="rule head(s) to skip. The engine-free evaluator materialises a "
        "relation by naive fixpoint, so the arithmetic temporal rules "
        "(contemporary/precedes/follows) recompute their ~O(n^2) span-overlap "
        "join every round — intractable at full-corpus scale (the very "
        "explosion US-001 removed from stored edges). Skip them here and leave "
        "them engine-only (a real swipl/souffle derives them lazily); the "
        "structural rules stay materialised. Excluded heads are recorded under "
        "'engine_only' in the manifest.",
    )
    datalog_materialize.set_defaults(handler=_cmd_datalog_materialize)

    run = subparsers.add_parser(
        "run",
        help="run a job end to end: acquire, normalize, link, and export a corpus",
    )
    run.add_argument(
        "job",
        type=Path,
        help="path to the job .yml spec (e.g. jobs/seed-corpus.yml)",
    )
    run.add_argument(
        "--stages",
        nargs="+",
        choices=STAGE_ORDER,
        default=None,
        help="stages to run, overriding the job's own (subset of "
        f"{', '.join(STAGE_ORDER)}); the full pipeline builds, links, and "
        "exports the stitched corpus, while a subset runs only those "
        "per-category stages (default: the job's declared stages)",
    )
    run.add_argument(
        "--force",
        action="store_true",
        help="recompute every stage, ignoring up-to-date fingerprints",
    )
    run.add_argument(
        "--since",
        default=None,
        metavar="DURATION",
        help="scheduled-refresh mode: refresh only categories whose catalog "
        "last_run is older than DURATION (e.g. 24h, 7d, 1w); fresher categories "
        "are skipped and the run is logged to refresh-log.jsonl. Drive it from a "
        "cron job or systemd timer (see docs/scheduling.md)",
    )
    run.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"max categories to process concurrently (default: {DEFAULT_WORKERS})",
    )
    run.set_defaults(handler=_cmd_run)

    qa = subparsers.add_parser(
        "qa",
        help="grade a node/edge TSV dataset against quality gates",
    )
    qa.add_argument(
        "directory",
        type=Path,
        help="directory holding the node and edge .tsv files to grade",
    )
    qa.add_argument(
        "--out",
        type=Path,
        default=None,
        help="path to write the QA report JSON to (default: print summary only)",
    )
    qa.add_argument(
        "--markdown-out",
        type=Path,
        default=None,
        help="path to write the human-readable Markdown QA artifact to",
    )
    qa.add_argument(
        "--fail-on-violation",
        action="store_true",
        help="exit non-zero when any gate is violated (default: report only)",
    )
    qa.add_argument(
        "--min-rows",
        type=int,
        default=GateThresholds.min_rows,
        help=f"minimum node count (default: {GateThresholds.min_rows})",
    )
    qa.add_argument(
        "--max-duplicate-rate",
        type=float,
        default=GateThresholds.max_duplicate_rate,
        help="maximum post-dedup duplicate fraction "
        f"(default: {GateThresholds.max_duplicate_rate})",
    )
    qa.add_argument(
        "--min-provenance-completeness",
        type=float,
        default=GateThresholds.min_provenance_completeness,
        help="minimum fraction of fully-sourced rows "
        f"(default: {GateThresholds.min_provenance_completeness})",
    )
    qa.add_argument(
        "--max-dangling-edge-rate",
        type=float,
        default=GateThresholds.max_dangling_edge_rate,
        help="maximum fraction of dangling edges "
        f"(default: {GateThresholds.max_dangling_edge_rate})",
    )
    qa.add_argument(
        "--max-unreconciled-rate",
        type=float,
        default=GateThresholds.max_unreconciled_rate,
        help="maximum fraction of unreconciled nodes "
        f"(default: {GateThresholds.max_unreconciled_rate})",
    )
    qa.add_argument(
        "--min-linguascrape-provenance-completeness",
        type=float,
        default=GateThresholds.min_linguascrape_provenance_completeness,
        help="minimum fraction of LinguaScrape-origin rows keeping the source "
        f"stamp (default: {GateThresholds.min_linguascrape_provenance_completeness})",
    )
    qa.add_argument(
        "--max-linguascrape-duplicate-rate",
        type=float,
        default=GateThresholds.max_linguascrape_duplicate_rate,
        help="maximum post-dedup duplicate fraction among LinguaScrape nodes "
        f"(default: {GateThresholds.max_linguascrape_duplicate_rate})",
    )
    qa.add_argument(
        "--max-linguascrape-dangling-edge-rate",
        type=float,
        default=GateThresholds.max_linguascrape_dangling_edge_rate,
        help="maximum fraction of dangling LinguaScrape edges "
        f"(default: {GateThresholds.max_linguascrape_dangling_edge_rate})",
    )
    qa.add_argument(
        "--max-linguascrape-unreconciled-rate",
        type=float,
        default=GateThresholds.max_linguascrape_unreconciled_rate,
        help="maximum fraction of unreconciled LinguaScrape nodes "
        f"(default: {GateThresholds.max_linguascrape_unreconciled_rate})",
    )
    qa.set_defaults(handler=_cmd_qa)

    gen = subparsers.add_parser(
        "generate",
        help="expand a domain blueprint into many category specs (and a job)",
    )
    gen.add_argument(
        "blueprint",
        type=Path,
        help="path to the blueprint .yml (e.g. blueprints/world-cuisines.yml)",
    )
    gen.add_argument(
        "--out",
        type=Path,
        default=Path("categories"),
        help="directory the generated category .yml files are written to "
        "(default: categories/)",
    )
    gen.add_argument(
        "--job",
        type=Path,
        default=None,
        help="also write a runnable job .yml listing every generated category",
    )
    gen.add_argument(
        "--force",
        action="store_true",
        help="overwrite existing category/job files instead of refusing",
    )
    gen.add_argument(
        "--verify",
        action="store_true",
        help="query the Wikidata Query Service for each class's live entity "
        "count, record it as a trailing comment in the blueprint, and refuse "
        "any class that resolves to zero entities (requires network)",
    )
    gen.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="HTTP cache directory for --verify (default: <out>/.http-cache)",
    )
    gen.add_argument(
        "--dump",
        type=Path,
        default=None,
        help="retarget every wikidata_class stub at this local Wikidata dump/slice "
        "(source.type wikidata-dump), so the blueprint acquires fully offline; "
        "see docs/wikidata-dump-runbook.md",
    )
    gen.add_argument(
        "--index",
        type=Path,
        default=None,
        help="dump-mode class-membership index beside the dump "
        "(default: the conventional <dump>.index.sqlite3 sidecar or a full scan)",
    )
    gen.add_argument(
        "--hydrate",
        default=None,
        help="dump-mode hydration profile every category opts into "
        "(e.g. 'default'; omit for label-only SPARQL parity)",
    )
    gen.add_argument(
        "--no-transitive",
        action="store_true",
        help="dump mode: select direct P31 instances only "
        "(default: P31/P279* transitive, matching build-slice)",
    )
    gen.add_argument(
        "--min-component-fraction",
        type=float,
        default=None,
        help="write this corpus connectivity floor into the generated --job "
        "(relax it for a single-domain dump slice that legitimately fragments)",
    )
    gen.add_argument(
        "--min-provenance-completeness",
        type=float,
        default=None,
        help="write this corpus provenance floor into the generated --job",
    )
    gen.set_defaults(handler=_cmd_generate)

    package = subparsers.add_parser(
        "package",
        help="bundle a built corpus into a publishable .tar.gz + manifest",
    )
    package.add_argument(
        "source",
        type=Path,
        help="a job output root (out/<job>) or a corpus dataset directory",
    )
    package.add_argument(
        "--out",
        type=Path,
        default=Path("dist"),
        help="directory the archive and manifest are written to (default: dist/)",
    )
    package.add_argument(
        "--name",
        default=None,
        help="artifact name (default: the source directory's name)",
    )
    package.set_defaults(handler=_cmd_package)

    serve = subparsers.add_parser(
        "serve",
        help="launch the read-only web explorer for a built corpus",
    )
    serve.add_argument(
        "source",
        type=Path,
        help="a job output root (out/<job>) or a corpus dataset directory",
    )
    serve.add_argument(
        "--host", default="127.0.0.1", help="bind host (default: 127.0.0.1)"
    )
    serve.add_argument(
        "--port", type=int, default=8000, help="bind port (default: 8000)"
    )
    serve.set_defaults(handler=_cmd_serve)

    index_wikidata = subparsers.add_parser(
        "index-wikidata",
        help="build an on-disk class-membership index over a Wikidata dump",
    )
    index_wikidata.add_argument(
        "dump",
        type=Path,
        help="local Wikidata JSON dump (latest-all.json.gz/.bz2/.json)",
    )
    index_wikidata.add_argument(
        "--out",
        type=Path,
        default=None,
        help="path to write the index to (default: <dump>.index.sqlite3 beside it)",
    )
    index_wikidata.set_defaults(handler=_cmd_index_wikidata)

    build_slice_cmd = subparsers.add_parser(
        "build-slice",
        help="compose a real, bounded Wikidata dump slice from blueprint classes "
        "via the live APIs (polite; no ~90 GB download)",
    )
    build_slice_cmd.add_argument(
        "blueprints",
        nargs="+",
        type=Path,
        help="blueprint .yml file(s) whose wikidata_class stubs seed the slice "
        "(e.g. blueprints/food-drink.yml blueprints/language.yml)",
    )
    build_slice_cmd.add_argument(
        "--out",
        required=True,
        type=Path,
        help="path to write the slice to; name it with a YYYYMMDD so provenance "
        "records the data's date (e.g. out/wikidata/wikidata-20260712-slice.json.gz)",
    )
    build_slice_cmd.add_argument(
        "--limit-per-class",
        type=int,
        default=200,
        help="max members to draw from each class (politeness bound; default: 200)",
    )
    build_slice_cmd.add_argument(
        "--no-transitive",
        action="store_true",
        help="select direct P31 instances only (default: P31/P279* transitive)",
    )
    build_slice_cmd.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="HTTP cache directory (default: <out-dir>/.http-cache)",
    )
    build_slice_cmd.set_defaults(handler=_cmd_build_slice)

    catalog = subparsers.add_parser(
        "catalog",
        help="print the corpus catalog (every category and its stats) as a table",
    )
    catalog.add_argument(
        "path",
        type=Path,
        help="a job's output root (holding catalog.json) or the catalog.json itself",
    )
    catalog.set_defaults(handler=_cmd_catalog)
    return parser


def _cmd_fetch(args: argparse.Namespace) -> int:
    try:
        spec = load_category(args.category)
    except CategorySpecError as exc:
        return _fail(str(exc))

    cache_dir: Path = args.cache_dir or args.out / ".http-cache"

    # Capture the HTTP client (if one is built) so its cache/retry counters can
    # be folded into the run report.
    client: HttpClient | None = None

    def http_factory() -> HttpClient:
        nonlocal client
        client = HttpClient(cache_dir=cache_dir)
        return client

    try:
        adapter = build_adapter(spec, http_factory=http_factory)
    except AdapterSelectionError as exc:
        return _fail(str(exc))

    def http_stats() -> HttpStats:
        return client.stats if client is not None else HttpStats()

    out_path: Path = args.out / f"{spec.id}.jsonl"
    report_path: Path = args.out / f"{spec.id}.report.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with out_path.open("w", encoding="utf-8") as handle:

            def sink(record: RawRecord) -> None:
                handle.write(record_to_jsonl(record))
                handle.write("\n")

            report = run_acquisition(adapter, spec, sink, http_stats=http_stats)
    except OSError as exc:
        return _fail(f"failed to fetch {spec.id!r}: {exc}")

    report.write(report_path)
    print(
        f"wrote {report.row_count} record(s) to {out_path} "
        f"({report.error_count} error(s)); report at {report_path}"
    )
    return 2 if report.row_count == 0 and report.error_count else 0


def _cmd_normalize(args: argparse.Namespace) -> int:
    try:
        spec = load_category(args.category)
    except CategorySpecError as exc:
        return _fail(str(exc))
    try:
        records = read_raw_records(args.raw)
    except PipelineError as exc:
        return _fail(str(exc))

    reconciler: WikidataReconciler | None = None
    if args.reconcile:
        cache_dir: Path = args.cache_dir or args.out / ".http-cache"
        reconciler = WikidataReconciler(HttpClient(cache_dir=cache_dir))

    getty_index: GettyIndex | None = None
    if args.getty_dump is not None:
        try:
            getty_index = GettyIndex.from_records(read_raw_records(args.getty_dump))
        except PipelineError as exc:
            return _fail(str(exc))

    try:
        result = normalize_records(
            records, spec, reconciler=reconciler, getty_index=getty_index
        )
        write_result(result, args.out)
    except (MapperError, CategorizeError, PipelineError) as exc:
        return _fail(str(exc))

    errors = validate_directory(args.out)
    if errors:
        for error in errors:
            print(str(error), file=sys.stderr)
        print(f"{len(errors)} validation error(s)", file=sys.stderr)
        return 1
    print(
        f"wrote {len(result.nodes)} node(s) and {len(result.edges)} edge(s) "
        f"to {args.out}; TSV valid"
    )
    return 0


def _cmd_validate(args: argparse.Namespace) -> int:
    directory: Path = args.directory
    if not directory.is_dir():
        return _fail(f"{directory} is not a directory")
    errors = validate_directory(directory)
    if not errors:
        print(f"{directory}: TSV files valid")
        return 0
    for error in errors:
        print(str(error), file=sys.stderr)
    print(f"{len(errors)} validation error(s)", file=sys.stderr)
    return 1


def _cmd_metrics(args: argparse.Namespace) -> int:
    directory: Path = args.directory
    if not directory.is_dir():
        return _fail(f"{directory} is not a directory")
    metrics = metrics_for_dataset(directory)
    if args.out is not None:
        out_path: Path = args.out
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(to_json(metrics) + "\n", encoding="utf-8")
        print(f"wrote metrics to {out_path}")
    print(render_summary(metrics))
    return 0


def _cmd_link(args: argparse.Namespace) -> int:
    directory: Path = args.directory
    if not directory.is_dir():
        return _fail(f"{directory} is not a directory")
    try:
        dimensions = _parse_dimensions(args.dimensions)
    except ValueError as exc:
        return _fail(str(exc))

    nodes, edges = read_dataset(directory)
    if not nodes:
        return _fail(f"{directory} holds no node TSV files to link")

    run = run_linkers(nodes, edges, select_linkers(dimensions))
    write_result(
        NormalizationResult(nodes=run.nodes, edges=run.edges), args.out
    )

    out_dir: Path = args.out
    metrics = metrics_for_dataset(out_dir)
    metrics_path = out_dir / "metrics.json"
    metrics_path.write_text(to_json(metrics) + "\n", encoding="utf-8")

    errors = validate_directory(out_dir)
    if errors:
        for error in errors:
            print(str(error), file=sys.stderr)
        print(f"{len(errors)} validation error(s)", file=sys.stderr)
        return 1

    report = run.report
    print(
        f"linked {report.input_edges} -> {report.output_edges} edge(s) "
        f"(+{report.inferred_edges} inferred, +{report.created_nodes} node(s)) "
        f"on {', '.join(report.dimensions)}; metrics at {metrics_path}"
    )
    print(render_summary(metrics))
    return 0


def _cmd_enrich(args: argparse.Namespace) -> int:
    directory: Path = args.directory
    if not directory.is_dir():
        return _fail(f"{directory} is not a directory")
    try:
        dimensions = _parse_dimensions(args.dimensions)
        profile = get_profile(args.profile)
    except (ValueError, UnknownProfileError) as exc:
        return _fail(str(exc))
    languages = tuple(
        code.strip() for code in args.languages.split(",") if code.strip()
    )

    nodes, edges = read_dataset(directory)
    if not nodes:
        return _fail(f"{directory} holds no node TSV files to enrich")

    stats = DumpReadStats()
    try:
        lookup = build_qid_lookup(args.dump, corpus_qids(nodes), stats=stats)
    except WikidataDumpError as exc:
        return _fail(str(exc))

    enriched, report = enrich_nodes(
        nodes,
        lookup,
        profile=profile,
        languages=languages,
        dump_version=resolve_dump_version(args.dump),
    )

    run = run_linkers(enriched, edges, select_linkers(dimensions))
    write_result(NormalizationResult(nodes=run.nodes, edges=run.edges), args.out)

    out_dir: Path = args.out
    metrics = metrics_for_dataset(out_dir)
    metrics_path = out_dir / "metrics.json"
    metrics_path.write_text(to_json(metrics) + "\n", encoding="utf-8")

    errors = validate_directory(out_dir)
    if errors:
        for error in errors:
            print(str(error), file=sys.stderr)
        print(f"{len(errors)} validation error(s)", file=sys.stderr)
        return 1

    link = run.report
    print(report.render())
    print(
        f"linked {link.input_edges} -> {link.output_edges} edge(s) "
        f"(+{link.inferred_edges} inferred, +{link.created_nodes} node(s)) "
        f"on {', '.join(link.dimensions)}; metrics at {metrics_path}"
    )
    print(render_summary(metrics))
    return 0


def _cmd_to_neo4j(args: argparse.Namespace) -> int:
    directory: Path = args.directory
    if not directory.is_dir():
        return _fail(f"{directory} is not a directory")
    try:
        if args.mode == "admin":
            plan = generate_import_script(directory, out_dir=args.out)
            print(
                f"wrote neo4j-admin import script to {plan.script_path} "
                f"({len(plan.node_files)} node file(s), "
                f"{len(plan.edge_files)} edge file(s))"
            )
        else:
            report = load_corpus(
                directory, constraints=not args.no_constraints
            )
            print(
                f"applied {len(report.constraints)} constraint/index "
                f"statement(s) and ran {len(report.statements)} LOAD CSV "
                f"statement(s) against Neo4j"
            )
    except (
        AdminImportError,
        Neo4jConfigError,
        Neo4jDriverNotInstalled,
    ) as exc:
        return _fail(str(exc))
    return 0


def _cmd_neo4j_counts(args: argparse.Namespace) -> int:
    try:
        summary = count_summary()
    except (Neo4jConfigError, Neo4jDriverNotInstalled) as exc:
        return _fail(str(exc))
    print(f"node counts by label (total {summary.node_total}):")
    for label, count in summary.nodes_by_label.items():
        print(f"  {label}: {count}")
    print(f"edge counts by type (total {summary.edge_total}):")
    for edge_type, count in summary.edges_by_type.items():
        print(f"  {edge_type}: {count}")
    return 0


def _cmd_from_neo4j(args: argparse.Namespace) -> int:
    try:
        result = export_to_tsv(args.out)
    except (
        Neo4jConfigError,
        Neo4jDriverNotInstalled,
        Neo4jExportError,
    ) as exc:
        return _fail(str(exc))
    print(
        f"exported {result.node_count} node(s) and "
        f"{result.edge_count} edge(s) to {args.out}"
    )
    return 0


def _cmd_to_datalog(args: argparse.Namespace) -> int:
    try:
        engines = engines_for_choice(args.engine)
        result = export_dataset(
            args.directory, args.out, engines, include_rules=args.rules
        )
    except DatalogExportError as exc:
        return _fail(str(exc))

    rules_note = " with rules" if args.rules else ""
    print(
        f"projected {result.fact_count} fact(s){rules_note} to {args.out} "
        f"for {', '.join(engine.value for engine in engines)}"
    )
    for engine in engines:
        label = "load" if engine is Engine.SWIPL else "run"
        print(f"  {label}: {result.load_hint(engine)}")
    return 0


def _cmd_datalog_materialize(args: argparse.Namespace) -> int:
    exclude = tuple(args.exclude or ())
    known_heads = {rule.name for rule in RULES}
    unknown = [name for name in exclude if name not in known_heads]
    if unknown:
        return _fail(
            f"--exclude names unknown rule head(s): {', '.join(sorted(unknown))} "
            f"(known: {', '.join(sorted(known_heads))})"
        )
    rules = tuple(rule for rule in RULES if rule.name not in exclude)

    try:
        facts = collect_facts(args.directory)
        summary = summarize(facts, rules)
    except (DatalogExportError, MaterializeError) as exc:
        return _fail(str(exc))

    print(f"base relations read ({len(summary.base_relations)}):")
    for predicate, count in summary.base_relations.items():
        print(f"  {predicate}: {count}")
    print(f"derived relations (total {summary.derived_total}):")
    for predicate, count in summary.derived_relations.items():
        print(f"  {predicate}: {count}")
    if exclude:
        print(f"engine-only (not materialised): {', '.join(sorted(exclude))}")
    if args.json is not None:
        payload = summary.to_json()
        if exclude:
            payload["engine_only"] = sorted(exclude)
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote manifest to {args.json}")
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    try:
        job = load_job(args.job)
    except JobConfigError as exc:
        return _fail(str(exc))

    if args.stages is not None:
        job = replace(job, stages=tuple(s for s in STAGE_ORDER if s in args.stages))

    force_ids: frozenset[str] | None = None
    if args.since is not None:
        outcome = _select_refresh(job, args.since)
        if isinstance(outcome, int):  # nothing stale, or a parse error
            return outcome
        force_ids = outcome

    # The full pipeline assembles the stitched, linked, exported corpus (US-008);
    # a subset just runs those per-category stages, leaving the islands disjoint.
    if set(job.stages) == set(STAGE_ORDER):
        try:
            build = build_corpus(
                job,
                force=args.force,
                force_ids=force_ids,
                workers=args.workers,
                qa=corpus_qa_policy(job),
                min_component_fraction=corpus_component_fraction(job),
            )
        except CorpusBuildError as exc:
            return _fail(str(exc))
        print(_render_corpus(build))
        return 0

    run = run_job(job, force=args.force, force_ids=force_ids, workers=args.workers)
    print(f"job {run.name}: {len(run.categories)} category(ies)")
    print(run.summary)
    return 1 if run.failures else 0


def _select_refresh(job: Job, since_text: str) -> frozenset[str] | int:
    """Grade *job*'s categories against ``--since``, logging the decision.

    Returns the set of stale category ids to force-refresh, or an exit code when
    the duration is invalid (``2``) or every category is already fresh (``0``).
    A line is always appended to the refresh log so the scheduled run is audited.
    """
    try:
        since = parse_duration(since_text)
    except DurationError as exc:
        return _fail(str(exc))

    now = datetime.now(UTC)
    selection = select_stale(
        job.categories, load_catalog(job.output_root), since, now=now
    )
    log_path = write_refresh_log(job.output_root, selection, now=now)
    print(f"{selection.summary}; logged to {log_path}")
    if not selection.refreshed:
        print("nothing to refresh — every category is up to date")
        return 0
    print(f"refreshing: {', '.join(selection.refreshed)}")
    return frozenset(selection.refreshed)


def _render_corpus(build: CorpusBuild) -> str:
    """Summarise a finished corpus build for the CLI."""
    metrics = build.metrics
    qa = "ok" if build.qa.ok else f"{len(build.qa.violations)} violation(s)"
    return "\n".join(
        [
            f"corpus {build.name}: {metrics.node_count} node(s), "
            f"{metrics.edge_count} edge(s) -> {build.dataset_dir}",
            f"  connectivity: largest component "
            f"{metrics.largest_component_fraction:.0%} "
            f"({'connected' if build.connected else 'FRAGMENTED'})",
            f"  qa: {qa}",
            f"  neo4j: {build.import_plan.script_path}",
            f"  datalog: {build.datalog.fact_count} fact(s) -> "
            f"{build.datalog.programs[Engine.SWIPL].parent}",
        ]
    )


def _cmd_qa(args: argparse.Namespace) -> int:
    directory: Path = args.directory
    if not directory.is_dir():
        return _fail(f"{directory} is not a directory")
    thresholds = GateThresholds(
        min_rows=args.min_rows,
        max_duplicate_rate=args.max_duplicate_rate,
        min_provenance_completeness=args.min_provenance_completeness,
        max_dangling_edge_rate=args.max_dangling_edge_rate,
        max_unreconciled_rate=args.max_unreconciled_rate,
        min_linguascrape_provenance_completeness=(
            args.min_linguascrape_provenance_completeness
        ),
        max_linguascrape_duplicate_rate=args.max_linguascrape_duplicate_rate,
        max_linguascrape_dangling_edge_rate=args.max_linguascrape_dangling_edge_rate,
        max_linguascrape_unreconciled_rate=args.max_linguascrape_unreconciled_rate,
    )
    report = evaluate_directory(directory, thresholds)
    if args.out is not None:
        report.write(args.out)
        print(f"wrote QA report to {args.out}")
    if args.markdown_out is not None:
        report.write_markdown(args.markdown_out)
        print(f"wrote QA report to {args.markdown_out}")
    print(report.render_summary())
    if report.violations and args.fail_on_violation:
        return 1
    return 0


def _cmd_generate(args: argparse.Namespace) -> int:
    count_fn = None
    if args.verify:
        from functools import partial

        from culturescrape.acquire.wikidata import fetch_count

        cache_dir: Path = args.cache_dir or args.out / ".http-cache"
        count_fn = partial(fetch_count, HttpClient(cache_dir=cache_dir))
    dump: DumpSource | None = None
    if args.dump is not None:
        dump = DumpSource(
            path=args.dump,
            index=args.index,
            hydrate=args.hydrate,
            transitive=not args.no_transitive,
        )
    elif args.index is not None or args.hydrate is not None:
        return _fail("--index/--hydrate require --dump (dump mode)")
    try:
        result = generate(
            args.blueprint,
            args.out,
            job=args.job,
            force=args.force,
            verify=args.verify,
            count_fn=count_fn,
            dump=dump,
            min_component_fraction=args.min_component_fraction,
            min_provenance_completeness=args.min_provenance_completeness,
        )
    except (BlueprintError, WikidataSparqlError) as exc:
        return _fail(str(exc))
    print(
        f"generated {len(result.categories)} category spec(s) to {args.out}"
    )
    if result.job is not None:
        print(f"  job: {result.job} (run: culturescrape run {result.job})")
    return 0


def _cmd_package(args: argparse.Namespace) -> int:
    try:
        result = package_corpus(args.source, args.out, name=args.name)
    except PackageError as exc:
        return _fail(str(exc))
    print(
        f"packaged {result.name}: {len(result.files)} file(s), "
        f"{result.total_bytes} byte(s) -> {result.archive}"
    )
    print(f"  manifest: {result.manifest} ({result.digest})")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    try:
        from culturescrape.explorer import create_app, run_server
        from culturescrape.explorer.data import CorpusError
    except ImportError:
        return _fail(
            "the web explorer needs the 'gui' extra: "
            "pip install 'culturescrape[gui]'"
        )
    source: Path = args.source
    if not source.is_dir():
        return _fail(f"{source} is not a directory")
    try:
        app = create_app(source)
    except CorpusError as exc:
        return _fail(str(exc))
    print(f"serving {source} at http://{args.host}:{args.port}")
    run_server(app, host=args.host, port=args.port)
    return 0


def _cmd_index_wikidata(args: argparse.Namespace) -> int:
    dump: Path = args.dump
    out: Path = args.out or default_index_path(dump)
    stats = DumpReadStats()
    try:
        index = build_index(dump, out, stats=stats)
    except WikidataDumpError as exc:
        return _fail(str(exc))
    print(
        f"indexed {stats.entities} entit(ies) ({stats.skipped} skipped) from "
        f"{dump} (v{index.fingerprint.version}): "
        f"{index.class_count} class(es) with members, "
        f"{index.subclass_parent_count} subclass parent(s) -> {out}"
    )
    return 0


def _cmd_build_slice(args: argparse.Namespace) -> int:
    transitive = not args.no_transitive
    classes: list[SliceClass] = []
    try:
        for blueprint in args.blueprints:
            classes.extend(blueprint_classes(blueprint, transitive=transitive))
    except WikidataSliceError as exc:
        return _fail(str(exc))

    out: Path = args.out
    cache_dir: Path = args.cache_dir or out.parent / ".http-cache"
    http = HttpClient(cache_dir=cache_dir)
    try:
        manifest = build_slice(
            http, classes, out, limit_per_class=args.limit_per_class
        )
    except WikidataSliceError as exc:
        return _fail(str(exc))

    print(
        f"wrote {manifest.entity_total} entit(ies) from {len(classes)} class(es) "
        f"to {out} (v{manifest.dump_version}); "
        f"manifest at {out.with_name(out.name + '.manifest.json')}"
    )
    for domain, detail in manifest.as_dict()["domains"].items():
        print(f"  {domain}: {detail['obtained']} entit(ies)")
    stats = http.stats
    print(
        f"  http: {stats.cache_hits} cache hit(s), "
        f"{stats.cache_misses} miss(es), {stats.retries} retr(ies)"
    )
    return 2 if manifest.entity_total == 0 else 0


def _cmd_catalog(args: argparse.Namespace) -> int:
    path: Path = args.path
    if not path.exists():
        return _fail(f"{path} does not exist")
    print(render_table(load_catalog(path)))
    return 0


def _parse_dimensions(value: str) -> list[Dimension]:
    """Parse a comma-separated ``--dimensions`` value into :class:`Dimension`s.

    Raises:
        ValueError: If the value is empty or names an unknown dimension.
    """
    tokens = [token.strip() for token in value.split(",") if token.strip()]
    if not tokens:
        raise ValueError("no dimensions given")
    known = {dim.value for dim in Dimension}
    dimensions: list[Dimension] = []
    for token in tokens:
        if token not in known:
            raise ValueError(
                f"unknown dimension {token!r} (choose from {', '.join(sorted(known))})"
            )
        dimensions.append(Dimension(token))
    return dimensions


def _fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
