"""Assemble per-category outputs into one stitched, linked, exported corpus.

:func:`~culturescrape.orchestrate.runner.run_job` drives each category through the
pipeline *independently*, so the categories land as disjoint islands — the same
``out/<stage>/<category>/`` trees, never joined. This module is the step that
turns those islands into the deliverable a corpus is: one graph that proves the
whole system works end to end. Given a :class:`~culturescrape.orchestrate.jobs.Job`
it

#. **acquires + normalizes** every category (via :func:`run_job`, so the run is
   concurrent, incremental, and — with a fixture *adapter_factory* — fully
   offline);
#. **stitches** the per-category normalized datasets into one graph, collapsing
   entities that reconcile to the same ``csid`` (:func:`stitch_categories`) so
   categories interconnect through their shared entities;
#. **links** the combined graph across every dimension
   (:func:`~culturescrape.ontology.run.run_linkers`), minting the place / period /
   language hub nodes that wire the domains together;
#. writes the canonical corpus TSV and **validates** it;
#. measures **connectivity** (:mod:`culturescrape.ontology.metrics`) and grades
   the **quality gates** (:mod:`culturescrape.orchestrate.qa`), failing the build
   if the corpus fragments below :data:`DEFAULT_MIN_COMPONENT_FRACTION` or a gate
   trips; and
#. generates the **Neo4j** bulk-import script
   (:mod:`culturescrape.neo4j.admin_import`) and the **Datalog** ``.pl`` / ``.dl``
   exports (:mod:`culturescrape.datalog.export`) for the corpus.

The corpus dataset is written to ``<output_root>/corpus/`` (with ``metrics.json``,
``qa.json`` and the shared-entity report beside it); the Neo4j script lands under
``<output_root>/corpus-neo4j/`` and the Datalog programs under
``<output_root>/corpus-datalog/``, both kept out of the dataset directory so the
metrics and QA passes read only the canonical ``nodes/`` and ``edges/`` files.

The default QA policy (:data:`DEFAULT_CORPUS_QA`) relaxes only the provenance gate
relative to the strict per-file defaults: a linked corpus legitimately carries
synthesized structural nodes (category / type) and inferred hub nodes and edges
(places, periods, the linker-minted relations) that have no external source URL,
so requiring *every* row to be fully sourced would reject a healthy corpus. The
correctness gates that matter for linking — no duplicates, no dangling edges —
stay strict.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from pathlib import Path

from culturescrape.datalog.export import (
    ExportResult,
    engines_for_choice,
    export_dataset,
)
from culturescrape.neo4j.admin_import import (
    DEFAULT_DATABASE,
    ImportPlan,
    generate_import_script,
)
from culturescrape.ontology.metrics import (
    GraphMetrics,
    metrics_for_dataset,
    read_dataset,
    render_summary,
    to_json,
)
from culturescrape.ontology.reconcile_qid import reconcile_shared_qids
from culturescrape.ontology.run import run_linkers, select_linkers
from culturescrape.ontology.stitch import (
    SharedEntity,
    render_report,
    stitch_categories,
)
from culturescrape.orchestrate.jobs import Job
from culturescrape.orchestrate.manifest import build_manifest
from culturescrape.orchestrate.qa import (
    GateThresholds,
    QaPolicy,
    QaReport,
    evaluate_directory,
)
from culturescrape.orchestrate.runner import (
    DEFAULT_WORKERS,
    AdapterFactory,
    JobRun,
    run_job,
)
from culturescrape.orchestrate.tiers import (
    TieredManifest,
    TierQaReport,
    build_tier_manifest,
    evaluate_tiers,
)
from culturescrape.schema.pipeline import NormalizationResult, write_result
from culturescrape.schema.validate import validate_directory

#: Logger corpus builds emit their progress on.
LOGGER = logging.getLogger("culturescrape.orchestrate.corpus")

#: Subdirectory (under the job's output root) holding the canonical corpus TSV.
CORPUS_DIRNAME = "corpus"

#: Subdirectory holding the generated Neo4j bulk-import script and any copies.
NEO4J_DIRNAME = "corpus-neo4j"

#: Subdirectory holding the generated Datalog (``.pl`` / ``.dl``) programs.
DATALOG_DIRNAME = "corpus-datalog"

#: Smallest fraction of nodes the largest connected component must hold for the
#: corpus to count as "one largely-connected component". The seed corpus links
#: every domain through shared place and period hubs, so it reaches ``1.0``; the
#: bound leaves headroom for a stray isolated node without passing a fragmented
#: graph.
DEFAULT_MIN_COMPONENT_FRACTION = 0.9

#: Quality-gate bounds for a linked corpus. Only the provenance gate is relaxed
#: from the strict per-file defaults — structural and inferred rows are sourceless
#: by design (see the module docstring) — while the duplicate and dangling-edge
#: gates stay strict because those would signal a real linking or dedup fault.
CORPUS_THRESHOLDS = GateThresholds(
    min_rows=5,
    max_duplicate_rate=0.0,
    min_provenance_completeness=0.5,
    max_dangling_edge_rate=0.0,
    max_unreconciled_rate=1.0,
)

#: The default corpus QA policy: the corpus thresholds, enforced (a violation
#: fails the build rather than merely being reported).
DEFAULT_CORPUS_QA = QaPolicy(thresholds=CORPUS_THRESHOLDS, fail_on_violation=True)

#: Stages :func:`build_corpus` runs per category; corpus-level linking and export
#: replace the per-category ``link`` / ``export`` stages a job may also declare.
_CORPUS_STAGES = ("acquire", "normalize")


class CorpusBuildError(RuntimeError):
    """Raised when a corpus cannot be acquired, validated, or fails its gates."""


def corpus_qa_policy(job: Job, base: QaPolicy = DEFAULT_CORPUS_QA) -> QaPolicy:
    """The QA policy for *job*, applying its ``min_provenance_completeness`` override.

    A job may relax the corpus provenance floor (e.g. a Pinakes-only corpus,
    whose rows carry no external ``source_url``; see ``docs/convergence-build.md``);
    every other threshold and the ``fail_on_violation`` flag come from *base*.
    """
    if job.min_provenance_completeness is None:
        return base
    return replace(
        base,
        thresholds=replace(
            base.thresholds,
            min_provenance_completeness=job.min_provenance_completeness,
        ),
    )


def corpus_component_fraction(job: Job) -> float:
    """The connectivity floor for *job*: its override, else the default."""
    if job.min_component_fraction is None:
        return DEFAULT_MIN_COMPONENT_FRACTION
    return job.min_component_fraction


@dataclass(frozen=True)
class CorpusBuild:
    """Everything one :func:`build_corpus` run produced.

    Attributes:
        name: The job the corpus was built from.
        dataset_dir: Where the canonical corpus TSV (``nodes/`` + ``edges/``)
            was written.
        job_run: The per-category acquire/normalize run behind the corpus.
        metrics: Connectivity metrics over the stitched, linked graph.
        qa: The quality-gate report for the corpus dataset.
        import_plan: The generated Neo4j bulk-import command and script.
        datalog: The generated Datalog export (fact count + program paths).
        shared: Entities that ended up shared across categories.
        min_component_fraction: The connectivity bound the build was held to.
        tiers: The composition-by-tier manifest when the job opted into
            ``tiered_trust``, else ``None``.
        tier_qa: The per-tier QA report when the job opted into ``tiered_trust``,
            else ``None``.
    """

    name: str
    dataset_dir: Path
    job_run: JobRun
    metrics: GraphMetrics
    qa: QaReport
    import_plan: ImportPlan
    datalog: ExportResult
    shared: tuple[SharedEntity, ...]
    min_component_fraction: float
    tiers: TieredManifest | None = None
    tier_qa: TierQaReport | None = None

    @property
    def connected(self) -> bool:
        """Whether the largest component meets the connectivity bound."""
        return self.metrics.largest_component_fraction >= self.min_component_fraction


def build_corpus(
    job: Job,
    *,
    adapter_factory: AdapterFactory | None = None,
    force: bool = False,
    force_ids: frozenset[str] | None = None,
    workers: int = DEFAULT_WORKERS,
    qa: QaPolicy = DEFAULT_CORPUS_QA,
    min_component_fraction: float = DEFAULT_MIN_COMPONENT_FRACTION,
    database: str = DEFAULT_DATABASE,
    logger: logging.Logger = LOGGER,
) -> CorpusBuild:
    """Build the whole corpus for *job*: acquire, stitch, link, validate, export.

    Each category is acquired and normalized through :func:`run_job` (pass a stub
    *adapter_factory* to run offline); the normalized datasets are stitched into
    one graph, linked across every dimension, written as canonical TSV, and
    validated. *force* recomputes every category; *force_ids* recomputes only the
    named ones (the rest are skipped via fingerprint but still stitched from disk
    into the corpus), so a scheduled ``--since`` refresh re-fetches the stale
    categories while keeping the corpus whole. Connectivity and the *qa* gates
    are then measured: the build raises
    :class:`CorpusBuildError` if any category failed acquisition, the TSV is
    invalid, a quality gate trips (when ``qa.fail_on_violation``), or the largest
    connected component holds less than *min_component_fraction* of the nodes.
    Finally the Neo4j import script and the Datalog programs are generated.

    Returns a :class:`CorpusBuild` with the dataset location, the connectivity
    metrics, the QA report, and the two export handles.
    """
    run = _acquire_and_normalize(
        job, adapter_factory, force, force_ids, workers, logger
    )

    results = _read_normalized(run)
    if not results:
        raise CorpusBuildError(
            f"corpus {job.name!r}: no category produced a normalized dataset"
        )
    stitched = stitch_categories(results)
    linked = run_linkers(stitched.nodes, stitched.edges, select_linkers(None))

    final_nodes, final_edges = linked.nodes, linked.edges
    if job.reconcile_shared_qids:
        reconciled = reconcile_shared_qids(final_nodes, final_edges)
        final_nodes, final_edges = reconciled.nodes, reconciled.edges
        logger.info(
            "corpus %s: collapsed %d node(s) sharing a QID across types",
            job.name,
            reconciled.collapsed,
            extra={"event": "corpus.reconcile_qid", "job": job.name},
        )

    dataset_dir = job.output_root / CORPUS_DIRNAME
    write_result(
        NormalizationResult(nodes=final_nodes, edges=final_edges), dataset_dir
    )
    _validate(job, dataset_dir)

    metrics = metrics_for_dataset(dataset_dir)
    (dataset_dir / "metrics.json").write_text(to_json(metrics) + "\n", encoding="utf-8")
    build_manifest(job.name, final_nodes, final_edges).write(
        dataset_dir / "manifest.json"
    )
    report = evaluate_directory(dataset_dir, qa.thresholds)
    report.write(dataset_dir / "qa.json")
    (dataset_dir / "shared.txt").write_text(
        render_report(stitched.shared) + "\n", encoding="utf-8"
    )

    tiers: TieredManifest | None = None
    tier_qa: TierQaReport | None = None
    if job.tiered_trust:
        tiers = build_tier_manifest(job.name, final_nodes, final_edges)
        tiers.write(dataset_dir / "tiers.json")
        tier_qa = evaluate_tiers(final_nodes, final_edges, job.tier_gates)
        tier_qa.write(dataset_dir / "qa-tiers.json")
        logger.log(
            logging.WARNING if tier_qa.violations else logging.INFO,
            "corpus tiered trust: job=%s\n%s",
            job.name,
            tier_qa.render_summary(),
            extra={"event": "corpus.tiers", "job": job.name, "ok": tier_qa.ok},
        )

    logger.info(
        "corpus assembled: job=%s\n%s",
        job.name,
        render_summary(metrics),
        extra={
            "event": "corpus.metrics",
            "job": job.name,
            "nodes": metrics.node_count,
            "edges": metrics.edge_count,
            "largest_component_fraction": metrics.largest_component_fraction,
        },
    )

    _gate(job, report, qa, metrics, min_component_fraction, logger, tier_qa)

    import_plan = generate_import_script(
        dataset_dir, out_dir=job.output_root / NEO4J_DIRNAME, database=database
    )
    datalog = export_dataset(
        dataset_dir,
        job.output_root / DATALOG_DIRNAME,
        engines_for_choice("both"),
        include_rules=True,
    )
    logger.info(
        "corpus exports written: job=%s neo4j=%s datalog_facts=%d",
        job.name,
        import_plan.script_path,
        datalog.fact_count,
        extra={"event": "corpus.exports", "job": job.name},
    )

    return CorpusBuild(
        name=job.name,
        dataset_dir=dataset_dir,
        job_run=run,
        metrics=metrics,
        qa=report,
        import_plan=import_plan,
        datalog=datalog,
        shared=tuple(stitched.shared),
        min_component_fraction=min_component_fraction,
        tiers=tiers,
        tier_qa=tier_qa,
    )


def _acquire_and_normalize(
    job: Job,
    adapter_factory: AdapterFactory | None,
    force: bool,
    force_ids: frozenset[str] | None,
    workers: int,
    logger: logging.Logger,
) -> JobRun:
    """Run acquire + normalize for every category, raising if any failed."""
    staged = replace(job, stages=_CORPUS_STAGES)
    run = run_job(
        staged,
        adapter_factory=adapter_factory,
        force=force,
        force_ids=force_ids,
        workers=workers,
        logger=logger,
    )
    if not run.ok:
        raise CorpusBuildError(
            f"corpus {job.name!r}: acquisition/normalization failed:\n{run.summary}"
        )
    return run


def _read_normalized(run: JobRun) -> list[NormalizationResult]:
    """Read each category's normalized node/edge rows back into a result."""
    results: list[NormalizationResult] = []
    for category in run.categories:
        normalize = next(
            (s for s in category.stages if s.stage == "normalize"), None
        )
        if normalize is None or not normalize.output_dir.is_dir():
            continue
        nodes, edges = read_dataset(normalize.output_dir)
        results.append(NormalizationResult(nodes=nodes, edges=edges))
    return results


