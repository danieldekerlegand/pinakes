"""The KCB capability-bus routes — how Pinakes publishes itself (pinakes:65 US-1).

Ported off `server/routes/capability-bus.ts`:

``GET /.well-known/kcb-manifest.json``
    The KCB §2 manifest (the **describe** verb, §4). Well-known so a
    crawler-populated registry can pull it, and so a consumer that cannot reach
    the registry can read it straight off the provider.
``GET /api/kcb/manifest``
    The same document under the API prefix.
``GET /api/kcb/capabilities``
    The invocation directory: each capability with the already-built endpoints
    behind it. This is the fallback path that makes the registry optional (KCB §3
    is route-by-lookup, never a proxy).
``GET /api/kcb/status``
    Whether registration with the discovery registry succeeded, and the standing
    fact that the capabilities are served regardless.

**A surface wrapper only.** Nothing here resolves, reconciles or queries
anything; the manifest is `contracts/capability-manifest.json` and every
capability points at merged code. Extending the bus is an edit to that JSON.

The origin resolution is the Express one: the configured public origin wins, else
the origin the request arrived on, so a manifest fetched over the network is
always dialable. With neither — the same-origin case, and the case a test asserts
on — the document is served exactly as authored.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from pinakes.kcb import registry
from pinakes.kcb.manifest import (
    MANIFEST_WELL_KNOWN_PATH,
    capability_manifest,
    manifest_for,
)
from pinakes.kcb.signing import is_manifest_signed, sign_manifest_for_serving
from pinakes.routers._origin import origin_for

router = APIRouter(tags=["kcb"])


async def _served_manifest(request: Request) -> dict[str, Any]:
    """Absolutize for the requester, then sign with the env-configured key.

    Signing is a no-op that serves the document unsigned when no key is set
    (KCB §5 signing is a SHOULD) — and that pass-through is what keeps the
    well-known document byte-identical to `contracts/capability-manifest.json`.
    """
    await registry.ensure_published()
    return sign_manifest_for_serving(manifest_for(origin_for(request)))


@router.get(MANIFEST_WELL_KNOWN_PATH)
async def well_known_manifest(request: Request) -> dict[str, Any]:
    """The manifest at its well-known path, for a registry crawler."""
    return await _served_manifest(request)


@router.get("/api/kcb/manifest")
async def api_manifest(request: Request) -> dict[str, Any]:
    """The same manifest under the API prefix."""
    return await _served_manifest(request)


@router.get("/api/kcb/capabilities")
async def capabilities(request: Request) -> dict[str, Any]:
    """The invocation directory — capabilities + the built endpoints behind them."""
    await registry.ensure_published()
    manifest = manifest_for(origin_for(request))
    entries: list[dict[str, Any]] = []
    for entry in manifest["capabilities"]:
        listed: dict[str, Any] = {
            "name": entry["name"],
            "description": entry["description"],
            "cost": entry["cost"],
            "grant": entry.get("x_grant"),
        }
        # Present only on a narrow provider (today: `finetune`). The directory is
        # a `describe` surface and FT-K's tiebreak is decided on this block — a
        # registry that discovered Pinakes here would otherwise have to re-fetch
        # the manifest to learn it is the specialized leg.
        if entry.get("x_specialization"):
            listed["specialization"] = entry["x_specialization"]
        listed["surfaces"] = entry["x_surfaces"]
        entries.append(listed)
    return {
        "identity": manifest["identity"],
        "kcbVersion": manifest["kcb_version"],
        "manifest": manifest["endpoints"]["manifest"],
        "capabilities": entries,
    }


@router.get("/api/kcb/status")
async def status() -> dict[str, Any]:
    """Registry-registration status. ``servingDirectly`` is true whatever happened."""
    await registry.ensure_published()
    manifest = capability_manifest()
    return {
        "identity": manifest["identity"],
        "kcbVersion": manifest["kcb_version"],
        "manifestVersion": manifest["x_pinakes"]["manifestVersion"],
        # True when a signing key is configured: sign the authored manifest and
        # read the populated `key_id` off the result. Unconfigured ⇒ unsigned
        # clone ⇒ false.
        "signed": is_manifest_signed(sign_manifest_for_serving(manifest)),
        "registry": registry.registration().as_dict(),
    }
