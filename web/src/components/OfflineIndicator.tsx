import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Offline banner (US-011). Renders a fixed status pill when connectivity is lost,
 * signalling that the app is serving cached data. Hidden while online.
 */
export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      className="fixed bottom-4 left-1/2 z-[2000] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/40 bg-amber-950/90 px-4 py-2 text-sm font-medium text-amber-100 shadow-lg backdrop-blur"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      <span>Offline — showing cached data</span>
    </div>
  );
}

export default OfflineIndicator;
