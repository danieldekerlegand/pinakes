#!/usr/bin/env python
"""Measure a job's acquisition throughput at one or more worker counts.

This is the driver behind ``docs/acquisition-throughput.md`` (pinakes:70 US-2):
the unified acquisition layer claims concurrent multi-source fetching with
per-host politeness, and this is what puts numbers on it. The measuring logic
lives in ``pinakes_engine.orchestrate.benchmark`` (type-checked, unit-tested);
this script is only argument parsing and I/O.

Run from ``engine/`` so the job's relative category paths resolve::

    uv run --all-packages python scripts/benchmark_acquisition.py \
        inputs/jobs/seed-corpus.yml --workers 1 --workers 4

Each configuration acquires against a **fresh HTTP cache** in a temporary
directory, so the numbers are cold-fetch numbers and a later run never inherits
an earlier one's warm cache. That means a real run **hits the network** with the
project's User-Agent and the client's per-host rate limit; do not point it at a
job you would not politely fetch for real. Add ``--warm`` to measure the cached
path instead (every configuration then shares one cache directory, and the first
run populates it).

Writes ``out/benchmark/acquisition.json`` (gitignored) and prints the Markdown
table; commit the *numbers* into the doc, never the artifact.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from pinakes_engine.orchestrate.benchmark import (
    AcquisitionBenchmark,
    benchmark_acquisition,
    render_markdown,
)
from pinakes_engine.orchestrate.jobs import JobConfigError, load_job

#: Package root = one level up from scripts/.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_OUT = _PACKAGE_ROOT / "out" / "benchmark" / "acquisition.json"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the command line."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("job", type=Path, help="Path to the jobs/*.yml to acquire.")
    parser.add_argument(
        "--workers",
        type=int,
        action="append",
        metavar="N",
        help="Worker count to measure; repeat for a before/after (default: 1 and 4).",
    )
    parser.add_argument(
        "--warm",
        action="store_true",
        help="Share one HTTP cache across configurations (measures the cached path).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"JSON report (default {DEFAULT_OUT}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run the benchmark, write the JSON report and print the table."""
    args = parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    try:
        job = load_job(args.job)
    except JobConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    counts = args.workers or [1, 4]
    with TemporaryDirectory(prefix="pinakes-bench-cache-") as shared:
        cache = Path(shared) if args.warm else None
        results = [
            benchmark_acquisition(job, workers=count, cache_dir=cache)
            for count in counts
        ]

    _write(args.out, job.name, args.warm, results)
    print(render_markdown(results))
    print(f"\nwrote {args.out}")
    failed = sum(r.failures for r in results)
    if failed:
        print(f"warning: {failed} category run(s) failed", file=sys.stderr)
    return 0


def _write(
    path: Path, job: str, warm: bool, results: list[AcquisitionBenchmark]
) -> None:
    """Persist the report as JSON, creating the output directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "job": job,
        "cache": "warm" if warm else "cold",
        "runs": [r.to_dict() for r in results],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", "utf-8")


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
