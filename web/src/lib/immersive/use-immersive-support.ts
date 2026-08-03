/**
 * React bindings for the immersive scenes (US-009: VR globe & virtual museum).
 *
 * Reads the real `navigator`/`window` (SSR- and test-safe) and runs the pure
 * `detectImmersiveSupport` feature detection. All decision logic lives in
 * `scenes.ts`; this hook only wires the browser globals — including a real
 * WebGL2-context probe — so the page/tests can stay thin.
 */
import { useEffect, useState } from 'react';
import { detectImmersiveSupport, type ImmersiveSupport } from './scenes';

/** Probe whether a WebGL2 context can actually be created (not just typed). */
function probeWebgl2(): boolean {
  if (typeof document === 'undefined') return true; // optimistic during SSR/tests
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

/** Read the immersive-relevant slice of the real environment (undefined during SSR). */
function readEnvironment() {
  if (typeof navigator === 'undefined') return null;
  return {
    xr: (navigator as unknown as { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr ?? null,
    webgl2: probeWebgl2(),
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
  };
}

export function useImmersiveSupport(): ImmersiveSupport | null {
  const [support, setSupport] = useState<ImmersiveSupport | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectImmersiveSupport(readEnvironment()).then((s) => {
      if (!cancelled) setSupport(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}
