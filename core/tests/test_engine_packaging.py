"""The agora engine's packaging blocker stays visible instead of going latent.

The sidecar image (``Dockerfile``, built by the repo-root ``docker-compose.yml``
service ``culturescrape``) **does not build**, and the cause is upstream: this
package declares ``translation-py`` as a real runtime dependency but resolves it
from a prebuilt, *macOS/arm64-only* wheel under ``vendor/`` via the uv-only
``[tool.uv.sources]`` mechanism. ``pip`` in a linux image reads neither.

That is a documented, accepted state — but a *silently* accepted one rots. This
module is the tripwire on it:

* If agora ever ships a portable artifact (a manylinux wheel, a pure-Python
  wheel, or an sdist), :func:`test_vendored_engine_wheel_is_still_platform_locked`
  fails — telling whoever bumps the wheel that ``Dockerfile`` can now be fixed and
  the ⚠️ notes in it, ``docker-compose.yml``, ``README.md`` and
  ``docs/culturescrape-integration.md`` must come down.
* If someone deletes the explanation without fixing the build,
  :func:`test_the_dockerfile_documents_the_packaging_blocker` fails.
* If someone "fixes" the build by demoting the engine to an optional extra — the
  one fix that is explicitly wrong, because it guts the no-silent-fallback policy
  in :mod:`culturescrape.translation` — :func:`test_engine_is_a_real_dependency`
  fails.

Nothing here asserts the image builds; it asserts the *reasons it cannot* are
still true and still written down.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

#: Package root (``core/``): this file is ``core/tests/<name>.py``.
_PACKAGE_ROOT = Path(__file__).resolve().parents[1]

_PYPROJECT = _PACKAGE_ROOT / "pyproject.toml"
_DOCKERFILE = _PACKAGE_ROOT / "Dockerfile"

#: The distribution name of the embedded agora translation engine.
ENGINE_DIST = "translation-py"

#: Wheel platform tags that would mean the blocker is gone — i.e. an artifact
#: ``pip`` could install into the linux sidecar image.
PORTABLE_WHEEL_TAGS = ("any", "manylinux", "musllinux", "linux_")


def _pyproject() -> dict:
    return tomllib.loads(_PYPROJECT.read_text(encoding="utf-8"))


def test_engine_is_a_real_dependency() -> None:
    """``translation-py`` is a hard runtime dependency, not an extra.

    :mod:`culturescrape.translation` raises rather than falling back to the
    retired Python emitters when the engine is missing. That guard is only
    honest if the dependency is genuinely required.
    """
    deps = _pyproject()["project"]["dependencies"]
    names = [d.split(";")[0].split("[")[0].strip().strip('"') for d in deps]
    assert ENGINE_DIST in names, (
        f"{ENGINE_DIST} must stay in [project.dependencies]; found {names}"
    )

    extras = _pyproject()["project"].get("optional-dependencies", {})
    for extra, entries in extras.items():
        joined = " ".join(entries)
        assert ENGINE_DIST not in joined, (
            f"{ENGINE_DIST} was demoted into the '{extra}' extra. That is the wrong "
            "fix for the Dockerfile — see this module's docstring."
        )


def test_vendored_engine_wheel_is_still_platform_locked() -> None:
    """The pinned wheel is macOS/arm64-only, which is why the image cannot build.

    Fails the day agora:60 ships something portable — deliberately, so the
    Dockerfile gets fixed instead of staying broken behind a stale comment.
    """
    source = _pyproject()["tool"]["uv"]["sources"][ENGINE_DIST]
    wheel = Path(source["path"])
    assert (_PACKAGE_ROOT / wheel).exists(), f"vendored wheel missing: {wheel}"

    # Wheel filename: <name>-<version>-<python>-<abi>-<platform>.whl
    platform_tag = wheel.stem.rsplit("-", 1)[-1]
    assert not any(tag in platform_tag for tag in PORTABLE_WHEEL_TAGS), (
        f"the vendored engine wheel is now portable ({platform_tag!r}). The sidecar "
        "image can probably build — fix core/Dockerfile and remove the ⚠️ notes in it, "
        "docker-compose.yml, README.md and docs/culturescrape-integration.md."
    )


@pytest.mark.parametrize(
    "phrase",
    [
        "KNOWN BROKEN",
        "[tool.uv.sources]",
        "macOS/arm64 only",
        "agora:60",
    ],
)
def test_the_dockerfile_documents_the_packaging_blocker(phrase: str) -> None:
    """Each half of the reasoning stays in ``Dockerfile``, next to the build it breaks.

    A reader who runs ``npm run sidecar:up`` and watches it fail must be able to
    find out why from the file that failed.
    """
    assert phrase in _DOCKERFILE.read_text(encoding="utf-8"), (
        f"core/Dockerfile no longer explains {phrase!r}. If the blocker is fixed, "
        "delete this module; if not, keep the explanation."
    )
