# culture-scrape read-only FastAPI explorer (the "sidecar" for LinguaScrape).
# Built and run by the repo-root docker-compose.yml (service: culturescrape).
FROM python:3.11-slim

WORKDIR /app

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
