import { useState, useCallback, useRef } from 'react';
import type { Feature, Polygon, LineString, Position } from 'geojson';

// ============================================================================
// Types
// ============================================================================

export type DrawingMode = 'polygon' | 'polyline';

export interface DrawingState {
  isDrawing: boolean;
  mode: DrawingMode;
  vertices: Position[];
  selectedVertexIndex: number | null;
}

export interface DrawingHistory {
  past: Position[][];
  future: Position[][];
}

// ============================================================================
// Hook
// ============================================================================

export function useDrawingTool() {
  const [state, setState] = useState<DrawingState>({
    isDrawing: false,
    mode: 'polygon',
    vertices: [],
    selectedVertexIndex: null,
  });

  const historyRef = useRef<DrawingHistory>({ past: [], future: [] });

  const pushHistory = useCallback((vertices: Position[]) => {
    historyRef.current.past.push([...vertices]);
    historyRef.current.future = [];
  }, []);

  const startDrawing = useCallback((mode: DrawingMode) => {
    historyRef.current = { past: [], future: [] };
    setState({ isDrawing: true, mode, vertices: [], selectedVertexIndex: null });
  }, []);

  const stopDrawing = useCallback(() => {
    setState((s) => ({ ...s, isDrawing: false, selectedVertexIndex: null }));
  }, []);

  const clearDrawing = useCallback(() => {
    if (state.vertices.length > 0) {
      pushHistory(state.vertices);
    }
    setState((s) => ({ ...s, vertices: [], selectedVertexIndex: null }));
  }, [state.vertices, pushHistory]);

  const addVertex = useCallback((position: Position) => {
    setState((s) => {
      if (!s.isDrawing) return s;
      pushHistory(s.vertices);
      return { ...s, vertices: [...s.vertices, position], selectedVertexIndex: null };
    });
  }, [pushHistory]);

  const moveVertex = useCallback((index: number, position: Position) => {
    setState((s) => {
      if (index < 0 || index >= s.vertices.length) return s;
      const newVertices = [...s.vertices];
      newVertices[index] = position;
      return { ...s, vertices: newVertices };
    });
  }, []);

  const commitVertexMove = useCallback((originalVertices: Position[]) => {
    pushHistory(originalVertices);
  }, [pushHistory]);

  const removeVertex = useCallback((index: number) => {
    setState((s) => {
      if (index < 0 || index >= s.vertices.length) return s;
      pushHistory(s.vertices);
      const newVertices = s.vertices.filter((_, i) => i !== index);
      return { ...s, vertices: newVertices, selectedVertexIndex: null };
    });
  }, [pushHistory]);

  const selectVertex = useCallback((index: number | null) => {
    setState((s) => ({ ...s, selectedVertexIndex: index }));
  }, []);

  const undo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (past.length === 0) return;
    const previous = past.pop()!;
    setState((s) => {
      future.push([...s.vertices]);
      return { ...s, vertices: previous, selectedVertexIndex: null };
    });
  }, []);

  const redo = useCallback(() => {
    const { past, future } = historyRef.current;
    if (future.length === 0) return;
    const next = future.pop()!;
    setState((s) => {
      past.push([...s.vertices]);
      return { ...s, vertices: next, selectedVertexIndex: null };
    });
  }, []);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  const toGeoJSON = useCallback((): Feature<Polygon | LineString> | null => {
    if (state.vertices.length < 2) return null;

    if (state.mode === 'polyline') {
      return {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: state.vertices,
        },
      };
    }

    // Polygon needs at least 3 vertices
    if (state.vertices.length < 3) return null;

    // Close the ring for polygon
    const ring = [...state.vertices, state.vertices[0]];
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    };
  }, [state.vertices, state.mode]);

  return {
    state,
    startDrawing,
    stopDrawing,
    clearDrawing,
    addVertex,
    moveVertex,
    commitVertexMove,
    removeVertex,
    selectVertex,
    undo,
    redo,
    canUndo,
    canRedo,
    toGeoJSON,
  };
}

export type DrawingToolReturn = ReturnType<typeof useDrawingTool>;
