"""Package the repo-root ``build/corpus`` as a versioned, verifiable release artifact.

This is the producer half of the pinakes → consumer corpus handoff
(``docs/LUGH-EXTRACTION-PLAN.md``). DVC is gone (``docs/artifact-versioning.md``),
so a consumer that needs the canonical node/edge corpus does not check out a
pointer — it downloads a published tarball and verifies it. That makes two things
this module's job:

* **a stable name.** The artifact is ``corpus-<version>.tar.gz``. The default
  version is *content-addressed* — the first :data:`VERSION_LENGTH` hex digits of
  :func:`~pinakes_engine.orchestrate.package.corpus_digest` — so the same corpus
  always publishes under the same name, and a different name always means
  different bytes. Pass an explicit version for a semantic release tag.
* **a checksum a downloader can actually check.** Beside the archive goes
  ``corpus-<version>.tar.gz.sha256`` in ``sha256sum`` format, so verifying a pulled
  bundle is ``sha256sum -c corpus-<version>.tar.gz.sha256`` and nothing else.

The archive itself comes from
:func:`~pinakes_engine.orchestrate.package.package_corpus`, which is already
byte-for-byte reproducible (sorted file order, pinned mtimes) and already runs the
personal/synthetic containment gates every release path must run.
Re-running over an unchanged corpus therefore reproduces the version, the archive
bytes, and the sha256.

**Determinism boundary.** ``build/corpus`` is written by
``scripts/export-for-engine.ts``, whose csids are minted deterministically and whose
provenance columns propagate verbatim from the lexicons — so re-exporting the same
lexicons is byte-identical and content-addressing it is meaningful. That is *not*
true of the engine's own ``out/<job>/corpus`` (its acquisition adapter stamps
``retrieved_at`` with the ingestion wall-clock); package that with
``pinakes_engine package``, which pins a point-in-time bundle instead.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from pinakes_engine.orchestrate.package import (
    PackageError,
    PackageResult,
    corpus_digest,
    package_corpus,
)

#: Repo-root-relative location of the canonical node/edge corpus.
CORPUS_REL = "build/corpus"

#: Filename stem of the published artifact: ``corpus-<version>``.
ARTIFACT_PREFIX = "corpus"

#: Hex digits of the content digest a default (content-addressed) version keeps.
VERSION_LENGTH = 12


class CorpusMissingError(Exception):
    """Raised when the corpus directory to publish does not exist.

    Distinct from :class:`~pinakes_engine.orchestrate.package.PackageError`: nothing
    is wrong, the corpus simply has not been exported yet. The CLI turns this into a
    no-op with a regenerate-first message rather than a failure.
    """


@dataclass(frozen=True)
class PublishResult:
    """What a :func:`publish_corpus` run produced."""

    version: str
    archive: Path
    checksum: Path
    manifest: Path
    sha256: str
    package: PackageResult

    @property
    def name(self) -> str:
        """The artifact name (``corpus-<version>``), and the release tag it keys."""
        return self.package.name


def repo_root() -> Path:
    """The pinakes repo root (this package sits at ``engine/src/pinakes_engine/…``)."""
    return Path(__file__).resolve().parents[4]


def default_corpus_dir() -> Path:
    """The repo-root ``build/corpus`` this publishes by default."""
    return repo_root() / CORPUS_REL


def corpus_version(source: str | Path) -> str:
    """Return the content-addressed version of the corpus at *source*.

    The leading :data:`VERSION_LENGTH` hex digits of the corpus content digest —
    stable across runs over identical bytes, and different the moment any packaged
    file changes.

    Raises:
        PackageError: If *source* is not a packageable corpus.
    """
    digest = corpus_digest(source)
    return digest.removeprefix("sha256:")[:VERSION_LENGTH]


def sha256_line(digest: str, filename: str) -> str:
    """Render one ``sha256sum``-format line (two spaces = binary-mode separator)."""
    return f"{digest}  {filename}\n"


def publish_summary(result: PublishResult) -> dict[str, object]:
    """A machine-readable summary of a publish, for the release path to consume.

    ``.github/workflows/publish-corpus.yml`` needs the version (it keys the release
    tag) and the three asset paths. Scraping those out of the human-readable print
    would be a contract nobody declared, so ``--json`` emits this instead: stable
    keys, paths exactly as written.
    """
    return {
        "published": True,
        "version": result.version,
        "tag": result.name,
        "archive": str(result.archive),
        "checksum": str(result.checksum),
        "manifest": str(result.manifest),
        "sha256": result.sha256,
        "files": len(result.package.files),
        "bytes": result.package.total_bytes,
    }


def nothing_published_summary(reason: str) -> dict[str, object]:
    """The ``--json`` counterpart of the no-corpus no-op (see :func:`publish_corpus`).

    Same envelope, ``published: false`` — so a caller branches on one key rather
    than on whether it got JSON at all.
    """
    return {"published": False, "reason": reason}


def publish_corpus(
    source: str | Path | None = None,
    out_dir: str | Path = "dist",
    *,
    version: str | None = None,
) -> PublishResult:
    """Package *source* into ``<out_dir>/corpus-<version>.tar.gz`` + its sha256.

    Args:
        source: The corpus dataset directory (default: the repo-root ``build/corpus``).
        out_dir: Directory the archive, manifest and checksum are written to.
        version: Artifact version (default: content-addressed, :func:`corpus_version`).

    Raises:
        CorpusMissingError: If *source* does not exist — export it first.
        PackageError: If *source* exists but is not a packageable corpus.
    """
    source = Path(source) if source is not None else default_corpus_dir()
    if not source.exists():
        raise CorpusMissingError(
            f"{source} does not exist. The corpus is a regenerable build output — "
            "export it first (npx tsx scripts/export-for-engine.ts), then re-run."
        )
    if not source.is_dir():
        raise PackageError(f"{source} is not a directory")

    version = version or corpus_version(source)
    result = package_corpus(source, out_dir, name=f"{ARTIFACT_PREFIX}-{version}")

    digest = hashlib.sha256(result.archive.read_bytes()).hexdigest()
    checksum = result.archive.with_name(result.archive.name + ".sha256")
    checksum.write_text(sha256_line(digest, result.archive.name), encoding="utf-8")

    return PublishResult(
        version=version,
        archive=result.archive,
        checksum=checksum,
        manifest=result.manifest,
        sha256=digest,
        package=result,
    )
