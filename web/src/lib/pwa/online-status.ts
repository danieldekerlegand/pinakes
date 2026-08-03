// Online/offline detection (US-011). Pure helpers over injected globals so the
// offline-indicator logic is node-testable without a DOM.

export interface OnlineTarget {
  addEventListener(type: "online" | "offline", listener: () => void): void;
  removeEventListener(type: "online" | "offline", listener: () => void): void;
}

export interface OnlineNavigator {
  onLine?: boolean;
}

/** Current connectivity; defaults to online when `onLine` is unavailable. */
export function getOnlineStatus(
  nav: OnlineNavigator | null | undefined = typeof navigator !== "undefined"
    ? navigator
    : undefined,
): boolean {
  return typeof nav?.onLine === "boolean" ? nav.onLine : true;
}

/**
 * Subscribe to connectivity changes; invokes `callback(isOnline)` on transitions.
 * Returns an unsubscribe function.
 */
export function subscribeOnlineStatus(
  target: OnlineTarget,
  callback: (online: boolean) => void,
): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  target.addEventListener("online", handleOnline);
  target.addEventListener("offline", handleOffline);
  return () => {
    target.removeEventListener("online", handleOnline);
    target.removeEventListener("offline", handleOffline);
  };
}
