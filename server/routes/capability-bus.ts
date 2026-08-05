/**
 * KCB capability-bus routes — how Pinakes publishes itself on the Koine control
 * plane (`koine/specs/capability-bus.md`).
 *
 * **Ported to Python** (pinakes:65 US-1): the group is served by
 * `services/api/src/pinakes/routers/capability_bus.py` over `pinakes.kcb`, which
 * carries the same origin absolutization, the same Ed25519 signing (a signature
 * minted on either side verifies on the other — the canonical signing input is
 * byte-identical) and the same best-effort registry push.
 *
 * `GET /.well-known/kcb-manifest.json` — the KCB §2 manifest (the **describe**
 *   verb, §4). Well-known so a crawler-populated registry can pull it, and so a
 *   consumer that cannot reach the registry can read it straight off the provider.
 *   **Still answers here**, like `GET /api/citations`: it is what
 *   `participation-self-sufficiency.test.ts` drives to prove this repo describes
 *   itself with no external config. Serving it twice cannot drift — it is a pure
 *   function of a committed JSON file, and the two outputs are asserted equal.
 * `GET /api/kcb/manifest` — the same document under the API prefix. **Still
 *   answers here** for a second reason: its recorded fixture
 *   (`contracts/parity/fixtures/get-kcb-manifest.json`) is replayed against *this*
 *   app, and a baseline that stops reproducing its own recording is no baseline.
 * `GET /api/kcb/capabilities` — the invocation directory: each capability with the
 *   already-built endpoints behind it. This is the fallback path that makes the
 *   registry optional (KCB §3 is route-by-lookup, never a proxy). **Retired to 501.**
 * `GET /api/kcb/status` — whether registration with the discovery registry
 *   succeeded, and the standing fact that the capabilities are served regardless.
 *   **Retired to 501.**
 *
 * These routes are a **surface wrapper only**: nothing here resolves, reconciles or
 * queries anything. Every capability points at merged code (`graph-resolver.ts`,
 * `pinakes_engine/schema/reconcile.py`, the `/api/graph/*` routes), and invocation
 * goes to those endpoints directly. The manifest itself is `contracts/capability-manifest.json`.
 *
 * Registration is fired once at registration time and is best-effort; `publish` is
 * injectable so tests drive the registry-unreachable path with no network.
 */
import { type Express, type Request, type Response } from "express";

import { capabilityManifestFor } from "@contracts/capability-manifest";
import {
  configuredOrigin,
  publishCapabilityManifest,
  type PublishResult,
} from "../services/capability-registry";
import { signManifestForServing } from "../services/manifest-signing";

/** Where the manifest is served for registry crawlers (KCB §3 pull population). */
export const MANIFEST_WELL_KNOWN_PATH = "/.well-known/kcb-manifest.json";

/** The Python module that now serves this group. */
export const PORTED_TO = "services/api/src/pinakes/routers/capability_bus.py";

/** The two routes this backend handed over; the manifest fronts still answer. */
export const PORTED_ROUTES = ["/api/kcb/capabilities", "/api/kcb/status"] as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process.
 */
function portedToPython(route: string) {
  return (_req: Request, res: Response): void => {
    res.status(501).json({
      error: PORTED_ERROR,
      message:
        `${route} has been ported to the Python service and is served there ` +
        `(${PORTED_TO}). The Express handler is retired.`,
      route,
      servedBy: PORTED_TO,
      coverage: "/api/_parity/coverage",
    });
  };
}

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

  if (!options.skipRegistration) {
    // Fire-and-forget: a registry that is slow, down, or absent must not delay or
    // fail route registration (KCB §3 — the registry is an index, not a dependency).
    //
    // The *outcome* is no longer kept: `/api/kcb/status` reported it and that route
    // is retired, so this process now only logs. Both backends publishing the same
    // manifest to the same registry is harmless — the push is an idempotent index
    // update keyed on `identity`, not a claim of ownership.
    void publish()
      .then((result) => {
        if (!result.registered && result.registryUrl) {
          console.warn(`[kcb] ${result.detail}`);
        }
      })
      .catch((error: unknown) => {
        console.warn(
          `[kcb] Registration failed (${error instanceof Error ? error.message : String(error)}) — capabilities remain invocable directly.`,
        );
      });
  }

  function sendManifest(req: Request, res: Response): void {
    // Absolutize for the requesting origin, then sign with the env-configured key (a no-op
    // that serves the document unsigned when no key is set — KCB §5 signing is a SHOULD).
    res.json(signManifestForServing(capabilityManifestFor(originFor(req, originOption))));
  }

  app.get(MANIFEST_WELL_KNOWN_PATH, sendManifest);
  app.get("/api/kcb/manifest", sendManifest);

  // ── Ported to the Python service (pinakes:65 US-1) ─────────────────────────
  //
  // The invocation directory and the registration status are now served by
  // `pinakes.routers.capability_bus`. Registered, not deleted: the path set is
  // the parity baseline's own harvest source.
  for (const route of PORTED_ROUTES) {
    app.get(route, portedToPython(`GET ${route}`));
  }
}
