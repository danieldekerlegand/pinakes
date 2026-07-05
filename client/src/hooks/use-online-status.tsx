import { useSyncExternalStore } from "react";
import {
  getOnlineStatus,
  subscribeOnlineStatus,
} from "@/lib/pwa/online-status";

/**
 * React binding for connectivity (US-011). Uses useSyncExternalStore so the value
 * stays consistent across concurrent renders. SSR/no-window → assumes online.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onChange) =>
      typeof window === "undefined"
        ? () => {}
        : subscribeOnlineStatus(window, () => onChange()),
    () => getOnlineStatus(typeof navigator !== "undefined" ? navigator : undefined),
    () => true,
  );
}
