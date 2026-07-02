import { useState, useEffect, useCallback } from 'react';

const RM_STORAGE_KEY = 'linguascrape-reduced-motion';

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    try {
      const stored = localStorage.getItem(RM_STORAGE_KEY);
      if (stored !== null) return stored === 'true';
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion);
    try {
      localStorage.setItem(RM_STORAGE_KEY, String(reducedMotion));
    } catch {
      // localStorage unavailable
    }
  }, [reducedMotion]);

  // Listen for OS preference changes when no explicit preference is stored
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(RM_STORAGE_KEY) === null) {
          setReducedMotion(e.matches);
        }
      } catch {
        setReducedMotion(e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion((prev) => !prev);
  }, []);

  return { reducedMotion, toggleReducedMotion };
}
