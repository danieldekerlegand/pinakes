"""The A2A agent-card that carries the KCB manifest.

Ported off `server/routes/a2a.ts`. KCB §2 (0.3.0) folds the whole KCB manifest
onto the provider's standard A2A **AgentCard** rather than publishing a second
document: the KCB payload rides as one entry under the card's
``capabilities.extensions[]``, identified by :data:`KCB_MANIFEST_EXTENSION_URI`.

**Surface wrapper only.** Skills are *derived* from the manifest, so a new
capability becomes a skill by being declared in
`contracts/capability-manifest.json`, never by editing this file.

**One thing is a reimplementation rather than a port, and it is pinned by a
test.** Express built the card through the official `@a2a-js/sdk` codec
(``AgentCard.toJSON(AgentCard.fromJSON(card))``), which validates the document
and — the part that shows on the wire — **drops empty and default-valued
fields**: ``tenant: ""``, ``required: false``, and the empty ``examples`` /
``inputModes`` / ``outputModes`` / ``securityRequirements`` / ``securitySchemes``
/ ``signatures``. There is no equivalent Python SDK in this stack, so
:func:`build_agent_card` emits the *already-normalized* document — it never
writes the fields the codec would strip — and `test_agent_card.py` pins the
resulting key set against what the TypeScript actually served. Adding a field
here means checking what the codec does with it first.
"""

from __future__ import annotations

from typing import Any

from pinakes.kcb.manifest import absolutize, capability_manifest

#: Where the A2A agent-card is served (mirrors `endpoints.a2a`).
AGENT_CARD_ROUTE_PATH = "/.well-known/agent-card.json"

#: The stable extension URI the KCB manifest rides under on the AgentCard
#: (`koine/specs/capability-bus.md` §2). A crawler recovers the KCB §2 payload
#: from the `capabilities.extensions[]` entry whose `uri` is this.
KCB_MANIFEST_EXTENSION_URI = "https://koine.dev/kcb/manifest/0.3"

#: `A2A_PROTOCOL_VERSION` as vendored by `@a2a-js/sdk` — the version the served
#: card declared on its MCP interface. A bump upstream is a change here too.
A2A_PROTOCOL_VERSION = "1.0"


def _mcp_url(manifest: dict[str, Any], origin: str | None) -> str:
    """The MCP invocation url the card advertises, absolutized when known.

    Falls back to the manifest's own HTTP base if ``endpoints.mcp`` is unset.
    """
    endpoints = manifest.get("endpoints", {})
    path = endpoints.get("mcp") or endpoints["http"]
    return absolutize(origin, path) if origin else path


def _skill_tags(entry: dict[str, Any]) -> list[str]:
    """Tags mirroring a capability: its name, its planes, its specialization.

    A crawler that matches skills by tag can break the KFT §9/FT-K tie
    (specialized beats general) from the card alone, without pulling the manifest
    extension — which is why the ``x_specialization`` signals are flattened in
    here rather than left only in the extension payload.
    """
    tags = [entry["name"]]
    for port in [*entry.get("inputs", []), *entry.get("outputs", [])]:
        tags.append(port["plane"])
    spec = entry.get("x_specialization")
    if spec:
        tags.extend(
            [
                spec["provider_class"],
                spec["modality"],
                spec["egress"],
                *spec["domains"],
            ]
        )
    tags.append("koine-capability-bus")
    # Order-preserving dedup — the TypeScript built this with `new Set([...])`.
    return list(dict.fromkeys(tags))


def build_agent_card(origin: str | None) -> dict[str, Any]:
    """The served A2A AgentCard for *origin*.

    Every capability on the manifest becomes an A2A skill; the full KCB §2
    payload rides as one ``AgentExtension``.
    """
    manifest = capability_manifest()
    mcp = _mcp_url(manifest, origin)

    return {
        # The card's own agent id IS the KINP identity (KCB §2 — identity is read
        # off the card's `name`), so a resolver dialing the card knows whom it is
        # talking to.
        "name": manifest["identity"],
        "description": manifest["x_pinakes"]["title"],
        "supportedInterfaces": [
            # Pinakes's invocation surface is the MCP server; advertise it as the
            # reachable interface, and carry it again as the extension's `mcp`.
            {
                "url": mcp,
                "protocolBinding": "MCP",
                "protocolVersion": A2A_PROTOCOL_VERSION,
            }
        ],
        "provider": {
            "url": manifest["x_pinakes"]["identityIri"],
            "organization": "Pinakes",
        },
        "version": manifest["x_pinakes"]["manifestVersion"],
        "capabilities": {
            "streaming": False,
            "extensions": [
                {
                    "uri": KCB_MANIFEST_EXTENSION_URI,
                    "description": "Koine capability-bus manifest",
                    "params": {
                        "kcb_version": manifest["kcb_version"],
                        # Non-A2A endpoint the extension still needs (KCB §2).
                        "mcp": mcp,
                        "produces": manifest["produces"],
                        "consumes": manifest["consumes"],
                        "capabilities": manifest["capabilities"],
                        "auth": manifest["auth"],
                        "signing": manifest["signing"],
                    },
                }
            ],
        },
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": entry["name"],
                "name": entry["name"],
                "description": entry["description"],
                "tags": _skill_tags(entry),
            }
            for entry in manifest["capabilities"]
        ],
    }
