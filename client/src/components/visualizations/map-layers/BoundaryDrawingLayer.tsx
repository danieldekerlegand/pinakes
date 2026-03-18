import React, { useRef, useCallback } from 'react';
import { useMapEvents, Polyline, Polygon, CircleMarker, Tooltip } from 'react-leaflet';
import type { Position } from 'geojson';
import type { DrawingToolReturn } from '../hooks/useDrawingTool';

interface BoundaryDrawingLayerProps {
  drawing: DrawingToolReturn;
}

export function BoundaryDrawingLayer({ drawing }: BoundaryDrawingLayerProps) {
  const { state, addVertex, moveVertex, commitVertexMove, selectVertex } = drawing;
  const draggingRef = useRef<{ index: number; originalVertices: Position[] } | null>(null);

  // Capture map clicks to add vertices
  useMapEvents({
    click(e) {
      if (!state.isDrawing) return;
      // Don't add vertex if we were dragging
      if (draggingRef.current) return;
      addVertex([e.latlng.lng, e.latlng.lat]);
    },
  });

  const handleVertexMouseDown = useCallback(
    (index: number, e: L.LeafletMouseEvent) => {
      e.originalEvent.stopPropagation();
      draggingRef.current = {
        index,
        originalVertices: [...state.vertices],
      };
      selectVertex(index);

      const map = e.target._map;
      if (!map) return;

      map.dragging.disable();

      const onMouseMove = (moveEvent: L.LeafletMouseEvent) => {
        if (!draggingRef.current) return;
        moveVertex(draggingRef.current.index, [moveEvent.latlng.lng, moveEvent.latlng.lat]);
      };

      const onMouseUp = () => {
        if (draggingRef.current) {
          commitVertexMove(draggingRef.current.originalVertices);
          draggingRef.current = null;
        }
        map.dragging.enable();
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
      };

      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);
    },
    [state.vertices, moveVertex, commitVertexMove, selectVertex],
  );

  if (state.vertices.length === 0) return null;

  // Convert [lng, lat] positions to [lat, lng] for Leaflet
  const latLngs = state.vertices.map((v) => [v[1], v[0]] as [number, number]);

  const shapeColor = '#3b82f6';
  const fillColor = '#3b82f680';

  return (
    <>
      {/* Render the shape */}
      {state.mode === 'polygon' && latLngs.length >= 3 ? (
        <Polygon
          positions={latLngs}
          pathOptions={{
            color: shapeColor,
            weight: 2,
            fillColor,
            fillOpacity: 0.25,
            dashArray: state.isDrawing ? '6, 6' : undefined,
          }}
        />
      ) : (
        <Polyline
          positions={latLngs}
          pathOptions={{
            color: shapeColor,
            weight: 2,
            dashArray: state.isDrawing ? '6, 6' : undefined,
          }}
        />
      )}

      {/* Render vertex handles */}
      {latLngs.map((pos, i) => (
        <CircleMarker
          key={i}
          center={pos}
          radius={state.selectedVertexIndex === i ? 7 : 5}
          pathOptions={{
            color: state.selectedVertexIndex === i ? '#ef4444' : '#ffffff',
            fillColor: state.selectedVertexIndex === i ? '#ef4444' : shapeColor,
            fillOpacity: 1,
            weight: 2,
          }}
          eventHandlers={{
            mousedown: (e) => handleVertexMouseDown(i, e),
            click: (e) => {
              e.originalEvent.stopPropagation();
              selectVertex(i);
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
            <span className="text-xs">
              Vertex {i + 1}: [{state.vertices[i][1].toFixed(4)}, {state.vertices[i][0].toFixed(4)}]
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
