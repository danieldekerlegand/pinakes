# pinakes-engine read-only FastAPI explorer (the "sidecar" for pinakes).
# Built and run by the sibling infra/docker-compose.yml (service: pinakes_engine).
# Its build CONTEXT is `../engine`, not this directory — every COPY below is relative
# to the engine package root.
#
# ---------------------------------------------------------------------------
# ⚠️ KNOWN BROKEN — this image does not build. Blocked upstream on agora:60.
# ---------------------------------------------------------------------------
# `pyproject.toml` declares `translation-py` (the embedded agora translation engine)
# as a real runtime dependency, resolved for local dev from a prebuilt wheel under
# `vendor/` via `[tool.uv.sources]`. Neither half of that survives into this image:
#
#   1. `[tool.uv.sources]` is a **uv-only** mechanism. The `pip install` below does
#      not read it, so pip resolves `translation-py` against PyPI, where it does not
#      exist. Copying `vendor/` and adding `--find-links vendor` fixes only this half.
#   2. The vendored wheel is `translation_py-0.1.0-cp39-abi3-macosx_11_0_arm64.whl` —
#      **macOS/arm64 only**. This image is `linux`, so no tag matches it regardless of
#      how pip is pointed at the file. agora:60 ships no linux wheel and no sdist, and
#      the crate source is not vendored here, so the wheel cannot be rebuilt in-image.
#
# Unblocking needs a portable artifact from agora (manylinux wheels, or an sdist plus
# a Rust build stage). Do NOT "fix" this by demoting `translation-py` to an optional
# extra: the guarded-import policy in `pinakes_engine.translation` deliberately has no
# silent fallback, and the dependency being real is what makes that guard meaningful.
#
# Impact is contained: the sidecar is optional at runtime. Every `/api/graph/*` route
# answers 503 `{ available:false }` and the graph UI disables with a tooltip when it is
# absent (docs/engine-integration.md §10b), and `pinakes_engine serve` still runs
# fine outside Docker from a `uv sync`'d checkout.

# ---------------------------------------------------------------------------
# Stage 1 — build Soufflé from source. Debian (this image's base) has no
# `souffle` apt package, and the official souffle-lang apt repo is Ubuntu-only
# (its .deb needs libffi7, absent on Debian trixie / Ubuntu 24.04). Building
# from source against the runtime base's own libs keeps the copied binary ABI-
# compatible with the final image. Interpreter mode (how the equivalence harness
# and CLI invoke it: `souffle graph.dl -F <in> -D <out>`) needs no C++ toolchain
# at run time, so only the binary is carried forward.
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS souffle-build
ARG SOUFFLE_VERSION=2.4
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential cmake git bison flex libffi-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${SOUFFLE_VERSION}" https://github.com/souffle-lang/souffle.git /tmp/souffle \
    && cmake -S /tmp/souffle -B /tmp/souffle/build -DCMAKE_BUILD_TYPE=Release \
         -DSOUFFLE_USE_CURSES=OFF -DSOUFFLE_USE_SQLITE=OFF \
    && cmake --build /tmp/souffle/build --target install -j"$(nproc)"

# ---------------------------------------------------------------------------
# Stage 2 — the runtime sidecar image.
# ---------------------------------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

# Logic engines for the symbolic layer: swi-prolog (apt) runs the /datalog
# console queries and the SWI example probes; souffle (built in stage 1, plus its
# OpenMP runtime lib libgomp1 and the mcpp C preprocessor it shells out to even in
# interpreter mode) runs the cross-engine equivalence path. Without these the
# console degrades to lint-only and the engine-gated tests skip.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        swi-prolog libgomp1 mcpp \
    && rm -rf /var/lib/apt/lists/*
COPY --from=souffle-build /usr/local/bin/souffle /usr/local/bin/souffle

# Install the package with the GUI (FastAPI/uvicorn) and Neo4j extras.
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir ".[gui,neo4j]"

# Bundle the fixture corpus so `serve` works out of the box with no network fetch.
# Override CORPUS (and mount a real corpus) to serve a built dataset instead.
COPY tests/fixtures ./tests/fixtures
ENV CORPUS=tests/fixtures/explorer-corpus

EXPOSE 8800
CMD ["sh", "-c", "pinakes_engine serve \"$CORPUS\" --host 0.0.0.0 --port 8800"]
