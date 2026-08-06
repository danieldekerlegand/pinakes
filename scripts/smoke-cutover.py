#!/usr/bin/env python
"""End-to-end smoke for the cutover: one Python process serves everything.

    npx vite build --config web/vite.config.ts     # once, for the client half
    uv run --all-packages python scripts/smoke-cutover.py

Starts the real service with `python -m pinakes` on a free port, drives it over
HTTP the way a browser would, and tears it down. Distinct from the pytest suite,
which drives the app in-process through `TestClient`: what this adds is that the
*process* starts, binds, serves the built client at `/`, and answers `/api/*`
with **no Node and no sidecar** — the claim pinakes:80 US-1 exists to make and
the one thing an in-process test cannot check.

Three groups of checks, matching that story's acceptance criteria:

* **the client** — the SPA shell at `/`, a hashed asset, and a deep link falling
  back to the shell rather than 404ing;
* **reads** — the corpus, and the graph surface. The graph is checked for its
  *contract*, not its availability: a checkout with no Neo4j answers
  `{"available": false}` and 503s the queries, and that degrade is the passing
  answer. A configured one is asserted just as strictly.
* **a write flow** — submit a contribution, adopt its cultural domain, confirm
  it as that domain's steward, and read the verification back. It ends on disk,
  in a temp tree this script points the service at (`$PINAKES_*_DIR`), so a
  smoke run never touches `data/runtime/`.

Exit status is the result; every check prints its own line.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CLIENT_DIST = ROOT / "dist" / "public"
STARTUP_TIMEOUT_SECONDS = 60.0

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    """Record one assertion. Never raises — a smoke reports everything it can."""
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(label)
    return ok


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


def request(
    base: str, path: str, *, method: str = "GET", body: Any = None
) -> tuple[int, Any]:
    """One HTTP call. A non-2xx is an *answer* here, not an exception."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {} if data is None else {"content-type": "application/json"}
    req = urllib.request.Request(  # noqa: S310 - a localhost URL this script built
        f"{base}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req) as response:  # noqa: S310 - as above
            raw = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        status = error.code
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw


def wait_until_up(base: str, process: subprocess.Popen[bytes]) -> bool:
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            status, _ = request(base, "/api/health")
        except OSError:
            time.sleep(0.25)
            continue
        if status == 200:
            return True
        time.sleep(0.25)
    return False


def check_the_client(base: str) -> None:
    print("the client, served by the API process")
    status, body = request(base, "/")
    check("GET / is the SPA shell", status == 200 and "<title>" in str(body))

    asset = ""
    if isinstance(body, str):
        marker = '/assets/index-'
        start = body.find(marker)
        if start != -1:
            end = body.find('"', start)
            asset = body[start:end]
    if check("the shell references a hashed asset", bool(asset), asset):
        status, _ = request(base, asset)
        check("the hashed asset is served", status == 200)

    status, body = request(base, "/atlas")
    check(
        "a client-side deep link falls back to the shell",
        status == 200 and "<title>" in str(body),
    )

    status, _ = request(base, "/api/no-such-route")
    check("an unknown /api path is a 404, not the shell", status == 404)


def check_reads(base: str) -> None:
    print("reads")
    status, body = request(base, "/api/health")
    parity = body.get("parity", {}) if isinstance(body, dict) else {}
    check(
        "the whole baseline is ported",
        parity.get("unported") == 0 and parity.get("ported") == parity.get("total"),
        f"{parity.get('ported')}/{parity.get('total')}",
    )
    check("the client build is what is being served", body.get("clientBuilt") is True)

    status, body = request(base, "/api/languages")
    check(
        "the corpus answers",
        status == 200 and isinstance(body, list) and len(body) > 0,
        f"{len(body) if isinstance(body, list) else '?'} languages",
    )

    status, body = request(base, "/api/openapi.json")
    check(
        "the published API document is served",
        status == 200
        and isinstance(body, dict)
        and body.get("info", {}).get("title") == "pinakes Public API",
    )

    # The graph is checked for its contract in both states: an unconfigured
    # checkout must degrade, a configured one must answer. Neither is a failure.
    status, body = request(base, "/api/graph/status")
    available = isinstance(body, dict) and body.get("available") is True
    check("GET /api/graph/status answers", status == 200 and isinstance(body, dict))
    search_status, _ = request(base, "/api/graph/search?q=sumer")
    check(
        "the graph query matches the reported availability",
        search_status == 200 if available else search_status == 503,
        f"available={available}, search={search_status}",
    )

    status, body = request(base, "/api/search?q=sumer")
    sources = sorted({row.get("source") for row in body.get("results", [])})
    check(
        "federated search answers whether or not the graph is up",
        status == 200 and body.get("totalCount", 0) > 0,
        f"sources={sources}",
    )


def check_a_write_flow(base: str, runtime: Path) -> None:
    print("a write flow: submit → adopt → confirm → verified")
    status, body = request(
        base,
        "/api/contributions",
        method="POST",
        body={
            "entityType": "civilization",
            "action": "add",
            "contributorName": "Cutover Smoke",
            "entityData": {"name": "Smokeburg"},
            "sources": [{"title": "scripts/smoke-cutover.py"}],
            "confidence": 50,
        },
    )
    queued = check("a contribution is queued", status == 201, str(status))
    if not queued:
        return
    contribution_id = body["contribution"]["id"]

    status, _ = request(
        base,
        "/api/stewardship/adopt",
        method="POST",
        body={"steward": "Cutover Steward", "domain": "Smokeburg"},
    )
    check("its cultural domain is adopted", status == 201, str(status))

    status, body = request(
        base,
        f"/api/contributions/{contribution_id}/confirm",
        method="POST",
        body={"reviewer": "Cutover Steward", "note": "end-to-end"},
    )
    check(
        "a steward's confirmation verifies it single-handedly",
        status == 200
        and body.get("confirmedAsSteward") is True
        and body.get("verification", {}).get("verified") is True
        and body.get("contribution", {}).get("status") == "approved",
        f"domain={body.get('domain')}",
    )

    status, body = request(base, f"/api/contributions/{contribution_id}/verification")
    check(
        "the verification reads back with its attribution",
        status == 200
        and body.get("stewardAttribution")
        == [{"steward": "Cutover Steward", "domain": "smokeburg"}],
    )

    written = runtime / "contributions" / f"{contribution_id}.json"
    check("the record landed on disk", written.is_file(), str(written))
    check(
        "and nothing was written outside the smoke's own tree",
        not (ROOT / "data" / "runtime" / "contributions" / written.name).exists(),
    )


def main() -> int:
    if not (CLIENT_DIST / "index.html").is_file():
        print(
            f"no client build at {CLIENT_DIST}\n"
            "run: npx vite build --config web/vite.config.ts",
            file=sys.stderr,
        )
        return 2

    port = free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="pinakes-smoke-") as temp:
        runtime = Path(temp)
        environment = {
            **os.environ,
            "PORT": str(port),
            "PINAKES_CONTRIBUTIONS_DIR": str(runtime / "contributions"),
            "PINAKES_STEWARDSHIP_DIR": str(runtime / "stewardship"),
            "PINAKES_CHANGELOG_DIR": str(runtime / "changelog"),
        }
        print(f"starting `python -m pinakes` on {base}")
        process = subprocess.Popen(  # noqa: S603 - a fixed argv
            [sys.executable, "-m", "pinakes"],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            if not wait_until_up(base, process):
                print("the service never came up", file=sys.stderr)
                return 1
            check_the_client(base)
            check_reads(base)
            check_a_write_flow(base, runtime)
        finally:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:  # pragma: no cover - a hung server
                process.kill()

    if failures:
        print(f"\n{len(failures)} check(s) failed:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nall checks passed — one Python process, no Node, no sidecar")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
