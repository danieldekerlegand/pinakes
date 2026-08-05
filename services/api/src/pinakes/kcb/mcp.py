"""The MCP server behind ``/mcp`` — KCB §4's tool-call invocation front.

Ported off `server/routes/mcp.ts`. KCB §4 names an MCP tool call as one of the
two ways to invoke a capability (the other is the A2A message the agent-card
advertises), and this exposes the manifest's capabilities as tools.

**Every tool forwards to an already-built surface, and after this port every one
of those is an in-process import** — which is the thing the story was for:

* ``resolve``   → :mod:`pinakes.search.graph_resolver` (the lexicon alias table)
* ``reconcile`` → :mod:`pinakes.acquire` over :mod:`pinakes.engine.acquisition`
* ``query``     → :mod:`pinakes.engine.datalog`

The Express versions of the last two crossed a process boundary — an HTTP hop to
the sidecar's Datalog console, and a `python -m pinakes_engine.cli fetch` child
process. Neither exists here.

**The transport is stateless**, as it was on Express (`sessionIdGenerator:
undefined`, `enableJsonResponse: true`): every POST is answered from scratch, so
there is no session state to leak between callers and GET/DELETE — the SSE stream
and its teardown — are a JSON-RPC "method not allowed".

**Graceful degradation mirrors `/api/graph/*`.** An unavailable backend becomes a
tool *error result* (``isError: true``), never a raise: the same shape the HTTP
503 gives, so a client that already tolerates a degraded graph tolerates this.

Two divergences from the Express tool set, both deliberate:

* **`reconcile` runs the acquisition rather than handing back a job id.** Express
  minted a `jobStore` job and streamed progress through `GET /api/scraping-jobs`,
  a surface this backend does not serve yet — see :mod:`pinakes.acquire.job`.
* **`finetune` / `finetune_subscribe` are advertised but not dispatchable here.**
  The KFT provider is a wrapper that shells out to the private `lugh` checkout
  (`server/services/finetune-provider.ts`), and this service reaches everything
  by import — `test_engine_inprocess.test_no_sidecar_or_subprocess_seam` fails
  the build on a child-process spawn under ``src/``. The capability stays
  advertised because the manifest advertises it and describe surfaces must agree
  (the same "never gate the advertisement on the runner being present" rule the
  optional-env degrade already follows); the *invoke* degrades with a message
  naming where it does run. The whole entry is transitional either way: it
  retires when `lugh` publishes its own KCB manifest.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

from pinakes.acquire import ACQUISITION_CATALOG, resolve_acquisition_category
from pinakes.acquire import job as acquire_job
from pinakes.engine import datalog
from pinakes.engine.errors import EngineError, EngineFailure, EngineUnavailable
from pinakes.kcb.manifest import capability, capability_manifest
from pinakes.paths import lexicons_dir
from pinakes.search.graph_resolver import EntityRef, graph_resolver

logger = logging.getLogger("pinakes.kcb.mcp")

#: Where the MCP server is mounted (mirrors `endpoints.mcp` in the manifest).
MCP_ROUTE_PATH = "/mcp"

#: The protocol revision this server implements, and the ones it will echo back
#: to a client that asks for an older revision. Kept in step with the JS SDK's
#: `SUPPORTED_PROTOCOL_VERSIONS`, which is what the Express front negotiated.
LATEST_PROTOCOL_VERSION = "2025-11-25"
SUPPORTED_PROTOCOL_VERSIONS: tuple[str, ...] = (
    LATEST_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
    "2024-10-07",
)

#: JSON-RPC error codes this server emits.
METHOD_NOT_FOUND = -32601
INVALID_REQUEST = -32600
INTERNAL_ERROR = -32603
#: The code the Express front answered GET/DELETE with (an SDK "server error").
METHOD_NOT_ALLOWED = -32000


# ── Tool declarations ────────────────────────────────────────────────────────
#
# `inputSchema` is spelled the way the TypeScript's zod shapes compiled: draft-07,
# `additionalProperties: false`, an optional argument simply absent from
# `required`. Descriptions are the same strings, so the two fronts advertise the
# same tools during the cutover.

_STRING = "string"
_NUMBER = "number"


def _schema(
    properties: dict[str, dict[str, Any]], required: list[str]
) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
        "$schema": "http://json-schema.org/draft-07/schema#",
    }


#: `(name, fallback description, input schema)` per tool. The description is read
#: off the manifest when the capability declares one, so the tools can never
#: drift from `contracts/capability-manifest.json`; the fallback covers a tool
#: with no capability entry (`finetune_subscribe` is the stream verb of one).
TOOL_SPECS: tuple[tuple[str, str, dict[str, Any]], ...] = (
    (
        "resolve",
        "Resolve an entity reference to its canonical csid.",
        _schema(
            {
                "type": {
                    "type": _STRING,
                    "description": 'Canonical node type, e.g. "language" or "culture".',
                },
                "id": {
                    "type": _STRING,
                    "description": "pinakes local id (the strong signal).",
                },
                "name": {
                    "type": _STRING,
                    "description": "Display name, for the fuzzy fallback.",
                },
                "region": {
                    "type": _STRING,
                    "description": "Region to disambiguate fuzzy candidates.",
                },
            },
            ["type"],
        ),
    ),
    (
        "reconcile",
        "Reconcile a name-anchored row against Wikidata and re-mint its csid.",
        _schema(
            {
                "domain": {
                    "type": _STRING,
                    "description": (
                        "Acquisition domain, e.g. one of the pinakes-engine "
                        "categories."
                    ),
                },
                "limit": {
                    "type": _NUMBER,
                    "description": "Max records to acquire.",
                },
            },
            ["domain"],
        ),
    ),
    (
        "query",
        "Query the canonical graph corpus via read-only Datalog.",
        _schema(
            {
                "goal": {
                    "type": _STRING,
                    "description": "An ad-hoc Datalog `main/0` goal.",
                },
                "example": {
                    "type": _STRING,
                    "description": "A shipped example slug to run.",
                },
            },
            [],
        ),
    ),
    (
        "finetune",
        (
            "Fine-tune a small language model on Pinakes's neurosymbolic corpora "
            "(KFT specialized provider)."
        ),
        _schema(
            {
                "job": {
                    "type": "object",
                    "additionalProperties": True,
                    "description": (
                        "The KFT finetune-job manifest "
                        "(koine/schemas/finetune-job.schema.json). Admitted by "
                        "lugh's pinakes-train-slm; a job outside this provider's "
                        "specialization, or one naming cross-boundary compute, is "
                        "refused with a report."
                    ),
                },
                "stub": {
                    "type": "boolean",
                    "description": (
                        "Run against the injectable stub model — the whole "
                        "pipeline, no training stack, no GPU. Scores from a stub "
                        "run describe wiring, not a model."
                    ),
                },
            },
            ["job"],
        ),
    ),
    (
        "finetune_subscribe",
        (
            "Stream one finetune run's KFT §6 training-telemetry (loss/adherence "
            "curve) to its terminal event, which carries the minted model entity "
            "id and its KMI weight asset ids."
        ),
        _schema(
            {
                "runId": {
                    "type": _STRING,
                    "description": "The handle `finetune` returned.",
                },
                "fromIndex": {
                    "type": _NUMBER,
                    "description": (
                        "Resume point in the stream; events are replayable "
                        "(dedup on `eventId`)."
                    ),
                },
                "wait": {
                    "type": "boolean",
                    "description": (
                        "Await the terminal event (default true); false returns "
                        "what is buffered now."
                    ),
                },
            },
            ["runId"],
        ),
    ),
)


def tool_definitions() -> list[dict[str, Any]]:
    """The ``tools/list`` payload, descriptions taken from the manifest."""
    manifest = capability_manifest()
    tools: list[dict[str, Any]] = []
    for name, fallback, schema in TOOL_SPECS:
        entry = capability(name, manifest)
        tools.append(
            {
                "name": name,
                "description": entry["description"] if entry else fallback,
                "inputSchema": schema,
            }
        )
    return tools


# ── Tool handlers ────────────────────────────────────────────────────────────


#: What an invoke of the KFT pair reports on this backend. Actionable, in the
#: shape the provider's own optional-env degrade uses: it names *where* the
#: capability runs rather than pretending it does not exist.
FINETUNE_DEGRADE = (
    "The KFT finetune provider runs out of the private `lugh` checkout via "
    "`server/services/finetune-provider.ts`, which this service cannot dispatch "
    "to: it reaches every backend by import and spawns no child process. The "
    "capability stays advertised because the manifest advertises it; invoke it "
    "on the Express front, or against lugh's own KCB provider once it publishes "
    "one. See /api/_parity/coverage."
)


class ToolHandlers(Protocol):
    """The capability handlers a tool call forwards to.

    A Protocol rather than a concrete class for the same reason the TypeScript
    took an options bag: the whole MCP path is then exercisable with fakes, with
    no corpus, no Neo4j and no network.
    """

    def resolve(self, args: dict[str, Any]) -> Any: ...
    def reconcile(self, args: dict[str, Any]) -> Any: ...
    def query(self, args: dict[str, Any]) -> Any: ...
    def finetune(self, args: dict[str, Any]) -> Any: ...
    def finetune_subscribe(self, args: dict[str, Any]) -> Any: ...


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


class LiveToolHandlers:
    """The handlers used when the caller injects none — the built surfaces."""

    def resolve(self, args: dict[str, Any]) -> Any:
        """`resolve` → the lexicon-backed csid resolver (needs no Neo4j)."""
        ref = EntityRef(
            type=_text(args.get("type")),
            id=_text(args.get("id")) or None,
            name=_text(args.get("name")) or None,
            region=_text(args.get("region")) or None,
        )
        found = graph_resolver(lexicons_dir()).resolve(ref)
        return {
            "resolved": None
            if found is None
            else {
                "csid": found.csid,
                "confidence": found.confidence,
                "method": found.method,
            }
        }

    def reconcile(self, args: dict[str, Any]) -> Any:
        """`reconcile` → an in-process Wikidata acquisition into the review queue.

        A bad domain or limit is an :class:`EngineFailure`, not an unavailable
        backend: the request was wrong, and retrying it unchanged cannot help.
        That is the same classification the Express handler made by throwing
        `EngineError`.
        """
        domain = _text(args.get("domain"))
        category = resolve_acquisition_category(domain)
        if category is None:
            raise EngineFailure(
                f"Unknown pinakes-engine domain: {domain or '(none)'} — valid: "
                + ", ".join(ACQUISITION_CATALOG)
            )
        limit = args.get("limit")
        parsed: int | None = None
        if limit is not None:
            try:
                value = float(limit)
            except (TypeError, ValueError):
                raise EngineFailure("limit must be a positive number") from None
            if value <= 0:
                raise EngineFailure("limit must be a positive number")
            parsed = int(value)
        return acquire_job.run(category, limit=parsed).as_dict()

    def query(self, args: dict[str, Any]) -> Any:
        """`query` → the in-process Datalog console."""
        goal = _text(args.get("goal"))
        example = _text(args.get("example"))
        if not goal and not example:
            raise EngineFailure("a datalog goal or example is required")
        try:
            return datalog.run(goal=goal, example=example)
        except datalog.UnknownExample as exc:
            raise EngineFailure(str(exc)) from exc

    def finetune(self, args: dict[str, Any]) -> Any:
        raise EngineUnavailable(FINETUNE_DEGRADE)

    def finetune_subscribe(self, args: dict[str, Any]) -> Any:
        raise EngineUnavailable(FINETUNE_DEGRADE)


LIVE_HANDLERS = LiveToolHandlers()


# ── Tool dispatch ────────────────────────────────────────────────────────────


def _ok(data: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(data)}]}


def _error(error: str, detail: str | None = None, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"error": error, "detail": detail, **extra}
    return {"isError": True, "content": [{"type": "text", "text": json.dumps(payload)}]}


#: The `(tool name → handler attribute, error context)` table. The context is the
#: subject of the degraded message, exactly as the TypeScript spelled it.
_DISPATCH: dict[str, tuple[str, str]] = {
    "resolve": ("resolve", "graph entity resolution"),
    "reconcile": ("reconcile", "reconcile"),
    "query": ("query", "datalog query"),
    "finetune": ("finetune", "finetune"),
    "finetune_subscribe": ("finetune_subscribe", "finetune subscribe"),
}


def call_tool(
    name: str, args: dict[str, Any], handlers: ToolHandlers | None = None
) -> dict[str, Any]:
    """Run one tool, mapping every failure onto a tool *result*.

    An "unavailable" backend degrades like the HTTP 503 path, an unusable
    upstream response like the 502 path, and any other raise is contained too — a
    tool call never crashes the server.
    """
    entry = _DISPATCH.get(name)
    if entry is None:
        return _error(f"Unknown tool: {name}")
    attribute, context = entry
    handler = getattr(handlers if handlers is not None else LIVE_HANDLERS, attribute)
    try:
        return _ok(handler(args))
    except EngineUnavailable as exc:
        return _error(f"{context} is unavailable", str(exc))
    except EngineError as exc:
        return _error(f"{context} returned an unusable response", str(exc))
    except Exception as exc:  # noqa: BLE001 - a tool call never crashes the server
        logger.exception("[mcp] tool %s failed", name)
        return _error(f"{context} failed", str(exc))


# ── JSON-RPC ─────────────────────────────────────────────────────────────────


def _negotiate(requested: Any) -> str:
    """Echo the client's protocol revision when we speak it, else ours."""
    if isinstance(requested, str) and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return LATEST_PROTOCOL_VERSION


