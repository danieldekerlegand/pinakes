import React, { useState, useMemo } from 'react';
import {
  X,
  Check,
  Trash2,
  MapPin,
  Route,
  Tag,
  Hexagon,
  Loader2,
  Wand2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '../../ui/button';
import {
  createInitialExtractionState,
  resultToReviewableFeatures,
} from './extracted-feature-utils';
import type { ReviewableFeature, FeatureExtractionState } from './extracted-feature-utils';

export type { ReviewableFeature, FeatureExtractionState };
export { createInitialExtractionState, resultToReviewableFeatures };

// ============================================================================
// Feature Review Panel
// ============================================================================

interface FeatureReviewPanelProps {
  state: FeatureExtractionState;
  onExtract: () => void;
  onToggleAccepted: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onRemoveFeature: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  settlement: <MapPin className="h-3 w-3" />,
  boundary: <Hexagon className="h-3 w-3" />,
  route: <Route className="h-3 w-3" />,
  label: <Tag className="h-3 w-3" />,
};

const TYPE_COLORS: Record<string, string> = {
  settlement: 'text-red-600',
  boundary: 'text-blue-600',
  route: 'text-amber-600',
  label: 'text-green-600',
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= 0.8
      ? 'bg-green-100 text-green-700'
      : confidence >= 0.5
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-red-100 text-red-700';
  return <span className={`text-[10px] px-1 py-0.5 rounded ${color}`}>{pct}%</span>;
}

function FeatureTypeSection({
  type,
  label,
  features,
  onToggleAccepted,
  onToggleVisible,
  onRemoveFeature,
}: {
  type: string;
  label: string;
  features: ReviewableFeature[];
  onToggleAccepted: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onRemoveFeature: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const acceptedCount = features.filter((f) => f.accepted).length;

  if (features.length === 0) return null;

  return (
    <div className="border-t pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-1"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className={`${TYPE_COLORS[type]}`}>{TYPE_ICONS[type]}</span>
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <span className="text-[10px] text-gray-400 ml-auto">
          {acceptedCount}/{features.length} accepted
        </span>
      </button>

      {expanded && (
        <div className="space-y-0.5 ml-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs ${
                feature.accepted ? 'bg-green-50' : 'bg-gray-50'
              }`}
            >
              <button
                onClick={() => onToggleAccepted(feature.id)}
                className={`flex-shrink-0 h-4 w-4 rounded border flex items-center justify-center ${
                  feature.accepted
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-gray-300'
                }`}
                title={feature.accepted ? 'Reject feature' : 'Accept feature'}
              >
                {feature.accepted && <Check className="h-2.5 w-2.5" />}
              </button>
              <span className="truncate flex-1 text-gray-700">{feature.name}</span>
              <ConfidenceBadge confidence={feature.confidence} />
              <button
                onClick={() => onToggleVisible(feature.id)}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600"
                title={feature.visible ? 'Hide on map' : 'Show on map'}
              >
                {feature.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <button
                onClick={() => onRemoveFeature(feature.id)}
                className="flex-shrink-0 text-gray-400 hover:text-red-500"
                title="Remove feature"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExtractedFeatureReviewPanel({
  state,
  onExtract,
  onToggleAccepted,
  onToggleVisible,
  onRemoveFeature,
  onAcceptAll,
  onRejectAll,
  onConfirm,
  onDismiss,
  disabled,
}: FeatureReviewPanelProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, ReviewableFeature[]> = {
      settlement: [],
      boundary: [],
      route: [],
      label: [],
    };
    for (const f of state.reviewableFeatures) {
      groups[f.type]?.push(f);
    }
    return groups;
  }, [state.reviewableFeatures]);

  const acceptedCount = state.reviewableFeatures.filter((f) => f.accepted).length;
  const totalCount = state.reviewableFeatures.length;

  // No extraction result yet — show the extract button
  if (!state.extractionResult && !state.isExtracting) {
    return (
      <div className="border-t pt-3 mt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onExtract}
          disabled={disabled}
          className="w-full h-8 text-xs bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
        >
          <Wand2 className="h-3.5 w-3.5 mr-1.5" />
          Extract Features with AI
        </Button>
        <p className="text-[10px] text-gray-400 mt-1 text-center">
          Uses Gemini Vision to detect settlements, boundaries, routes, and labels
        </p>
      </div>
    );
  }

  // Extracting
  if (state.isExtracting) {
    return (
      <div className="border-t pt-3 mt-2">
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 text-purple-600 animate-spin" />
          <span className="text-xs text-purple-700 font-medium">Analyzing map image...</span>
        </div>
        <p className="text-[10px] text-gray-400 text-center">
          AI is detecting features in your georeferenced image
        </p>
      </div>
    );
  }

  // Error state
  if (state.error) {
    return (
      <div className="border-t pt-3 mt-2">
        <div className="bg-red-50 border border-red-200 rounded p-2 mb-2">
          <p className="text-xs text-red-700">{state.error}</p>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={onExtract} className="flex-1 h-7 text-xs">
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 text-xs">
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  // Review mode
  return (
    <div className="border-t pt-3 mt-2 space-y-2">
      {/* Header info */}
      <div className="bg-purple-50 border border-purple-200 rounded p-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Wand2 className="h-3.5 w-3.5 text-purple-600" />
          <span className="text-xs font-semibold text-purple-700">AI Extracted Features</span>
        </div>
        {state.mapDescription && (
          <p className="text-[10px] text-purple-600 mb-0.5">{state.mapDescription}</p>
        )}
        <div className="flex gap-2 text-[10px] text-gray-500">
          {state.estimatedTimePeriod && <span>Period: {state.estimatedTimePeriod}</span>}
          {state.estimatedRegion && <span>Region: {state.estimatedRegion}</span>}
        </div>
      </div>

      {/* Bulk actions */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500">
          {acceptedCount}/{totalCount} accepted
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAcceptAll}
            className="h-5 text-[10px] px-1.5 text-green-600"
          >
            Accept All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRejectAll}
            className="h-5 text-[10px] px-1.5 text-red-600"
          >
            Reject All
          </Button>
        </div>
      </div>

      {/* Feature sections */}
      <div className="max-h-[30vh] overflow-y-auto space-y-1">
        <FeatureTypeSection
          type="settlement"
          label="Settlements"
          features={grouped.settlement}
          onToggleAccepted={onToggleAccepted}
          onToggleVisible={onToggleVisible}
          onRemoveFeature={onRemoveFeature}
        />
        <FeatureTypeSection
          type="boundary"
          label="Boundaries"
          features={grouped.boundary}
          onToggleAccepted={onToggleAccepted}
          onToggleVisible={onToggleVisible}
          onRemoveFeature={onRemoveFeature}
        />
        <FeatureTypeSection
          type="route"
          label="Routes"
          features={grouped.route}
          onToggleAccepted={onToggleAccepted}
          onToggleVisible={onToggleVisible}
          onRemoveFeature={onRemoveFeature}
        />
        <FeatureTypeSection
          type="label"
          label="Labels"
          features={grouped.label}
          onToggleAccepted={onToggleAccepted}
          onToggleVisible={onToggleVisible}
          onRemoveFeature={onRemoveFeature}
        />
      </div>

      {/* Confirm / Dismiss */}
      <div className="flex gap-1 pt-1 border-t">
        <Button
          variant="default"
          size="sm"
          onClick={onConfirm}
          disabled={acceptedCount === 0}
          className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700"
        >
          <Check className="h-3 w-3 mr-1" />
          Save {acceptedCount} Features
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 text-xs">
          <X className="h-3 w-3 mr-1" />
          Discard
        </Button>
      </div>
    </div>
  );
}
