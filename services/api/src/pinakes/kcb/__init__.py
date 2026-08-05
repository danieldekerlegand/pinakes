"""How Pinakes publishes *itself* on the Koine control plane.

The Python half of the KCB (`koine/specs/capability-bus.md`) surface that
`server/routes/{capability-bus,a2a,mcp}.ts` used to serve: the manifest as
served to a consumer, the A2A agent-card that carries it, the MCP server that
invokes it, and the best-effort registry push.

Everything here is a **surface wrapper**, and that rule survives the port
unchanged: nothing in this package resolves, reconciles or queries anything. The
manifest points at already-built surfaces and the MCP tools forward to them —
now by import (:mod:`pinakes.engine`, :mod:`pinakes.search.graph_resolver`,
:mod:`pinakes.acquire`) rather than over an HTTP hop to a sidecar.
"""