def _validate(job: Job, dataset_dir: Path) -> None:
    """Raise :class:`CorpusBuildError` if the corpus TSV is not schema-valid."""
    errors = validate_directory(dataset_dir)
    if errors:
        detail = "; ".join(str(error) for error in errors)
        raise CorpusBuildError(
            f"corpus {job.name!r}: invalid TSV "
            f"({len(errors)} error(s)): {detail}"
        )


def _gate(
    job: Job,
    report: QaReport,
    qa: QaPolicy,
    metrics: GraphMetrics,
    min_component_fraction: float,
    logger: logging.Logger,
    tier_qa: TierQaReport | None = None,
) -> None:
    """Fail the build on a QA violation, a tier gate, or under-connectivity."""
    level = logging.WARNING if report.violations else logging.INFO
    logger.log(
        level,
        "corpus qa %s: job=%s violations=%d\n%s",
        "violations" if report.violations else "ok",
        job.name,
        len(report.violations),
        report.render_summary(),
        extra={"event": "corpus.qa", "job": job.name, "ok": report.ok},
    )
    if qa.fail_on_violation and report.violations:
        names = ", ".join(gate.label for gate in report.violations)
        raise CorpusBuildError(f"corpus {job.name!r}: QA gates failed: {names}")
    if qa.fail_on_violation and tier_qa is not None and tier_qa.violations:
        names = ", ".join(
            f"{tier}:{label}" for tier, label in tier_qa.violations
        )
        raise CorpusBuildError(
            f"corpus {job.name!r}: per-tier QA gates failed: {names}"
        )
    if metrics.largest_component_fraction < min_component_fraction:
        raise CorpusBuildError(
            f"corpus {job.name!r}: graph is fragmented — largest component holds "
            f"{metrics.largest_component_fraction:.0%} of nodes "
            f"({metrics.largest_component_size}/{metrics.node_count}), "
            f"below the {min_component_fraction:.0%} threshold"
        )
