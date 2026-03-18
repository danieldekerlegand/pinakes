import React, { useState, useCallback } from 'react';
import {
  PenTool, Undo2, Redo2, Trash2, Download, Send, X,
  MapPin, Minus, Square, AlertCircle, Loader2,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import type { DrawingToolReturn } from './hooks/useDrawingTool';
import type { DrawingMode } from './hooks/useDrawingTool';

const BOUNDARY_ENTITY_TYPES = [
  { value: 'language-range', label: 'Language Range' },
  { value: 'civilization', label: 'Civilization Boundary' },
  { value: 'boundary', label: 'General Boundary' },
];

interface BoundaryDrawingPanelProps {
  drawing: DrawingToolReturn;
}

export function BoundaryDrawingPanel({ drawing }: BoundaryDrawingPanelProps) {
  const { state, startDrawing, stopDrawing, clearDrawing, removeVertex, undo, redo, canUndo, canRedo, toGeoJSON } = drawing;
  const queryClient = useQueryClient();

  const [entityType, setEntityType] = useState('boundary');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [confidence, setConfidence] = useState(70);
  const [contributorName, setContributorName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [exportedGeoJSON, setExportedGeoJSON] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await fetch('/api/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw json;
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contributions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contributions/stats'] });
      clearDrawing();
      stopDrawing();
      setName('');
      setDescription('');
      setSourceTitle('');
      setSourceUrl('');
      setErrors([]);
    },
    onError: (error: any) => {
      setErrors(error.errors || [error.message || 'Submission failed']);
    },
  });

  const handleExportGeoJSON = useCallback(() => {
    const geojson = toGeoJSON();
    if (!geojson) {
      setErrors(['Not enough vertices to export']);
      return;
    }
    const json = JSON.stringify(geojson, null, 2);
    setExportedGeoJSON(json);
  }, [toGeoJSON]);

  const handleDownloadGeoJSON = useCallback(() => {
    const geojson = toGeoJSON();
    if (!geojson) return;
    const json = JSON.stringify(geojson, null, 2);
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'boundary'}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [toGeoJSON, name]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const geojson = toGeoJSON();
    if (!geojson) {
      setErrors([state.mode === 'polygon' ? 'Need at least 3 vertices for a polygon' : 'Need at least 2 vertices for a polyline']);
      return;
    }

    submitMutation.mutate({
      entityType,
      action: 'add',
      entityData: {
        name,
        description,
        geometry: geojson.geometry,
        drawingMode: state.mode,
      },
      sources: sourceTitle ? [{ title: sourceTitle, url: sourceUrl || undefined }] : [],
      confidence,
      contributorName: contributorName || undefined,
    });
  };

  // Drawing mode selector (not yet drawing)
  if (!state.isDrawing) {
    return (
      <div className="p-4 space-y-4">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <PenTool className="h-5 w-5" />
          Boundary Drawing Tool
        </h3>
        <p className="text-sm text-gray-500">
          Draw polygons or polylines directly on the map to contribute boundary data.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => startDrawing('polygon')}
            variant="outline"
            className="flex flex-col items-center gap-2 h-auto py-4"
          >
            <Square className="h-6 w-6 text-blue-600" />
            <span className="text-sm font-medium">Draw Polygon</span>
            <span className="text-xs text-gray-500">Closed area</span>
          </Button>
          <Button
            onClick={() => startDrawing('polyline')}
            variant="outline"
            className="flex flex-col items-center gap-2 h-auto py-4"
          >
            <Minus className="h-6 w-6 text-blue-600" />
            <span className="text-sm font-medium">Draw Polyline</span>
            <span className="text-xs text-gray-500">Route / border</span>
          </Button>
        </div>

        {state.vertices.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm text-blue-700">
              Previous drawing ({state.vertices.length} vertices) is still available.
              Start drawing to continue or submit below.
            </p>
          </div>
        )}
      </div>
    );
  }

  // Active drawing mode
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <PenTool className="h-5 w-5 text-blue-600" />
          Drawing {state.mode === 'polygon' ? 'Polygon' : 'Polyline'}
        </h3>
        <Button size="sm" variant="ghost" onClick={stopDrawing}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-700">
        <p className="font-medium mb-1">Instructions:</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>Click on the map to add vertices</li>
          <li>Drag vertices to reposition them</li>
          <li>Click a vertex to select, then delete</li>
          <li>Use Undo/Redo to manage changes</li>
        </ul>
      </div>

      {/* Vertex count & controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs">
          <MapPin className="h-3 w-3 mr-1" />
          {state.vertices.length} vertices
        </Badge>
        <div className="flex gap-1 ml-auto">
          <Button size="sm" variant="outline" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (state.selectedVertexIndex !== null) {
                removeVertex(state.selectedVertexIndex);
              }
            }}
            disabled={state.selectedVertexIndex === null}
            title="Delete selected vertex"
            className="text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={clearDrawing} title="Clear all">
            Clear
          </Button>
        </div>
      </div>

      {/* GeoJSON export */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExportGeoJSON} className="flex-1">
            View GeoJSON
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadGeoJSON}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Download
          </Button>
        </div>
        {exportedGeoJSON && (
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1 right-1 h-6 w-6 p-0"
              onClick={() => setExportedGeoJSON(null)}
            >
              <X className="h-3 w-3" />
            </Button>
            <pre className="bg-gray-50 border rounded-md p-2 text-xs overflow-auto max-h-40 font-mono">
              {exportedGeoJSON}
            </pre>
          </div>
        )}
      </div>

      {/* Submit as contribution */}
      <form onSubmit={handleSubmit} className="border-t pt-3 space-y-3">
        <p className="text-sm font-medium text-gray-700">Submit as Contribution</p>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Entity Type</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            {BOUNDARY_ENTITY_TYPES.map((et) => (
              <option key={et.value} value={et.value}>{et.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Name <span className="text-red-500">*</span></label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Bantu language range"
            required
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[50px]"
            placeholder="Brief description of this boundary"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Source <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <Input
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="Source title"
              className="flex-1"
              required
            />
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="URL (optional)"
              className="flex-1"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Confidence: {confidence}%
          </label>
          <input
            type="range"
            min={1}
            max={100}
            value={confidence}
            onChange={(e) => setConfidence(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Your Name (optional)</label>
          <Input
            value={contributorName}
            onChange={(e) => setContributorName(e.target.value)}
            placeholder="Name"
          />
        </div>

        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            {errors.map((err, i) => (
              <p key={i} className="text-sm text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
              </p>
            ))}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitMutation.isPending || state.vertices.length < 2}>
          {submitMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Submit Boundary
        </Button>
      </form>
    </div>
  );
}
