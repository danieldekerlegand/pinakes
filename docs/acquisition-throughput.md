# Acquisition throughput — one concurrency and politeness model

`pinakes:70` folded the parallel TypeScript scraper stack into the Python engine's
acquisition layer ([UNIFIED-PROJECT-PLAN §6](UNIFIED-PROJECT-PLAN.md)) so there is
**one** async fetch layer, **one** rate limiter, **one** cache and **one** set of domain
adapters. This note is the evidence for the second half of that claim: what the unified
layer actually costs, and where the time goes.

The short version: **acquisition is network-bound, and it is bound specifically by our own
per-host politeness gap, not by bandwidth and not by parsing.** Parsing 12,150 records
costs ~0.1 s. Fetching them costs 7–21 s. Every optimisation that matters lives on the
network side of that line.

## How to reproduce

```sh
cd engine
uv run --all-packages python scripts/benchmark_acquisition.py \
    inputs/jobs/seed-corpus.yml --workers 1 --workers 4
```

The measuring logic is `pinakes_engine.orchestrate.benchmark` (unit-tested in
`engine/tests/test_orchestrate_benchmark.py`); the script is argument parsing and I/O.
Each configuration acquires against a **fresh HTTP cache** in a temporary directory, so no
run inherits an earlier one's warm cache. `--warm` shares one cache across configurations
to measure the cached path on purpose.

**A real run hits the real network**, politely (the project User-Agent, `min_interval=1.0`
per host, backoff on `429`/`5xx`). `out/benchmark/*.json` is gitignored — the numbers below
are what gets committed, not the artifact.

### Reading the three clocks

| clock | what it is | what it answers |
| --- | --- | --- |
| `wall_seconds` | duration of the whole acquire run | throughput — the only clock concurrency shortens |
| `worker_seconds` | Σ per-category acquire-stage duration | the work done, independent of how it was scheduled |
| `network_seconds` | `request_seconds` + `wait_seconds`, aggregated by the shared client | how much of that work was I/O |

`worker_seconds` and `network_seconds` are both **worker-seconds**, so the network-vs-parse
split compares those two — never a worker-second aggregate against a wall clock, which is
how a concurrent run ends up "spending 300% of its time on the network".
`worker_seconds / wall_seconds` is the **effective parallelism** actually achieved.

`request_seconds` (time inside the transport) is kept apart from `wait_seconds` (politeness
gaps + retry backoff) deliberately: *slow* and *throttled* are different findings with
different fixes.

## The job

`inputs/jobs/seed-corpus.yml` — 9 categories, 12,150 records, spanning dishes, sculptures,
monuments, battles, languages, board games, inventions, clothing and festivals. It is the
representative multi-domain job: 8 categories query `query.wikidata.org` (`wikidata-sparql`)
and 1 traverses a Wikipedia category tree via `petscan.wmcloud.org`. **Two hosts, lopsided.**
That lopsidedness turns out to be the whole story.

Measured 2026-08-05 on an M3 Max (14 cores), Python 3.12.13, `min_interval=1.0`.

## Cold — the first run of the day

| workers | rows | wall (s) | rows/s | worker-s | parallelism | request (s) | wait (s) | parse (s) | network share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 12150 | 21.34 | 569 | 21.34 | 1.00× | 20.38 | 0.64 | 0.32 | 98% |
| 4 | 12150 | 7.05 | 1725 | 22.38 | 3.18× | 1.78 | 20.28 | 0.32 | 99% |

**Read this pair with the caveat, not without it.** WDQS caches query results server-side,
so the 4-worker run re-issued nine queries a warm server had already computed — its
`request_seconds` collapsed from 20.4 s to 1.8 s for that reason, not because of
concurrency. The 3.0× wall-clock improvement is therefore an **upper bound**, confounded by
a warm upstream.

Running the configurations in the opposite order isolates it:

| order | workers | wall (s) | request (s) | wait (s) | parse (s) |
| --- | --- | --- | --- | --- | --- |
| first | 4 | 7.05 | 1.48 | 20.58 | 0.26 |
| second | 1 | 7.20 | 1.60 | 5.31 | 0.28 |

