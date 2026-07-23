"""Drive a :class:`~culturescrape.orchestrate.jobs.Job` end to end.

A job names categories and the ordered stages
``acquire -> normalize -> link -> export`` (see ``PLAN.md``). Wiring those by
hand means knowing which module each stage lives in and feeding one stage's
output directory to the next. :func:`run_job` is that wiring: for every category
in the job it runs each requested stage in order, threading the prior stage's
output to the next, and records per-stage timing and row counts.

Each stage writes under ``<output_root>/<stage>/<category-id>/`` so a job's
outputs are laid out predictably and a partially-completed run leaves every
finished stage on disk.

Categories are independent, so they run **concurrently** up to a configurable
``workers`` cap — large corpora finish in roughly the time of their slowest
category rather than the sum of them all. Politeness is preserved across workers
because every category's network adapter shares one
:class:`~culturescrape.acquire.http.HttpClient`, whose per-host rate limit is
enforced globally (see :mod:`culturescrape.acquire.http`).

A stage that fails does **not** abort the rest of the job: the failure is caught,
that category stops at the broken stage, and the remaining categories run to
completion. :func:`run_job` always returns a :class:`JobRun` whose per-category
status (and :attr:`JobRun.ok`) summarises what succeeded and what failed; the CLI
turns a non-empty failure list into a non-zero exit. Every completed stage's
output — for failed and successful categories alike — is left intact.

Re-running is incremental. Before a stage runs, the runner fingerprints its
inputs (the category spec plus the upstream stage's output) and compares that to
the fingerprint the last run recorded in the stage's output directory. An
unchanged stage is skipped — so a second run of an untouched job touches no
network and reports every stage "up to date", while changed source data
re-normalizes and re-links only the categories it affects. Passing ``force``
recomputes every stage regardless. See
:mod:`culturescrape.orchestrate.fingerprint`.

The default run is offline and deterministic: no reconciliation or Getty
anchoring is performed, so the same inputs always produce the same TSV. Network
adapters are built lazily with an HTTP cache under the job's output root, so a
``dump`` run never opens a connection.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.factory import build_adapter
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.records import RawRecord
from culturescrape.acquire.run import run_acquisition
from culturescrape.acquire.writer import record_to_jsonl
from culturescrape.datalog.export import engines_for_choice, export_dataset
from culturescrape.ontology.metrics import (
    metrics_for_dataset,
    read_dataset,
    to_json,
)
from culturescrape.ontology.registry import Dimension
from culturescrape.ontology.run import run_linkers, select_linkers
from culturescrape.orchestrate.catalog import update_catalog
from culturescrape.orchestrate.fingerprint import (
    StageManifest,
    combine,
    fingerprint_directory,
    fingerprint_spec,
)
from culturescrape.orchestrate.jobs import Job
from culturescrape.orchestrate.qa import (
    QA_REPORT_MD_SUFFIX,
    QA_REPORT_SUFFIX,
    QaPolicy,
    evaluate_directory,
)
from culturescrape.schema.pipeline import (
    NormalizationResult,
    normalize_records,
    read_raw_records,
    write_result,
)
from culturescrape.schema.validate import validate_directory

#: Logger pipeline runs emit per-stage events on.
LOGGER = logging.getLogger("culturescrape.orchestrate.runner")

#: Builds the adapter that acquires a category's raw records.
AdapterFactory = Callable[[CategorySpec], SourceAdapter]

#: Default cap on categories processed concurrently when none is requested.
DEFAULT_WORKERS = 4


class PipelineRunError(RuntimeError):
    """Raised when a stage fails, naming the category and stage that broke."""


@dataclass(frozen=True)
class StageResult:
    """What one stage produced for one category.

    Attributes:
        category_id: The category the stage ran for.
        stage: The stage name (one of the job's ordered stages).
        rows: Rows the stage produced — records acquired, node+edge rows written,
            or facts projected, depending on the stage. For a skipped stage this
            is the count the original run recorded.
        seconds: Wall-clock duration of the stage.
        output_dir: Where the stage wrote (or previously wrote) its output.
        skipped: Whether the stage was skipped because its inputs were unchanged
            ("up to date"). A skipped stage does no work — and, for ``acquire``,
            opens no network connection.
    """

    category_id: str
    stage: str
    rows: int
    seconds: float
    output_dir: Path
    skipped: bool = False


@dataclass(frozen=True)
class CategoryRun:
    """The outcome of running one category through the job's stages.

    Attributes:
        category_id: The category that ran.
        stages: The stage results recorded before the category finished or
            failed, in execution order. A failed category keeps the results of
            the stages that completed before the broken one.
        error: ``None`` if every requested stage succeeded; otherwise the
            failure message (the stage that broke is named in it).
    """

    category_id: str
    stages: tuple[StageResult, ...]
    error: str | None = None

    @property
    def ok(self) -> bool:
        """Whether the category completed every stage without failing."""
        return self.error is None


@dataclass(frozen=True)
class JobRun:
    """The results of running a whole job, one :class:`CategoryRun` per category."""

    name: str
    categories: tuple[CategoryRun, ...]

    @property
    def stages(self) -> tuple[StageResult, ...]:
        """Every stage result across all categories, in category order."""
        return tuple(s for category in self.categories for s in category.stages)

    @property
    def ok(self) -> bool:
        """Whether every category completed without a failure."""
        return all(category.ok for category in self.categories)

    @property
    def failures(self) -> tuple[CategoryRun, ...]:
        """The categories that failed, in category order."""
        return tuple(category for category in self.categories if not category.ok)

    @property
    def up_to_date(self) -> bool:
        """Whether every stage was skipped — the whole job was already current."""
        stages = self.stages
        return bool(stages) and all(s.skipped for s in stages)

    @property
    def summary(self) -> str:
        """A one-line-per-category status report (``ok``/``FAILED`` + detail)."""
        lines = []
        for category in self.categories:
            if category.ok:
                rows = sum(s.rows for s in category.stages)
                lines.append(f"  {category.category_id}: ok ({rows} rows)")
            else:
                lines.append(f"  {category.category_id}: FAILED — {category.error}")
        return "\n".join(lines)


def run_job(
    job: Job,
    *,
    adapter_factory: AdapterFactory | None = None,
    logger: logging.Logger = LOGGER,
    force: bool = False,
    force_ids: frozenset[str] | None = None,
    workers: int = DEFAULT_WORKERS,
    qa: QaPolicy | None = None,
) -> JobRun:
    """Run every category in *job* through its requested stages, in order.

    Each category is driven independently through ``job.stages``; a stage's
    output directory feeds the next. *adapter_factory* builds the acquisition
    adapter for a category (defaulting to :func:`build_adapter` with one shared
    HTTP client and cache under the job's output root) — pass a stub to run
    offline in tests.

    Categories run concurrently on up to *workers* threads (clamped to at least
    one, and to the number of categories). The shared HTTP client enforces its
    per-host rate limit across them, so concurrency stays polite. A category that
    fails is recorded and skipped over — the others run to completion — so a
    single bad source never aborts the corpus.

    A stage whose inputs match the fingerprint recorded by the previous run is
    skipped (reported "up to date"), so re-running an untouched job does no work
    and opens no connection. Set *force* to recompute every stage of every
    category regardless; pass *force_ids* to recompute only those named
    categories (used by scheduled ``--since`` refreshes to re-fetch the stale
    categories while leaving the fresh ones to the fingerprint skip).

    Once a category has a dataset (its ``link`` or ``normalize`` output), the
    *qa* policy's quality gates are evaluated over it and a report is written to
    ``<output_root>/qa/<category-id>.qa.json`` (see
    :mod:`culturescrape.orchestrate.qa`). By default the report is informational;
    set ``qa.fail_on_violation`` to mark a category that trips a gate as failed,
    so a low-quality scrape never reaches the catalog clean.

    After the run, the corpus catalog at ``<output_root>/catalog.json`` is
    upserted with one entry per category that produced a dataset (see
    :mod:`culturescrape.orchestrate.catalog`), so the corpus stays discoverable.

    Returns a :class:`JobRun` whose :class:`CategoryRun` per category records the
    stages run or skipped and whether the category failed; inspect
    :attr:`JobRun.ok` and :attr:`JobRun.failures` for the outcome.
    """
    factory = adapter_factory or _default_adapter_factory(job)
    policy = qa if qa is not None else QaPolicy()
    cap = max(1, min(workers, len(job.categories) or 1))

    def run_one(spec: CategorySpec) -> CategoryRun:
        forced = force or (force_ids is not None and spec.id in force_ids)
        return _run_category(job, spec, factory, logger, force=forced, qa=policy)

    with ThreadPoolExecutor(max_workers=cap) as pool:
        categories = tuple(pool.map(run_one, job.categories))
    run = JobRun(name=job.name, categories=categories)
    update_catalog(job, run, now=datetime.now(UTC))
    _log_outcome(run, logger)
    return run


def _log_outcome(run: JobRun, logger: logging.Logger) -> None:
    """Emit the final per-category summary, flagging any failures."""
    if run.up_to_date:
        logger.info(
            "job up to date: job=%s (every stage skipped)",
            run.name,
            extra={"event": "job.up_to_date", "job": run.name},
        )
    failures = run.failures
    level = logging.ERROR if failures else logging.INFO
    logger.log(
        level,
        "job %s: job=%s categories=%d failed=%d\n%s",
        "completed with failures" if failures else "complete",
        run.name,
        len(run.categories),
        len(failures),
        run.summary,
        extra={
            "event": "job.done",
            "job": run.name,
            "categories": len(run.categories),
            "failed": len(failures),
        },
    )


def _run_category(
    job: Job,
    spec: CategorySpec,
    factory: AdapterFactory,
    logger: logging.Logger,
    *,
    force: bool,
    qa: QaPolicy,
) -> CategoryRun:
    """Run one category through the job's stages, threading outputs forward.

    Each stage is skipped when its recorded input fingerprint still matches,
    unless *force* is set. Output directories are deterministic, so a skipped
    stage still threads its inputs forward to the next stage. After the stages,
    the *qa* gates are evaluated over the category's dataset. A stage or QA
    failure is caught and returned as :attr:`CategoryRun.error` rather than
    raised, so a sibling category's run is unaffected; the stages that finished
    first are kept.
    """
    results: list[StageResult] = []
    try:
        _run_category_stages(job, spec, factory, logger, results, force=force)
        _run_qa(job, spec, results, qa, logger)
    except Exception as exc:  # noqa: BLE001 - isolate this category's failure
        logger.error(
            "category failed: job=%s category=%s: %s",
            job.name,
            spec.id,
            exc,
            extra={"event": "category.failed", "category": spec.id},
        )
        return CategoryRun(category_id=spec.id, stages=tuple(results), error=str(exc))
    return CategoryRun(category_id=spec.id, stages=tuple(results))


def _run_qa(
    job: Job,
    spec: CategorySpec,
    results: list[StageResult],
    qa: QaPolicy,
    logger: logging.Logger,
) -> None:
    """Grade the category's dataset against *qa* and write a report.

    The dataset graded is the category's ``link`` output if it has one, else its
    ``normalize`` output — the same dataset the catalog measures. A category that
    produced neither has nothing to grade and is skipped. The report is always
    written to ``<output_root>/qa/<category-id>.qa.json`` (machine view) and
    ``<category-id>.qa.md`` (human view); when ``qa.fail_on_violation`` is set and
    a gate trips, a :class:`PipelineRunError` is raised so the category is
    recorded as failed.
    """
    by_stage = {result.stage: result for result in results}
    dataset = by_stage.get("link") or by_stage.get("normalize")
    if dataset is None or not dataset.output_dir.is_dir():
        return

    report = evaluate_directory(dataset.output_dir, qa.thresholds)
    qa_dir = job.output_root / "qa"
    report.write(qa_dir / f"{spec.id}{QA_REPORT_SUFFIX}")
    report.write_markdown(qa_dir / f"{spec.id}{QA_REPORT_MD_SUFFIX}")

    level = logging.WARNING if report.violations else logging.INFO
    logger.log(
        level,
        "qa %s: job=%s category=%s violations=%d\n%s",
        "violations" if report.violations else "ok",
        job.name,
        spec.id,
        len(report.violations),
        report.render_summary(),
        extra={
            "event": "qa.done",
            "category": spec.id,
            "ok": report.ok,
            "violations": len(report.violations),
        },
    )
    if qa.fail_on_violation and report.violations:
        names = ", ".join(gate.label for gate in report.violations)
        raise PipelineRunError(f"{spec.id}: QA gates failed: {names}")


def _run_category_stages(
    job: Job,
    spec: CategorySpec,
    factory: AdapterFactory,
    logger: logging.Logger,
    results: list[StageResult],
    *,
    force: bool,
) -> None:
    """Drive *spec* through every stage, appending each :class:`StageResult`.

    Raises on the first stage that fails; :func:`_run_category` catches it. The
    *results* list is mutated in place so a caught failure keeps the stages that
    already completed.
    """
    spec_fp = fingerprint_spec(spec)
    acquire_dir: Path | None = None
    dataset_dir: Path | None = None

    for stage in job.stages:
        out_dir = job.output_dir(stage) / spec.id
        input_fp = _stage_fingerprint(stage, spec, spec_fp, acquire_dir, dataset_dir)
        skipped = not force and _is_up_to_date(out_dir, input_fp)

        logger.info(
            "stage start: job=%s category=%s stage=%s%s",
            job.name,
            spec.id,
            stage,
            " (up to date)" if skipped else "",
            extra={
                "event": "stage.start",
                "category": spec.id,
                "stage": stage,
                "skipped": skipped,
            },
        )
        start = perf_counter()
        if skipped:
            manifest = StageManifest.read(out_dir)
            rows = manifest.rows if manifest else 0
        else:
            rows = _execute(stage, job, spec, factory, acquire_dir, dataset_dir)
            StageManifest(stage=stage, input_fingerprint=input_fp, rows=rows).write(
                out_dir
            )

        seconds = perf_counter() - start
        # Thread this stage's output forward whether it ran or was skipped.
        if stage == "acquire":
            acquire_dir = out_dir
        elif stage in ("normalize", "link"):
            dataset_dir = out_dir

        logger.info(
            "stage %s: job=%s category=%s stage=%s rows=%d seconds=%.3f",
            "skipped" if skipped else "done",
            job.name,
            spec.id,
            stage,
            rows,
            seconds,
            extra={
                "event": "stage.skipped" if skipped else "stage.done",
                "category": spec.id,
                "stage": stage,
                "rows": rows,
                "seconds": seconds,
            },
        )
        results.append(
            StageResult(
                category_id=spec.id,
                stage=stage,
                rows=rows,
                seconds=seconds,
                output_dir=out_dir,
                skipped=skipped,
            )
        )


def _stage_fingerprint(
    stage: str,
    spec: CategorySpec,
    spec_fp: str,
    acquire_dir: Path | None,
    dataset_dir: Path | None,
) -> str:
    """Fingerprint *stage*'s inputs: the spec plus its upstream stage's output.

    ``acquire`` depends on the spec alone — so an unchanged spec skips the fetch
    with no network call. Each later stage folds in the content of the directory
    feeding it, so changed source data cascades down through normalize and link.
    """
    if stage == "acquire":
        return combine("acquire", spec_fp)
    if stage == "normalize":
        src = _require(acquire_dir, spec, stage, "acquire")
        return combine("normalize", spec_fp, fingerprint_directory(src))
    if stage == "link":
        src = _require(dataset_dir, spec, stage, "normalize")
        return combine("link", spec_fp, fingerprint_directory(src))
    src = _require(dataset_dir, spec, stage, "normalize")
    return combine("export", fingerprint_directory(src))


def _is_up_to_date(out_dir: Path, input_fp: str) -> bool:
    """Whether *out_dir* holds a prior run whose input fingerprint still matches."""
    manifest = StageManifest.read(out_dir)
    return manifest is not None and manifest.input_fingerprint == input_fp


def _execute(
    stage: str,
    job: Job,
    spec: CategorySpec,
    factory: AdapterFactory,
    acquire_dir: Path | None,
    dataset_dir: Path | None,
) -> int:
    """Run *stage* for *spec*, returning its row count.

    Wraps the stage body so any unexpected failure becomes a
    :class:`PipelineRunError` naming the category and stage that broke.
    """
    out_dir = job.output_dir(stage) / spec.id
    try:
        if stage == "acquire":
            return _acquire(out_dir, spec, factory)
        if stage == "normalize":
            src = _require(acquire_dir, spec, stage, "acquire")
            return _normalize(out_dir, spec, src / "records.jsonl")
        if stage == "link":
            return _link(out_dir, spec, _require(dataset_dir, spec, stage, "normalize"))
        return _export(out_dir, spec, _require(dataset_dir, spec, stage, "normalize"))
    except PipelineRunError:
        raise
    except Exception as exc:  # noqa: BLE001 - any stage failure halts the job
        raise PipelineRunError(f"{spec.id}: {stage} stage failed: {exc}") from exc


def _acquire(out_dir: Path, spec: CategorySpec, factory: AdapterFactory) -> int:
    """Fetch *spec* to ``<acquire>/<id>/records.jsonl``; return the row count."""
    raw_path = out_dir / "records.jsonl"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    adapter = factory(spec)
    with raw_path.open("w", encoding="utf-8") as handle:

        def sink(record: RawRecord) -> None:
            handle.write(record_to_jsonl(record))
            handle.write("\n")

        report = run_acquisition(adapter, spec, sink)
    report.write(out_dir / "records.report.json")
    return report.row_count


def _normalize(out_dir: Path, spec: CategorySpec, raw_path: Path) -> int:
    """Normalize *raw_path* into validated canonical TSV under ``<normalize>/<id>``."""
    records = read_raw_records(raw_path)
    result = normalize_records(records, spec)
    write_result(result, out_dir)
    _check_valid(out_dir, spec, "normalize")
    return len(result.nodes) + len(result.edges)


def _link(out_dir: Path, spec: CategorySpec, in_dir: Path) -> int:
    """Infer cross-dimensional edges over *in_dir* into ``<link>/<id>``."""
    nodes, edges = read_dataset(in_dir)
    dimensions = [Dimension(d) for d in spec.dimensions] or None
    run = run_linkers(nodes, edges, select_linkers(dimensions))
    write_result(NormalizationResult(nodes=run.nodes, edges=run.edges), out_dir)
    metrics = metrics_for_dataset(out_dir)
    (out_dir / "metrics.json").write_text(to_json(metrics) + "\n", encoding="utf-8")
    _check_valid(out_dir, spec, "link")
    return run.report.output_nodes + run.report.output_edges


def _export(out_dir: Path, spec: CategorySpec, in_dir: Path) -> int:
    """Project *in_dir* into Datalog programs under ``<export>/<id>``."""
    result = export_dataset(
        in_dir, out_dir, engines_for_choice("both"), include_rules=True
    )
    return result.fact_count


def _check_valid(out_dir: Path, spec: CategorySpec, stage: str) -> None:
    """Raise :class:`PipelineRunError` if *out_dir* holds invalid TSV."""
    errors = validate_directory(out_dir)
    if errors:
        detail = "; ".join(str(error) for error in errors)
        raise PipelineRunError(
            f"{spec.id}: {stage} produced invalid TSV "
            f"({len(errors)} error(s)): {detail}"
        )


def _require(value: Path | None, spec: CategorySpec, stage: str, needs: str) -> Path:
    """Return *value*, or raise if the stage's input was never produced."""
    if value is None:
        raise PipelineRunError(
            f"{spec.id}: {stage} stage requires the {needs} stage to run first"
        )
    return value


def _default_adapter_factory(job: Job) -> AdapterFactory:
    """Build adapters sharing one HTTP client (and cache) under the output root.

    Every category's network adapter draws from the *same*
    :class:`~culturescrape.acquire.http.HttpClient`, so its per-host rate limit
    is enforced across the concurrent workers rather than once per category.
    """
    client = HttpClient(cache_dir=job.output_root / ".http-cache")

    def factory(spec: CategorySpec) -> SourceAdapter:
        return build_adapter(spec, http_factory=lambda: client)

    return factory
