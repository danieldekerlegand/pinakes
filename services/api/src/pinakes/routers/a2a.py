"""The A2A agent-card front (pinakes:65 US-1).

`GET /.well-known/agent-card.json` — ported off `server/routes/a2a.ts`. KCB §4
names an A2A message as one of the two ways to *invoke* a capability (the other
is the MCP tool call `/mcp` serves), and KCB §2 folds the whole KCB manifest onto
the provider's standard AgentCard rather than publishing a second document.

The card itself is built in :mod:`pinakes.kcb.agent_card`; this file is the
route, and the only thing it decides is the origin — same rule as the
capability-bus routes, so the two well-known fronts always agree about where
this deployment is.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from pinakes.kcb.agent_card import AGENT_CARD_ROUTE_PATH, build_agent_card
from pinakes.routers._origin import origin_for

router = APIRouter(tags=["kcb"])


@router.get(AGENT_CARD_ROUTE_PATH)
def agent_card(request: Request) -> dict[str, Any]:
    """The A2A AgentCard, carrying the KCB manifest as an extension."""
    return build_agent_card(origin_for(request))
