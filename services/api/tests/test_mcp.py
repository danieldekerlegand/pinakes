"""The MCP invocation front at `/mcp` (pinakes:65 US-1).

`server/routes/mcp.test.ts` drove this path with the official SDK client over a
real socket. There is no equivalent Python MCP client in this stack, so the
protocol is exercised directly over the JSON-RPC wire — which is what the SDK
client puts on it, and what any other client will too.

The tool handlers are **injected** for everything except the two tests that
deliberately reach the built surfaces, so the whole path runs with no corpus, no
Neo4j and no network.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.engine.errors import EngineFailure, EngineUnavailable
from pinakes.kcb import mcp
from pinakes.kcb.manifest import capability_manifest

TOOL_NAMES = ["resolve", "reconcile", "query", "finetune", "finetune_subscribe"]


class FakeHandlers:
    """Stands in for the built surfaces; records what each tool was called with."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def resolve(self, args: dict[str, Any]) -> Any:
        self.calls.append(("resolve", args))
        return {
            "resolved": {
                "csid": "cs:language:lat",
                "confidence": 1.0,
                "method": "alias",
            }
        }

    def reconcile(self, args: dict[str, Any]) -> Any:
        self.calls.append(("reconcile", args))
        return {"domain": "civilizations", "queued": 2}

    def query(self, args: dict[str, Any]) -> Any:
        self.calls.append(("query", args))
        # Stand in for Neo4j / the corpus being down — must surface as a tool error.
        raise EngineUnavailable("no corpus")

    def finetune(self, args: dict[str, Any]) -> Any:
        raise EngineUnavailable(mcp.FINETUNE_DEGRADE)

    def finetune_subscribe(self, args: dict[str, Any]) -> Any:
        raise EngineUnavailable(mcp.FINETUNE_DEGRADE)


@pytest.fixture
def handlers() -> FakeHandlers:
    return FakeHandlers()


def decode(result: dict[str, Any]) -> Any:
    """A tool result's first text-content block, as JSON."""
    text = next(c["text"] for c in result["content"] if c["type"] == "text")
    return json.loads(text)


def rpc(client: TestClient, method: str, params: dict[str, Any] | None = None) -> Any:
    response = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    )
    assert response.status_code == 200, response.text
    return response.json()


# ── The protocol ─────────────────────────────────────────────────────────────


def test_initialize_declares_the_tools_capability_and_this_identity(
    unbuilt_client: TestClient,
) -> None:
    body = rpc(unbuilt_client, "initialize", {"protocolVersion": "2025-06-18"})

    result = body["result"]
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    manifest = capability_manifest()
    assert result["serverInfo"] == {
        "name": manifest["identity"],
        "version": manifest["x_pinakes"]["manifestVersion"],
    }


def test_a_supported_protocol_revision_is_echoed_back(
    unbuilt_client: TestClient,
) -> None:
    """Negotiation: speak the client's revision when we can, ours when we cannot."""
    older = rpc(unbuilt_client, "initialize", {"protocolVersion": "2024-11-05"})
    unknown = rpc(unbuilt_client, "initialize", {"protocolVersion": "1999-01-01"})

    assert older["result"]["protocolVersion"] == "2024-11-05"
    assert unknown["result"]["protocolVersion"] == mcp.LATEST_PROTOCOL_VERSION


def test_a_notification_is_accepted_with_no_body(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}
    )

    assert response.status_code == 202
    assert response.content == b""


def test_a_batch_answers_only_its_requests(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/mcp",
        json=[
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 7, "method": "ping"},
        ],
    )

    assert response.status_code == 200
    assert response.json() == [{"jsonrpc": "2.0", "id": 7, "result": {}}]


def test_an_unknown_method_is_a_json_rpc_error(unbuilt_client: TestClient) -> None:
    body = rpc(unbuilt_client, "resources/list")

    assert body["error"]["code"] == mcp.METHOD_NOT_FOUND
    assert "resources/list" in body["error"]["message"]


