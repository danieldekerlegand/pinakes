import { useState, useEffect, useCallback } from 'react';

const HC_STORAGE_KEY = 'pinakes-high-contrast';

export function useHighContrast() {
  const [highContrast, setHighContrast] = useState(() => {
    try {
      return localStorage.getItem(HC_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
    try {
      localStorage.setItem(HC_STORAGE_KEY, String(highContrast));
    } catch {
      // localStorage unavailable
    }
  }, [highContrast]);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => !prev);
  }, []);

  return { highContrast, toggleHighContrast };
}
