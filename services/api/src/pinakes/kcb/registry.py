"""Publishing the capability manifest to the KCB discovery registry.

Ported off `server/services/capability-registry.ts`. KCB §3 makes the registry a
*cache/index* over the providers' own surfaces, not a source of truth, so
registration is strictly best-effort: this module pushes the manifest when a
registry URL is configured and reports the outcome, and **never** raises,
retries into the request path, or gates serving. With the registry down (or never
configured) Pinakes keeps serving its manifest at
``/.well-known/kcb-manifest.json`` and its capabilities at the same already-built
routes; discovery just falls back from "ask the registry" to "read the provider".

**`urllib`, not a new HTTP dependency** — the same call this service already made
for GeoNames/Nominatim (`search/places.py`). One optional outbound POST does not
justify taking on a runtime HTTP client.

One thing did not come across, and it is a *when*, not a *what*. Express fired
the publish at route-registration time; an `APIRouter` has no startup hook and
`app.py` is the one file parallel port tasklists must not touch, so
:func:`ensure_published` fires it on the first ``/api/kcb`` request instead, off
the event loop. The observable difference is confined to a process that is never
asked about its own bus: ``/api/kcb/status`` still answers before the push
settles, with the same "not attempted yet" record Express started from.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from pinakes.kcb.manifest import configured_origin, manifest_for
from pinakes.kcb.signing import sign_manifest_for_serving

logger = logging.getLogger("pinakes.kcb")

#: Default publish timeout, in seconds (the TypeScript's 5_000 ms).
DEFAULT_REGISTRY_TIMEOUT_S = 5.0

#: Env var naming the discovery registry; unset ⇒ publishing is a no-op.
REGISTRY_URL_ENV = "KCB_REGISTRY_URL"
#: Env var overriding the publish timeout, in milliseconds (as the TypeScript read it).
REGISTRY_TIMEOUT_ENV = "KCB_REGISTRY_TIMEOUT_MS"


@dataclass(frozen=True)
class PublishResult:
    """The outcome of a publish attempt."""

    registered: bool
    """Whether the registry accepted the manifest."""

    registry_url: str | None
    """The registry that was tried, or ``None`` when none is configured."""

    detail: str
    """Human-readable outcome for ``/api/kcb/status`` and the log."""

    serving_directly: bool = True
    """Always true: the capabilities stay invocable whatever the registry said."""

    def as_dict(self) -> dict[str, Any]:
        """The `PublishResult` JSON shape the client and `/api/kcb/status` read."""
        return {
            "registered": self.registered,
            "servingDirectly": self.serving_directly,
            "registryUrl": self.registry_url,
            "detail": self.detail,
        }


#: The state `/api/kcb/status` reports before (and if) a push ever completes —
#: serving never waits on the registry, so this has to be answerable immediately.
NOT_ATTEMPTED = PublishResult(
    registered=False,
    registry_url=None,
    detail="Registration not attempted yet — capabilities are already being served.",
)


def configured_registry_url() -> str | None:
    """The discovery registry to publish to, or ``None``."""
    raw = os.environ.get(REGISTRY_URL_ENV, "").strip()
    return raw.rstrip("/") if raw else None


def _timeout_seconds() -> float:
    raw = os.environ.get(REGISTRY_TIMEOUT_ENV, "").strip()
    try:
        configured = float(raw)
    except ValueError:
        return DEFAULT_REGISTRY_TIMEOUT_S
    return configured / 1000 if configured > 0 else DEFAULT_REGISTRY_TIMEOUT_S


def publish(
    *,
    registry_url: str | None = None,
    origin: str | None = None,
    timeout: float | None = None,
) -> PublishResult:
    """Push the manifest to the discovery registry. Never raises.

    An unreachable, misconfigured or rejecting registry resolves to
    ``registered=False`` with the reason, and ``servingDirectly`` stays true
    either way.
    """
    raw = configured_registry_url() if registry_url is None else registry_url
    url = raw.strip().rstrip("/") if raw else None
    if not url:
        return PublishResult(
            registered=False,
            registry_url=None,
            detail=(
                f"No {REGISTRY_URL_ENV} configured — serving the manifest and "
                "capabilities directly (KCB §3: the registry is a cache, not a "
                "dependency)."
            ),
        )

    # Publish the same document a consumer would fetch: origin-absolutized
    # (dialable addresses, mcp/a2a included) and signed when a key is configured,
    # so the registry entry carries a verifiable `signing.key_id` + `signature`.
    manifest = sign_manifest_for_serving(
        manifest_for(configured_origin() if origin is None else origin)
    )
    request = urllib.request.Request(
        f"{url}/manifests",
        data=json.dumps(manifest).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(
            request, timeout=_timeout_seconds() if timeout is None else timeout
        ):
            pass
    except urllib.error.HTTPError as exc:
        return PublishResult(
            registered=False,
            registry_url=url,
            detail=(
                f"Registry rejected the manifest (HTTP {exc.code}) — "
                "capabilities remain invocable directly."
            ),
        )
    except Exception as exc:  # noqa: BLE001 - every transport failure is one outcome
        return PublishResult(
            registered=False,
            registry_url=url,
            detail=(
                f"Registry unreachable ({exc}) — capabilities remain invocable "
                "directly."
            ),
        )
    return PublishResult(
        registered=True,
        registry_url=url,
        detail=f"Published {manifest.get('identity')} to the KCB registry.",
    )


# ── The once-per-process attempt ─────────────────────────────────────────────

_registration: PublishResult = NOT_ATTEMPTED
_attempted = False


def registration() -> PublishResult:
    """The last publish outcome — the record ``/api/kcb/status`` reports."""
    return _registration


def reset_registration() -> None:
    """Forget the attempt (the test seam; there is no other way to re-fire it)."""
    global _registration, _attempted
    _registration = NOT_ATTEMPTED
    _attempted = False


def _record(result: PublishResult) -> None:
    global _registration
    _registration = result
    if not result.registered and result.registry_url:
        logger.warning("[kcb] %s", result.detail)


async def ensure_published() -> None:
    """Fire the one best-effort registration, off the event loop, at most once.

    Fire-and-forget in the Express sense: the caller does not await the push, so
    a slow or unreachable registry cannot delay the response it rode in on. The
    unconfigured case — the normal one — never touches the network at all.
    """
    global _attempted
    if _attempted:
        return
    _attempted = True
    task = asyncio.get_running_loop().run_in_executor(None, publish)
    task.add_done_callback(lambda done: _record(done.result()))
