/**
 * A2A agent-card surface for the KCB capabilities (US-2, `/.well-known/agent-card.json`).
 *
 * KCB §4 names an A2A message as one of the two ways to *invoke* a capability (the
 * other is an MCP tool call, US-1); KCB §2 (0.3.0) folds the whole KCB manifest onto
 * the provider's standard A2A **AgentCard** rather than a second document — the KCB
 * payload rides as one entry under the card's `capabilities.extensions[]` array,
 * identified by the stable extension URI {@link KCB_MANIFEST_EXTENSION_URI}
 * (`koine/specs/capability-bus.md` §2, the upstream
 * `koine:11-kcb-manifest-agentcard-extension` shape).
 *
 * The card is **built with the official A2A JS SDK** (`@a2a-js/sdk`): the served
 * document is produced through the SDK's `AgentCard` codec (`fromJSON`→`toJSON`), so
 * it is a validated, spec-shaped AgentCard rather than a hand-rolled JSON blob.
 *
 * **Surface wrapper only** (server/CLAUDE.md + contracts/CLAUDE.md): the card advertises
 * every capability on the manifest as an A2A skill — the three KCB §6 ones
 * (`resolve`/`reconcile`/`query`) plus the specialized KFT `finetune` provider
 * (90-US-3) — with descriptions/tags mirroring `contracts/capability-manifest.json`, and
 * points its invocation url at the `/mcp` surface US-1 stood up. Nothing here
 * resolves, reconciles, queries or trains anything — a crawler that pulls ONLY this
 * card recovers the full KCB §2 manifest from the extension `params` (including the
 * `x_specialization` block the KFT §9/FT-K tiebreak reads) and dials the built
 * surfaces. Skills are derived from the manifest, so a new capability becomes a skill
 * by being declared there, never by editing this file.
 */
import { type Express, type Request, type Response } from "express";
import {
  AgentCard,
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
} from "@a2a-js/sdk";

import { CAPABILITY_MANIFEST } from "@contracts/capability-manifest";
import { configuredOrigin } from "../services/capability-registry";

/** Where the A2A agent-card is served (mirrors `endpoints.a2a`; SDK path + leading `/`). */
export const AGENT_CARD_ROUTE_PATH = `/${AGENT_CARD_PATH}`;

/**
 * The stable extension URI the KCB manifest rides under on the AgentCard
 * (`koine/specs/capability-bus.md` §2 — `https://koine.dev/kcb/manifest/0.3`). A
 * crawler recovers the KCB §2 payload from the `capabilities.extensions[]` entry
 * whose `uri` is this.
 */
export const KCB_MANIFEST_EXTENSION_URI = "https://koine.dev/kcb/manifest/0.3";

/** Join an origin and a server-relative path into an absolute URL (else return it as-is). */
function abs(origin: string | null, path: string): string {
  return origin ? `${origin.replace(/\/+$/, "")}${path}` : path;
}

/**
 * The MCP invocation url the card advertises, absolutized against `origin` when one
 * is known (so a crawler that pulls only the card can dial it). Falls back to the
 * manifest's own HTTP base when `endpoints.mcp` is somehow unset.
 */
function mcpUrl(origin: string | null): string {
  return abs(origin, CAPABILITY_MANIFEST.endpoints.mcp ?? CAPABILITY_MANIFEST.endpoints.http);
}

/**
 * Tags mirroring a capability: its name, the planes it connects (KCB §2.1 ports),
 * and — on a narrow provider — its `x_specialization` signal, so a crawler that
 * matches skills by tag can break the KFT §9/FT-K tie (specialized beats general)
 * from the card alone, without pulling the manifest extension.
 */
function skillTags(capability: (typeof CAPABILITY_MANIFEST.capabilities)[number]): string[] {
  const planes = [...capability.inputs, ...capability.outputs].map((p) => p.plane);
  const spec = capability.x_specialization;
  const specialization = spec
    ? [spec.provider_class, spec.modality, spec.egress, ...spec.domains]
    : [];
  return Array.from(
    new Set([capability.name, ...planes, ...specialization, "koine-capability-bus"]),
  );
}

/**
 * Build the served A2A AgentCard for `origin`. The three KCB §6 capabilities become
 * A2A skills; the full KCB manifest (§2 payload — `produces`/`consumes`/`capabilities`
 * with cross-plane ports + `cost`, `auth`, `signing`, and the `mcp` tools url) rides
 * as one `AgentExtension`. Round-tripped through the SDK codec so the result is a
 * validated AgentCard.
 */
export function buildAgentCard(origin: string | null): unknown {
  const m = CAPABILITY_MANIFEST;
  const mcp = mcpUrl(origin);

  const skills = m.capabilities.map((c) => ({
    id: c.name,
    name: c.name,
    description: c.description,
    tags: skillTags(c),
    examples: [],
    inputModes: [],
    outputModes: [],
    securityRequirements: [],
  }));

  const card = {
    // The card's own agent id IS the KINP identity (KCB §2 — identity is read off the
    // card's `name`), so a resolver dialing the card knows whom it is talking to.
    name: m.identity,
    description: m.x_pinakes.title,
    supportedInterfaces: [
      // Pinakes's invocation surface is the MCP server (US-1); advertise it as the
      // reachable interface, and carry it again as the KCB extension's `mcp` field.
      {
        url: mcp,
        protocolBinding: "MCP",
        tenant: "",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: { url: m.x_pinakes.identityIri, organization: "Pinakes" },
    version: m.x_pinakes.manifestVersion,
    capabilities: {
      streaming: false,
      extensions: [
        {
          uri: KCB_MANIFEST_EXTENSION_URI,
          description: "Koine capability-bus manifest",
          required: false,
          params: {
            kcb_version: m.kcb_version,
            // Non-A2A endpoint the extension still needs (KCB §2 — the MCP tools url).
            mcp,
            produces: m.produces,
            consumes: m.consumes,
            capabilities: m.capabilities,
            auth: m.auth,
            signing: m.signing,
          },
        },
      ],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills,
    signatures: [],
  };

  // Build through the official SDK codec: validate + normalize into an AgentCard.
  return AgentCard.toJSON(AgentCard.fromJSON(card));
}

/** Options for {@link registerA2aRoutes}; `origin` mirrors the capability-bus route. */
export interface A2aRouteOptions {
  /**
   * Origin peers should dial (default: `PINAKES_PUBLIC_ORIGIN`, else the request's
   * own origin so a card fetched over the network is dialable; explicit `null` serves
   * the as-authored, server-relative card).
   */
  readonly origin?: string | null;
}

/**
 * The origin to absolutize against — an explicit option wins (`null` asks for the
 * as-authored card), else the configured public origin, else the request's own origin.
 */
function originFor(req: Request, option: string | null | undefined): string | null {
  if (option !== undefined) return option;
  const configured = configuredOrigin();
  if (configured) return configured;
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
}

/**
 * Serve the A2A agent-card at {@link AGENT_CARD_ROUTE_PATH}. Wired into
 * `registerRoutes` alongside the MCP surface (server/CLAUDE.md route-registration
 * order), so the two KCB §4 invoke fronts sit together.
 */
export function registerA2aRoutes(app: Express, options: A2aRouteOptions = {}): void {
  app.get(AGENT_CARD_ROUTE_PATH, (req: Request, res: Response) => {
    res.json(buildAgentCard(originFor(req, options.origin)));
  });
}
