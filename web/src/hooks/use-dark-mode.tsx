import { useState, useEffect, useCallback } from 'react';

const DM_STORAGE_KEY = 'pinakes-dark-mode';

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem(DM_STORAGE_KEY);
      if (stored !== null) return stored === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(DM_STORAGE_KEY, String(darkMode));
    } catch {
      // localStorage unavailable
    }
  }, [darkMode]);

  // Listen for OS preference changes when no explicit preference is stored
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(DM_STORAGE_KEY) === null) {
          setDarkMode(e.matches);
        }
      } catch {
        setDarkMode(e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  return { darkMode, toggleDarkMode };
}