Against a **warm upstream, both configurations take the same ~7 s.** The speedup in the
first table is real but it is mostly the server's cache. What concurrency is genuinely
worth on a cold upstream for this job was not measurable here — WDQS will not serve the
same nine queries cold twice, and manufacturing different queries would measure a different
job. Stated as unmeasured rather than estimated.

### Why ~7 s is a floor

8 of 9 categories share one host at `min_interval=1.0`. The limiter hands each worker a
distinct, evenly spaced slot, so the eighth request to `query.wikidata.org` cannot begin
before t≈7 s **whether or not the fetches are fanned out**. That is why `wait_seconds` rises
from 5.3 s to 20.6 s as workers go 1→4 while wall clock does not move: the extra workers
arrive early and wait. The politeness gap is the binding constraint, and it is one we chose.

The actionable form of that: **for this job, throughput scales with the number of distinct
hosts, not with the number of threads.** Adding a fifth worker buys nothing; adding a source
on a different host buys its full duration back. The per-host property that makes this true
— a slot owed to one host is never charged to another — is asserted directly in
`test_orchestrate_benchmark.py::test_spreading_the_same_requests_over_two_hosts_costs_less_waiting`
(the same four requests cost 2.4 s of waiting on one host and 0.6 s across two), and the
non-blocking form in `test_http.py::test_one_slow_host_does_not_block_a_request_to_another`.

## Warm — the same job with the network removed

`--warm` reuses the cache the cold run populated. Everything left is parse.

| workers | rows | wall (s) | rows/s | worker-s | parallelism | network (s) | parse (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 12150 | 0.11 | 114,817 | 0.11 | 1.00× | 0.00 | 0.11 |
| 4 | 12150 | 0.14 | 87,655 | 0.51 | 3.71× | 0.00 | 0.51 |

**This is the headline.** The identical 12,150 records take **7.05 s cold and 0.11 s warm** —
a 66× difference, all of it network. Parsing and record building account for 0.1–0.3 s of
every run in this document, i.e. **1–4% of the work and under 2% of the wall clock**.

Two things worth noting in the warm rows:

- **4 workers is *slower* than 1 when there is nothing to wait for** (0.14 s vs 0.11 s), and
  costs 5× the worker-seconds for the same output (0.51 vs 0.11). With the I/O gone, thread
  scheduling and GIL contention are pure overhead. Concurrency is a latency tool here, not a
  throughput tool — which is exactly what "network-bound" means.
- The cache is what makes iteration cheap. A re-run of an unchanged job also skips the
  acquire stage entirely on the runner's fingerprint check, so the warm number is the
  *ceiling* on what a re-run costs, not the typical case.

## What this says about the plan's speed goal

The plan's bet was that "incredibly fast at AI-powered scraping" is won on concurrency,
caching and parsing — not on choice of language. The measurements support the first two and
retire the third:

1. **Parsing is not the constraint and cannot become one at this scale.** 12,150 records/0.11 s
   means a hybrid Rust/Go transform layer would optimise 1–4% of acquisition. The benchmark
   is the check to run before that work is ever scheduled again.
2. **Caching is worth 66×** and is already unconditional on the `get` path.
3. **Concurrency is worth up to `min(workers, distinct hosts)`** and no more. The 3.18×
   effective parallelism confirms the fan-out mechanism works; the flat wall clock confirms
   a single-host job cannot spend it. Politeness is the deliberate ceiling, and the right
   lever for a job that needs to be faster is source breadth.

The one number to re-measure after any acquisition change is `parse_seconds` against
`worker_seconds`. If parse share ever climbs out of the low single digits, the conclusion
above expires.

## Related

- `engine/src/pinakes_engine/acquire/http.py` — the single client: per-host limit, backoff,
  on-disk cache, and the `HttpStats` timers these numbers come from.
- `engine/src/pinakes_engine/orchestrate/runner.py` — the fan-out, and the fingerprint skip
  that makes an unchanged re-run free.
- `engine/src/pinakes_engine/acquire/CLAUDE.md` — the retirement table for the TS stack
  these adapters replaced (US-1).
