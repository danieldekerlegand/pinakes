/**
 * KCB capability-bus routes — how Pinakes publishes itself on the Koine control
 * plane (`koine/specs/capability-bus.md`).
 *
 * `GET /.well-known/kcb-manifest.json` — the KCB §2 manifest (the **describe**
 *   verb, §4). Well-known so a crawler-populated registry can pull it, and so a
 *   consumer that cannot reach the registry can read it straight off the provider.
 * `GET /api/kcb/manifest` — the same document under the API prefix.
 * `GET /api/kcb/capabilities` — the invocation directory: each capability with the
 *   already-built endpoints behind it. This is the fallback path that makes the
 *   registry optional (KCB §3 is route-by-lookup, never a proxy).
 * `GET /api/kcb/status` — whether registration with the discovery registry
 *   succeeded, and the standing fact that the capabilities are served regardless.
 *
 * These routes are a **surface wrapper only**: nothing here resolves, reconciles or
 * queries anything. Every capability points at merged code (`graph-resolver.ts`,
 * `culturescrape/schema/reconcile.py`, the `/api/graph/*` routes), and invocation
 * goes to those endpoints directly. The manifest itself is `shared/capability-manifest.json`.
 *
 * Registration is fired once at registration time and is best-effort; `publish` is
 * injectable so tests drive the registry-unreachable path with no network.
 */
import { type Express, type Request, type Response } from "express";

import {
  capabilityManifestFor,
  CAPABILITY_MANIFEST,
  isManifestSigned,
} from "@shared/capability-manifest";
import {
  configuredOrigin,
  publishCapabilityManifest,
  type PublishResult,
} from "../services/capability-registry";

/** Where the manifest is served for registry crawlers (KCB §3 pull population). */
export const MANIFEST_WELL_KNOWN_PATH = "/.well-known/kcb-manifest.json";

export interface CapabilityBusRouteOptions {
  /**
   * Origin peers should dial (default: `PINAKES_PUBLIC_ORIGIN`, else the request's
   * own origin, so a manifest fetched over the network is always dialable).
   */
  readonly origin?: string | null;
  /** Registry publisher (default: the live best-effort push). Injectable for tests. */
  readonly publish?: () => Promise<PublishResult>;
  /** Skip the startup registration attempt (default: false). */
  readonly skipRegistration?: boolean;
}

/**
 * The origin to absolutize against. An explicit option wins (a `null` option asks
 * for the as-authored, server-relative manifest); otherwise the configured public
 * origin, falling back to the origin this request arrived on.
 */
function originFor(req: Request, option: string | null | undefined): string | null {
  if (option !== undefined) return option;
  const configured = configuredOrigin();
  if (configured) return configured;
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
}

export function registerCapabilityBusRoutes(
  app: Express,
  options: CapabilityBusRouteOptions = {},
): void {
  const originOption = options.origin;
  const publish = options.publish ?? (() => publishCapabilityManifest());

  /**
   * The last publish outcome. Starts as "not attempted" so `/api/kcb/status` is
   * answerable before (and if) registration ever completes — serving never waits
   * on the registry.
   */
  let registration: PublishResult = {
    registered: false,
    servingDirectly: true,
    registryUrl: null,
    detail: "Registration not attempted yet — capabilities are already being served.",
  };

  if (!options.skipRegistration) {
    // Fire-and-forget: a registry that is slow, down, or absent must not delay or
    // fail route registration (KCB §3 — the registry is an index, not a dependency).
    void publish()
      .then((result) => {
        registration = result;
        if (!result.registered && result.registryUrl) {
          console.warn(`[kcb] ${result.detail}`);
        }
      })
      .catch((error: unknown) => {
        registration = {
          registered: false,
          servingDirectly: true,
          registryUrl: null,
          detail: `Registration failed (${error instanceof Error ? error.message : String(error)}) — capabilities remain invocable directly.`,
        };
      });
  }

  function sendManifest(req: Request, res: Response): void {
    res.json(capabilityManifestFor(originFor(req, originOption)));
  }

  app.get(MANIFEST_WELL_KNOWN_PATH, sendManifest);
  app.get("/api/kcb/manifest", sendManifest);

  /** The invocation directory — capabilities + the built endpoints behind them. */
  app.get("/api/kcb/capabilities", (req: Request, res: Response) => {
    const manifest = capabilityManifestFor(originFor(req, originOption));
    res.json({
      identity: manifest.identity,
      kcbVersion: manifest.kcb_version,
      manifest: manifest.endpoints.manifest,
      capabilities: manifest.capabilities.map((c) => ({
        name: c.name,
        description: c.description,
        cost: c.cost,
        grant: c.x_grant,
        surfaces: c.x_surfaces,
      })),
    });
  });

  /** Registry-registration status. `servingDirectly` is true no matter the outcome. */
  app.get("/api/kcb/status", (_req: Request, res: Response) => {
    res.json({
      identity: CAPABILITY_MANIFEST.identity,
      kcbVersion: CAPABILITY_MANIFEST.kcb_version,
      manifestVersion: CAPABILITY_MANIFEST.x_pinakes.manifestVersion,
      signed: isManifestSigned(),
      registry: registration,
    });
  });
}
