"""The KCB capability manifest, as this service serves it.

Ported off the accessors in `contracts/capability-manifest.ts` that the routes
actually used — :func:`manifest_for` (origin absolutization) and
:func:`capability` (one entry by name) — plus the origin resolution
`server/services/capability-registry.ts` supplied.

The **document** itself is not restated: it is read through
``pinakes_contracts.capability_manifest.document()``, the generated binding, so
`contracts/capability-manifest.json` stays the single source of truth. That is
also what keeps the self-description honest — with no configured origin and no
signing key the served document is byte-identical to the contract on disk
(`server/routes/participation-self-sufficiency.test.ts` asserts the same thing
on the Express side).

The validator (`assertValidCapabilityManifest`) is deliberately **not** ported.
It is authoring-time drift protection over a committed JSON file, it runs in
`contracts/capability-manifest.test.ts` on every TypeScript run, and a second
implementation of it here would be a second thing to keep in step with the
schema rather than a second check.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any

from pinakes_contracts.capability_manifest import document

#: Where the manifest is served for registry crawlers (KCB §3 pull population).
MANIFEST_WELL_KNOWN_PATH = "/.well-known/kcb-manifest.json"

#: Env var naming the origin peers should dial back on.
PUBLIC_ORIGIN_ENV = "PINAKES_PUBLIC_ORIGIN"


def capability_manifest() -> dict[str, Any]:
    """The manifest as authored, freshly parsed.

    A copy per call, not a cached module constant: every caller here mutates its
    own clone to absolutize or sign, and one shared dict would let the first
    request's origin leak into the next one's document.
    """
    return document()


def capability(
    name: str, manifest: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Look up one capability by name; ``None`` when absent."""
    published = manifest if manifest is not None else capability_manifest()
    entries: list[dict[str, Any]] = published.get("capabilities", [])
    for entry in entries:
        if entry.get("name") == name:
            return entry
    return None


def configured_origin() -> str | None:
    """The origin peers dial back on, or ``None`` when it is not configured."""
    raw = os.environ.get(PUBLIC_ORIGIN_ENV, "").strip()
    return raw.rstrip("/") if raw else None


def absolutize(origin: str, path: str) -> str:
    """Join an origin and a server-relative path into an absolute URL."""
    return f"{origin.rstrip('/')}{path}"


def manifest_for(origin: str | None) -> dict[str, Any]:
    """The manifest as published to a registry (or served) from *origin*.

    Endpoints and every capability surface gain an absolute ``url``, so a
    registry entry is directly dialable — KCB §3 hands out *addresses* and peers
    then connect straight to them. With *origin* ``None`` the manifest comes
    back as authored (server-relative), which is what a same-origin client
    wants, and is the state the byte-identity guarantee is about.
    """
    manifest = capability_manifest()
    if not origin:
        return manifest

    endpoints = manifest.get("endpoints", {})
    for key in ("http", "manifest", "mcp", "a2a"):
        value = endpoints.get(key)
        # The MCP tools surface and the A2A agent-card are dialable fronts too,
        # so a registry entry listing them must carry absolute URLs — but a null
        # endpoint stays null rather than becoming a bare origin.
        if isinstance(value, str) and value:
            endpoints[key] = absolutize(origin, value)
    for entry in manifest.get("capabilities", []):
        for surface in entry.get("x_surfaces", []):
            surface["url"] = absolutize(origin, surface["path"])
    return manifest


def canonical_json(value: Any) -> str:
    """`contracts/kgp.ts` ``canonicalJson``: sorted keys, no whitespace.

    A signature minted here has to verify against one minted on the Express side
    and vice versa, so the byte string is spelled to match ``JSON.stringify``
    rather than to look idiomatic:

    * ``separators=(",", ":")`` — no spaces, as JS emits;
    * ``ensure_ascii=False`` — **load-bearing**. This document is full of ``—``
      and ``§``; ``JSON.stringify`` writes them literally and Python would
      otherwise escape them to ``\\uXXXX``, which is a different byte string and
      therefore a different signature;
    * ``sort_keys=True`` — JS sorts by UTF-16 code unit and Python by code
      point, which agree for every key in this document (all ASCII) and for
      anything in the BMP.

    ``canonicalJson``'s ``undefined`` filter has no counterpart: a key absent
    from the file is absent from the parsed dict, and an explicit ``null`` is
    kept by both.
    """
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def clone(manifest: dict[str, Any]) -> dict[str, Any]:
    """A deep copy — for callers that hand a manifest to two consumers."""
    return copy.deepcopy(manifest)