def _server_info() -> dict[str, str]:
    manifest = capability_manifest()
    return {
        "name": manifest["identity"],
        "version": manifest["x_pinakes"]["manifestVersion"],
    }


def handle_message(
    message: Any, handlers: ToolHandlers | None = None
) -> dict[str, Any] | None:
    """One JSON-RPC message in, its response out — or ``None`` for a notification.

    A notification (no ``id``) is acknowledged by the transport with a 202 and no
    body, which is what ``None`` means here.
    """
    if not isinstance(message, dict):
        return _rpc_error(None, INVALID_REQUEST, "Invalid Request")
    method = message.get("method")
    message_id = message.get("id")
    raw_params = message.get("params")
    params: dict[str, Any] = raw_params if isinstance(raw_params, dict) else {}

    if message_id is None:
        # Notifications (`notifications/initialized`, cancellations) are accepted
        # and answered with nothing; a stateless server has no state to update.
        return None

    if method == "initialize":
        return _rpc_result(
            message_id,
            {
                "protocolVersion": _negotiate(params.get("protocolVersion")),
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": _server_info(),
            },
        )
    if method == "ping":
        return _rpc_result(message_id, {})
    if method == "tools/list":
        return _rpc_result(message_id, {"tools": tool_definitions()})
    if method == "tools/call":
        name = params.get("name")
        if not isinstance(name, str):
            return _rpc_error(message_id, INVALID_REQUEST, "tools/call requires a name")
        arguments = params.get("arguments")
        return _rpc_result(
            message_id,
            call_tool(name, arguments if isinstance(arguments, dict) else {}, handlers),
        )
    return _rpc_error(message_id, METHOD_NOT_FOUND, f"Method not found: {method}")


def _rpc_result(message_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": message_id, "result": result}


def _rpc_error(message_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "error": {"code": code, "message": message},
    }


def handle_payload(
    payload: Any, handlers: ToolHandlers | None = None
) -> list[dict[str, Any]]:
    """A whole POST body — one message or a batch — into its responses.

    An all-notification batch yields no responses, which the route answers with a
    202 and an empty body (the MCP streamable-HTTP rule).
    """
    messages = payload if isinstance(payload, list) else [payload]
    responses: list[dict[str, Any]] = []
    for message in messages:
        response = handle_message(message, handlers)
        if response is not None:
            responses.append(response)
    return responses
