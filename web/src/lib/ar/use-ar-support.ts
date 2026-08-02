/**
 * React bindings for the AR historical-layer overlay (US-008).
 *
 * Reads the real `navigator`/`window` (SSR- and test-safe) and runs the pure
 * `detectArSupport` feature detection, plus a one-shot geolocation reader. All
 * decision logic lives in `historical-layers.ts`; this hook only wires the
 * browser globals so the page/tests can stay thin.
 */
import { useEffect, useState, useCallback } from 'react';
import { detectArSupport, type ArSupport, type UserLocation } from './historical-layers';

/** Read the AR-relevant slice of the real environment (undefined during SSR). */
function readEnvironment() {
  if (typeof navigator === 'undefined') return null;
  return {
    xr: (navigator as unknown as { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr ?? null,
    geolocation: navigator.geolocation ?? null,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
  };
}

export function useArSupport(): ArSupport | null {
  const [support, setSupport] = useState<ArSupport | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectArSupport(readEnvironment()).then((s) => {
      if (!cancelled) setSupport(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}

export type GeolocationState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; location: UserLocation }
  | { status: 'error'; message: string };

export function useGeolocation(): { state: GeolocationState; request: () => void } {
  const [state, setState] = useState<GeolocationState>({ status: 'idle' });

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'error', message: 'Geolocation is not available on this device.' });
      return;
    }
    setState({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          status: 'ready',
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }),
      (err) => setState({ status: 'error', message: err.message || 'Could not read your location.' }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  return { state, request };
}
