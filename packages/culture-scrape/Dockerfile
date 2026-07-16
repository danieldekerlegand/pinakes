# culture-scrape read-only FastAPI explorer (the "sidecar" for Pinakes).
# Built and run by the repo-root docker-compose.yml (service: culturescrape).

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
CMD ["sh", "-c", "culturescrape serve \"$CORPUS\" --host 0.0.0.0 --port 8800"]
