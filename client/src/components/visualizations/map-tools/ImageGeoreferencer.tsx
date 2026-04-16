import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useMap, useMapEvents, ImageOverlay, CircleMarker, Tooltip, Polyline } from 'react-leaflet';
import L from 'leaflet';
import {
  Image as ImageIcon,
  Upload,
  X,
  Crosshair,
  RotateCw,
  Minus,
  Plus,
  Trash2,
  Check,
  Move,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import type { ImageGeoreferenceReturn, ControlPoint } from '../hooks/useImageGeoreference';

// ============================================================================
// Image Overlay Layer (rendered inside MapContainer)
// ============================================================================

interface ImageGeoreferenceLayerProps {
  georef: ImageGeoreferenceReturn;
}

export function ImageGeoreferenceLayer({ georef }: ImageGeoreferenceLayerProps) {
  const { state, confirmControlPointPlacement, updateControlPointMapPos } = georef;
  const map = useMap();
  const draggingRef = useRef<{ id: string } | null>(null);

  // Handle map clicks for placing control points
  useMapEvents({
    click(e) {
      if (state.isPlacingControlPoint && state.pendingImagePos) {
        confirmControlPointPlacement([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  const handleControlPointDragStart = useCallback(
    (id: string, e: L.LeafletMouseEvent) => {
      e.originalEvent.stopPropagation();
      draggingRef.current = { id };
      map.dragging.disable();

      const onMove = (moveEvent: L.LeafletMouseEvent) => {
        if (!draggingRef.current) return;
        updateControlPointMapPos(draggingRef.current.id, [
          moveEvent.latlng.lat,
          moveEvent.latlng.lng,
        ]);
      };

      const onUp = () => {
        draggingRef.current = null;
        map.dragging.enable();
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
      };

      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
    },
    [map, updateControlPointMapPos]
  );

  if (!state.isActive || !state.imageUrl || !state.bounds) return null;

  const displayBounds = georef.georeferencedBounds || state.bounds;
  const leafletBounds = L.latLngBounds(
    L.latLng(displayBounds[0][0], displayBounds[0][1]),
    L.latLng(displayBounds[1][0], displayBounds[1][1])
  );

  return (
    <>
      <ImageOverlay
        url={state.imageUrl}
        bounds={leafletBounds}
        opacity={state.opacity}
        className={state.rotation !== 0 ? `georef-rotated-${Math.round(state.rotation)}` : undefined}
      />

      {/* Control Point Markers */}
      {state.controlPoints.map((cp, i) => (
        <CircleMarker
          key={cp.id}
          center={[cp.mapPos[0], cp.mapPos[1]]}
          radius={8}
          pathOptions={{
            color: '#ef4444',
            fillColor: '#fbbf24',
            fillOpacity: 1,
            weight: 2,
          }}
          eventHandlers={{
            mousedown: (e) => handleControlPointDragStart(cp.id, e),
          }}
        >
          <Tooltip permanent direction="right" offset={[12, 0]}>
            <span className="text-xs font-bold">CP {i + 1}</span>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Lines connecting control points to show the mapping */}
      {state.controlPoints.length >= 2 && (
        <Polyline
          positions={state.controlPoints.map(cp => [cp.mapPos[0], cp.mapPos[1]] as [number, number])}
          pathOptions={{
            color: '#ef4444',
            weight: 1,
            dashArray: '5,5',
            opacity: 0.5,
          }}
        />
      )}

      {/* Placement mode cursor indicator */}
      {state.isPlacingControlPoint && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
            cursor: 'crosshair',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}

// ============================================================================
// Control Panel (rendered outside MapContainer)
// ============================================================================

interface ImageGeoreferencePanelProps {
  georef: ImageGeoreferenceReturn;
  mapCenter: [number, number];
  mapZoom: number;
}

export function ImageGeoreferencePanel({ georef, mapCenter, mapZoom }: ImageGeoreferencePanelProps) {
  const { state, fileInputRef } = georef;
  const [isMinimized, setIsMinimized] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      georef.loadImage(file, mapCenter, mapZoom);
    },
    [georef, mapCenter, mapZoom]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  // Predefined image positions for control points (grid pattern)
  const imagePositionPresets: { label: string; pos: [number, number] }[] = [
    { label: 'Top-Left', pos: [0.1, 0.1] },
    { label: 'Top-Right', pos: [0.9, 0.1] },
    { label: 'Bottom-Left', pos: [0.1, 0.9] },
    { label: 'Bottom-Right', pos: [0.9, 0.9] },
    { label: 'Center', pos: [0.5, 0.5] },
    { label: 'Top-Center', pos: [0.5, 0.1] },
    { label: 'Bottom-Center', pos: [0.5, 0.9] },
    { label: 'Left-Center', pos: [0.1, 0.5] },
    { label: 'Right-Center', pos: [0.9, 0.5] },
  ];

  if (!state.isActive) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={georef.activate}
        className="absolute top-4 left-14 z-[1000] bg-white shadow-lg"
        title="Import & Georeference Image"
      >
        <ImageIcon className="h-4 w-4 mr-1" />
        Import Map Image
      </Button>
    );
  }

  if (isMinimized) {
    return (
      <Card className="absolute top-4 left-14 z-[1000] p-2 bg-white shadow-lg">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-blue-600" />
          <span className="text-xs font-medium">Georeferencer</span>
          <Button variant="ghost" size="sm" onClick={() => setIsMinimized(false)} className="h-6 w-6 p-0">
            <Plus className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={georef.deactivate} className="h-6 w-6 p-0">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="absolute top-4 left-14 z-[1000] w-72 bg-white shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold">Image Georeferencer</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setIsMinimized(true)} className="h-6 w-6 p-0">
            <Minus className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={georef.deactivate} className="h-6 w-6 p-0">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
        {/* Image Import */}
        {!state.imageUrl ? (
          <div
            ref={dropZoneRef}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm text-gray-600">Drop a map image here</p>
            <p className="text-xs text-gray-400 mt-1">or click to browse</p>
            <input
              ref={fileInputRef as React.RefObject<HTMLInputElement>}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleInputChange}
            />
          </div>
        ) : (
          <>
            {/* Image Controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">Opacity</span>
                <span className="text-xs text-gray-500">{Math.round(state.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(state.opacity * 100)}
                onChange={e => georef.setOpacity(Number(e.target.value) / 100)}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">Rotation</span>
                <span className="text-xs text-gray-500">{state.rotation}°</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={state.rotation}
                  onChange={e => georef.setRotation(Number(e.target.value))}
                  className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => georef.setRotation(0)}
                  className="h-6 w-6 p-0"
                  title="Reset rotation"
                >
                  <RotateCw className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Scale Controls */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-gray-700">Scale</span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!state.bounds) return;
                    const [[s, w], [n, e]] = state.bounds;
                    const cLat = (s + n) / 2, cLng = (w + e) / 2;
                    const hLat = (n - s) / 2 * 0.8, hLng = (e - w) / 2 * 0.8;
                    georef.setBounds([[cLat - hLat, cLng - hLng], [cLat + hLat, cLng + hLng]]);
                  }}
                  className="flex-1 h-7 text-xs"
                >
                  <Minus className="h-3 w-3 mr-1" /> Shrink
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!state.bounds) return;
                    const [[s, w], [n, e]] = state.bounds;
                    const cLat = (s + n) / 2, cLng = (w + e) / 2;
                    const hLat = (n - s) / 2 * 1.25, hLng = (e - w) / 2 * 1.25;
                    georef.setBounds([[cLat - hLat, cLng - hLng], [cLat + hLat, cLng + hLng]]);
                  }}
                  className="flex-1 h-7 text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" /> Grow
                </Button>
              </div>
            </div>

            {/* Georeferencing Controls */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-700">
                  Control Points ({state.controlPoints.length}/3 min)
                </span>
                {state.controlPoints.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={georef.clearControlPoints}
                    className="h-5 text-xs text-red-500 hover:text-red-700 p-0"
                  >
                    Clear All
                  </Button>
                )}
              </div>

              {state.controlPoints.length < 3 && (
                <p className="text-xs text-gray-500 mb-2">
                  Place at least 3 control points to georeference the image.
                  Select an image position, then click the corresponding map location.
                </p>
              )}
              {state.controlPoints.length === 3 && georef.affineTransform && !georef.rubberSheetTransform && (
                <p className="text-xs text-gray-500 mb-2">
                  Add a 4th point for rubber-sheet transformation (handles non-linear distortion).
                </p>
              )}

              {/* Placement status */}
              {state.isPlacingControlPoint && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Crosshair className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
                    <span className="text-xs text-blue-700 font-medium">
                      Click on the map to place point
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={georef.cancelPlacingControlPoint}
                    className="h-5 w-5 p-0 text-blue-500"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Image position presets for adding control points */}
              {!state.isPlacingControlPoint && (
                <div className="grid grid-cols-3 gap-1 mb-2">
                  {imagePositionPresets.slice(0, 9).map(preset => {
                    const alreadyUsed = state.controlPoints.some(
                      cp =>
                        Math.abs(cp.imagePos[0] - preset.pos[0]) < 0.05 &&
                        Math.abs(cp.imagePos[1] - preset.pos[1]) < 0.05
                    );
                    return (
                      <Button
                        key={preset.label}
                        variant="outline"
                        size="sm"
                        disabled={alreadyUsed}
                        onClick={() => georef.startPlacingControlPoint(preset.pos)}
                        className={`h-7 text-[10px] px-1 ${alreadyUsed ? 'opacity-40' : ''}`}
                        title={`Place control point at ${preset.label} of image`}
                      >
                        {preset.label.replace('-', '\n')}
                      </Button>
                    );
                  })}
                </div>
              )}

              {/* Control point list */}
              {state.controlPoints.length > 0 && (
                <div className="space-y-1">
                  {state.controlPoints.map((cp, i) => (
                    <div
                      key={cp.id}
                      className="flex items-center justify-between bg-gray-50 rounded px-2 py-1"
                    >
                      <div className="text-xs">
                        <span className="font-medium text-amber-600">CP {i + 1}</span>
                        <span className="text-gray-500 ml-1">
                          img({cp.imagePos[0].toFixed(1)},{cp.imagePos[1].toFixed(1)})
                          → ({cp.mapPos[0].toFixed(2)},{cp.mapPos[1].toFixed(2)})
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => georef.removeControlPoint(cp.id)}
                        className="h-5 w-5 p-0 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Status indicators */}
              {state.controlPoints.length >= 3 && georef.affineTransform && (
                <div className="mt-2 bg-green-50 border border-green-200 rounded p-2 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  <span className="text-xs text-green-700 font-medium">
                    {georef.rubberSheetTransform
                      ? `Rubber-sheet transform (${state.controlPoints.length} points)`
                      : `Affine transform (${state.controlPoints.length} points)`}
                  </span>
                </div>
              )}

              {state.controlPoints.length >= 3 && !georef.affineTransform && (
                <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-2">
                  <span className="text-xs text-yellow-700">
                    Points are collinear. Add non-collinear points for georeferencing.
                  </span>
                </div>
              )}
            </div>

            {/* Remove Image */}
            <div className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={georef.removeImage}
                className="w-full h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Remove Image
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
