import React, { useCallback, useRef, useEffect } from 'react';
import { formatYear } from '../hooks/useSplitScreen';

interface SwipeDividerProps {
  position: number; // 0-100 percentage
  leftYear: number;
  rightYear: number;
  onPositionChange: (position: number) => void;
}

export function SwipeDivider({ position, leftYear, rightYear, onPositionChange }: SwipeDividerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const parent = containerRef.current.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(10, Math.min(90, (x / rect.width) * 100));
      onPositionChange(pct);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onPositionChange]);

  // Touch support
  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const parent = containerRef.current.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const pct = Math.max(10, Math.min(90, (x / rect.width) * 100));
      onPositionChange(pct);
    };

    const handleTouchEnd = () => {
      isDragging.current = false;
    };

    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onPositionChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    isDragging.current = true;
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 z-[900] pointer-events-none">
      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-auto cursor-col-resize"
        style={{ left: `${position}%`, transform: 'translateX(-50%)', width: '20px' }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Visible line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)] -translate-x-1/2" />

        {/* Drag handle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-12 bg-white rounded-full shadow-lg border border-gray-300 flex items-center justify-center">
          <div className="flex gap-0.5">
            <div className="w-0.5 h-4 bg-gray-400 rounded-full" />
            <div className="w-0.5 h-4 bg-gray-400 rounded-full" />
          </div>
        </div>
      </div>

      {/* Left year label */}
      <div
        className="absolute top-3 pointer-events-none"
        style={{ left: `${Math.max(2, position / 2)}%` }}
      >
        <div className="bg-blue-600 text-white text-xs font-medium px-2 py-1 rounded shadow-md">
          {formatYear(leftYear)}
        </div>
      </div>

      {/* Right year label */}
      <div
        className="absolute top-3 pointer-events-none"
        style={{ left: `${position + (100 - position) / 2}%`, transform: 'translateX(-50%)' }}
      >
        <div className="bg-orange-500 text-white text-xs font-medium px-2 py-1 rounded shadow-md">
          {formatYear(rightYear)}
        </div>
      </div>
    </div>
  );
}
