/**
 * Publishing the capability manifest to the KCB discovery registry.
 *
 * KCB §3 makes the registry a *cache/index* over the providers' own surfaces, not a
 * source of truth: "a provider's manifest is authoritative; the registry just makes
 * it findable", and §3's route-by-lookup rule (ADR-0001) means peers connect
 * **directly** to Pinakes once they have its address. So registration is strictly
 * best-effort — this module pushes the manifest when a registry URL is configured
 * and reports the outcome, and **never** throws, retries into the request path, or
 * gates serving. With the registry down (or never configured) Pinakes keeps serving
 * its manifest at `/.well-known/kcb-manifest.json` and its capabilities at the same
 * already-built routes; discovery just falls back from "ask the registry" to "read
 * the provider".
 *
 * Configuration is env-only, matching `engine-client.ts`:
 * `KCB_REGISTRY_URL` (unset = no registry, publish is a no-op), `KCB_REGISTRY_TIMEOUT_MS`,
 * and `PINAKES_PUBLIC_ORIGIN` for the absolute URLs the registry hands out.
 */
import { capabilityManifestFor, type CapabilityManifest } from "@shared/capability-manifest";
import { signManifestForServing } from "./manifest-signing";

/** Default publish timeout, in ms. */
export const DEFAULT_REGISTRY_TIMEOUT_MS = 5_000;

/** The outcome of a publish attempt. */
export interface PublishResult {
  /** Whether the registry accepted the manifest. */
  readonly registered: boolean;
  /**
   * Always true: registration is an index update, so the capabilities stay
   * invocable at their own endpoints whether or not it succeeded (KCB §3).
   */
  readonly servingDirectly: true;
  /** The registry that was tried, or null when none is configured. */
  readonly registryUrl: string | null;
  /** Human-readable outcome for `/api/kcb/status` and the startup log. */
  readonly detail: string;
}

export interface PublishOptions {
  /** Registry base URL (default: `KCB_REGISTRY_URL`). */
  readonly registryUrl?: string | null;
  /** Origin the registry should dial back on (default: `PINAKES_PUBLIC_ORIGIN`). */
  readonly origin?: string | null;
  /** Timeout in ms (default: `KCB_REGISTRY_TIMEOUT_MS`, else 5000). */
  readonly timeoutMs?: number;
  /** Injectable fetch, so tests exercise the unreachable path without a network. */
  readonly fetchImpl?: typeof fetch;
}

function configuredRegistryUrl(): string | null {
  const raw = process.env.KCB_REGISTRY_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** The origin peers dial back on, or null when it is not configured. */
export function configuredOrigin(): string | null {
  const raw = process.env.PINAKES_PUBLIC_ORIGIN?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Push the manifest to the discovery registry. Never throws: an unreachable,
 * misconfigured, or rejecting registry resolves to `registered: false` with the
 * reason, and `servingDirectly` stays true either way.
 */
export async function publishCapabilityManifest(
  options: PublishOptions = {},
): Promise<PublishResult> {
  const raw = options.registryUrl === undefined ? configuredRegistryUrl() : options.registryUrl;
  // Normalize whether it came from env or an explicit option — a trailing slash would
  // otherwise produce a `//manifests` path the registry may not route.
  const registryUrl = raw ? raw.trim().replace(/\/+$/, "") : null;
  if (!registryUrl) {
    return {
      registered: false,
      servingDirectly: true,
      registryUrl: null,
      detail:
        "No KCB_REGISTRY_URL configured — serving the manifest and capabilities directly (KCB §3: the registry is a cache, not a dependency).",
    };
  }

  const origin = options.origin === undefined ? configuredOrigin() : options.origin;
  // Publish the same document a consumer would fetch: origin-absolutized (dialable
  // addresses, mcp/a2a included) and signed when a key is configured (KCB §5), so the
  // registry entry carries a verifiable `signing.key_id` + `signature`.
  const manifest: CapabilityManifest = signManifestForServing(capabilityManifestFor(origin));
  const configured = options.timeoutMs ?? Number(process.env.KCB_REGISTRY_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REGISTRY_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`${registryUrl}/manifests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(manifest),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        registered: false,
        servingDirectly: true,
        registryUrl,
        detail: `Registry rejected the manifest (HTTP ${res.status}) — capabilities remain invocable directly.`,
      };
    }
    return {
      registered: true,
      servingDirectly: true,
      registryUrl,
      detail: `Published ${manifest.identity} to the KCB registry.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      registered: false,
      servingDirectly: true,
      registryUrl,
      detail: `Registry unreachable (${reason}) — capabilities remain invocable directly.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
