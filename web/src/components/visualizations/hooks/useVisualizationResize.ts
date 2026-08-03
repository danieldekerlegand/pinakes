import { useState, useEffect, useRef, RefObject } from 'react';

interface Dimensions {
  width: number;
  height: number;
}

/**
 * Hook to track the dimensions of a container element
 * Uses ResizeObserver for efficient updates
 */
export function useVisualizationResize(
  containerRef: RefObject<HTMLElement>,
  debounceMs: number = 150
): Dimensions {
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial dimensions
    const updateDimensions = () => {
      const { width, height } = container.getBoundingClientRect();
      setDimensions({ width, height });
    };

    updateDimensions();

    // Re-measure after layout in case the element wasn't laid out yet on mount
    // Double-rAF ensures at least one full layout pass has occurred
    let rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => {
        updateDimensions();
      });
    });

    // Create ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          setDimensions({ width, height });
        }
      }, debounceMs);
    });

    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [containerRef, debounceMs]);

  return dimensions;
}
