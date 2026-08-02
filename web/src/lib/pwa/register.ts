// Service-worker registration (US-011). Pure over injected deps so registration
// gating (production-only, feature-detection, error-swallow) is node-testable.

export interface ServiceWorkerContainerLike {
  register(
    url: string,
    options?: { scope?: string },
  ): Promise<ServiceWorkerRegistration>;
  getRegistrations?(): Promise<ServiceWorkerRegistration[]>;
}

export interface NavigatorLike {
  serviceWorker?: ServiceWorkerContainerLike;
}

export interface RegisterOptions {
  /** Injected for tests; defaults to the global navigator when present. */
  navigator?: NavigatorLike | null;
  /** SW is only registered in production (dev uses Vite HMR, which a SW breaks). */
  isProduction?: boolean;
  swUrl?: string;
  scope?: string;
  /** Optional error sink (defaults to console.warn). */
  onError?: (err: unknown) => void;
}

function defaultNavigator(): NavigatorLike | null {
  return typeof navigator !== "undefined"
    ? (navigator as unknown as NavigatorLike)
    : null;
}

/**
 * Register the service worker. Returns the registration, or null when skipped
 * (dev mode, no SW support, or a registration error — never throws).
 */
export async function registerServiceWorker(
  options: RegisterOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  const {
    navigator: nav = defaultNavigator(),
    isProduction = true,
    swUrl = "/sw.js",
    scope = "/",
    onError,
  } = options;

  if (!isProduction) return null;
  if (!nav || !nav.serviceWorker) return null;

  try {
    return await nav.serviceWorker.register(swUrl, { scope });
  } catch (err) {
    (onError ?? ((e) => console.warn("[pwa] SW registration failed", e)))(err);
    return null;
  }
}

/**
 * Unregister every controlling service worker — useful as an escape hatch (e.g.
 * a "reset offline cache" action). Returns the number unregistered.
 */
export async function unregisterServiceWorkers(
  navigatorLike: NavigatorLike | null = defaultNavigator(),
): Promise<number> {
  const container = navigatorLike?.serviceWorker;
  if (!container?.getRegistrations) return 0;
  try {
    const regs = await container.getRegistrations();
    const results = await Promise.all(regs.map((r) => r.unregister()));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}