def test_unparseable_json_is_a_parse_error(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/mcp", content=b"{not json", headers={"content-type": "application/json"}
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700


@pytest.mark.parametrize("method", ["GET", "DELETE"])
def test_the_session_verbs_are_not_served_by_a_stateless_transport(
    unbuilt_client: TestClient, method: str
) -> None:
    response = unbuilt_client.request(method, "/mcp")

    assert response.status_code == 405
    body = response.json()
    assert body["error"]["code"] == mcp.METHOD_NOT_ALLOWED
    assert body["id"] is None


# ── The tool table ───────────────────────────────────────────────────────────


def test_the_advertised_tools_are_the_manifest_capabilities_plus_the_stream_verb(
    unbuilt_client: TestClient,
) -> None:
    tools = rpc(unbuilt_client, "tools/list")["result"]["tools"]

    assert [t["name"] for t in tools] == TOOL_NAMES


def test_a_tool_description_is_read_off_the_manifest(
    unbuilt_client: TestClient,
) -> None:
    """So the tools can never drift from `contracts/capability-manifest.json`."""
    tools = {t["name"]: t for t in rpc(unbuilt_client, "tools/list")["result"]["tools"]}
    manifest = capability_manifest()

    for entry in manifest["capabilities"]:
        assert tools[entry["name"]]["description"] == entry["description"]


def test_the_input_schemas_are_draft_07_and_closed(
    unbuilt_client: TestClient,
) -> None:
    tools = {t["name"]: t for t in rpc(unbuilt_client, "tools/list")["result"]["tools"]}

    for tool in tools.values():
        schema = tool["inputSchema"]
        assert schema["$schema"] == "http://json-schema.org/draft-07/schema#"
        assert schema["additionalProperties"] is False
    assert tools["resolve"]["inputSchema"]["required"] == ["type"]
    # `query` takes a goal *or* an example, so neither is required at the schema
    # level — the handler is what rejects "neither".
    assert tools["query"]["inputSchema"]["required"] == []


# ── Tool calls ───────────────────────────────────────────────────────────────


def test_a_tool_call_forwards_its_arguments_and_returns_json_text(
    handlers: FakeHandlers,
) -> None:
    result = mcp.call_tool("resolve", {"type": "language", "id": "lat"}, handlers)

    assert handlers.calls == [("resolve", {"type": "language", "id": "lat"})]
    assert decode(result)["resolved"]["csid"] == "cs:language:lat"
    assert "isError" not in result


def test_an_unavailable_backend_is_a_tool_error_not_a_crash(
    handlers: FakeHandlers,
) -> None:
    """The MCP shape of the HTTP 503 the graph routes give."""
    result = mcp.call_tool("query", {"goal": "main."}, handlers)

    assert result["isError"] is True
    payload = decode(result)
    assert payload["error"] == "datalog query is unavailable"
    assert payload["detail"] == "no corpus"


def test_a_bad_request_is_the_502_shaped_error(handlers: FakeHandlers) -> None:
    class Rejecting(FakeHandlers):
        def reconcile(self, args: dict[str, Any]) -> Any:
            raise EngineFailure("Unknown pinakes-engine domain: moons")

    result = mcp.call_tool("reconcile", {"domain": "moons"}, Rejecting())

    assert result["isError"] is True
    assert decode(result)["error"] == "reconcile returned an unusable response"


def test_an_unexpected_raise_is_contained(handlers: FakeHandlers) -> None:
    class Exploding(FakeHandlers):
        def resolve(self, args: dict[str, Any]) -> Any:
            raise RuntimeError("boom")

    result = mcp.call_tool("resolve", {"type": "language"}, Exploding())

    assert result["isError"] is True
    assert decode(result)["error"] == "graph entity resolution failed"


def test_an_unknown_tool_is_an_error_result(handlers: FakeHandlers) -> None:
    result = mcp.call_tool("delete_everything", {}, handlers)

    assert result["isError"] is True
    assert "Unknown tool" in decode(result)["error"]


def test_a_call_over_the_wire_carries_the_result_through(
    unbuilt_client: TestClient,
) -> None:
    """End to end: the transport, the dispatch and a live handler.

    `resolve` reaches the real lexicon resolver — over the empty temp corpus
    `conftest.py` hands every test, which resolves nothing. That is the point:
    the tool answers `null` rather than failing, exactly as the HTTP route does.
    """
    body = rpc(
        unbuilt_client,
        "tools/call",
        {"name": "resolve", "arguments": {"type": "language", "id": "lat"}},
    )

    assert decode(body["result"]) == {"resolved": None}


# ── The KFT pair ─────────────────────────────────────────────────────────────


def test_the_finetune_pair_is_advertised(unbuilt_client: TestClient) -> None:
    """Never gate the advertisement on the runner being present.

    The manifest advertises the capability, and a describe surface that
    disagreed with the manifest would break the FT-K tiebreak — a router reading
    `tools/list` would conclude Pinakes is not a finetune provider at all.
    """
    tools = {t["name"] for t in rpc(unbuilt_client, "tools/list")["result"]["tools"]}

    assert {"finetune", "finetune_subscribe"} <= tools


@pytest.mark.parametrize("tool", ["finetune", "finetune_subscribe"])
def test_invoking_the_finetune_pair_degrades_with_somewhere_to_go(
    unbuilt_client: TestClient, tool: str
) -> None:
    """The invoke is what degrades, and the message has to be actionable.

    Dispatching to `lugh` means spawning a subprocess, which this service does
    not do (`test_engine_inprocess.test_no_sidecar_or_subprocess_seam`), so the
    tool reports where the capability *does* run instead of failing blankly.
    """
    body = rpc(
        unbuilt_client,
        "tools/call",
        {"name": tool, "arguments": {"job": {}, "runId": "r"}},
    )

    result = body["result"]
    assert result["isError"] is True
    payload = decode(result)
    assert payload["error"].endswith("is unavailable")
    assert "lugh" in payload["detail"]
    # The degrade must name a runner that exists. It used to point at the Express
    # front; 80-cutover US-2 deleted that, so it names lugh's console script.
    assert "pinakes-train-slm" in payload["detail"]
