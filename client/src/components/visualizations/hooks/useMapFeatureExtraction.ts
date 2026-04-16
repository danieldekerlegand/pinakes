import { useState, useCallback } from 'react';
import type { MapFeatureExtractionResult } from '../../../../../server/services/map-image-analyzer';
import {
  createInitialExtractionState,
  resultToReviewableFeatures,
} from '../map-tools/extracted-feature-utils';
import type { FeatureExtractionState } from '../map-tools/extracted-feature-utils';

export function useMapFeatureExtraction() {
  const [state, setState] = useState<FeatureExtractionState>(createInitialExtractionState());

  const extractFeatures = useCallback(
    async (imageUrl: string, bounds: [[number, number], [number, number]]) => {
      setState((s) => ({ ...s, isExtracting: true, error: null }));

      try {
        // Convert image URL to base64
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        const mimeType = blob.type || 'image/png';

        // Strip the data URL prefix to get raw base64
        const base64Data = base64.replace(/^data:[^;]+;base64,/, '');

        const apiResponse = await fetch('/api/map/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64Data,
            mimeType,
            bounds,
          }),
        });

        if (!apiResponse.ok) {
          const err = await apiResponse.json().catch(() => ({ message: 'Analysis failed' }));
          throw new Error(err.message || `HTTP ${apiResponse.status}`);
        }

        const result: MapFeatureExtractionResult = await apiResponse.json();
        const reviewable = resultToReviewableFeatures(result);

        setState({
          isExtracting: false,
          extractionResult: result,
          reviewableFeatures: reviewable,
          error: null,
          mapDescription: result.mapDescription || '',
          estimatedTimePeriod: result.estimatedTimePeriod || '',
          estimatedRegion: result.estimatedRegion || '',
        });
      } catch (err) {
        setState((s) => ({
          ...s,
          isExtracting: false,
          error: err instanceof Error ? err.message : 'Failed to extract features',
        }));
      }
    },
    []
  );

  const toggleAccepted = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      reviewableFeatures: s.reviewableFeatures.map((f) =>
        f.id === id ? { ...f, accepted: !f.accepted } : f
      ),
    }));
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      reviewableFeatures: s.reviewableFeatures.map((f) =>
        f.id === id ? { ...f, visible: !f.visible } : f
      ),
    }));
  }, []);

  const removeFeature = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      reviewableFeatures: s.reviewableFeatures.filter((f) => f.id !== id),
    }));
  }, []);

  const acceptAll = useCallback(() => {
    setState((s) => ({
      ...s,
      reviewableFeatures: s.reviewableFeatures.map((f) => ({ ...f, accepted: true })),
    }));
  }, []);

  const rejectAll = useCallback(() => {
    setState((s) => ({
      ...s,
      reviewableFeatures: s.reviewableFeatures.map((f) => ({ ...f, accepted: false })),
    }));
  }, []);

  const dismiss = useCallback(() => {
    setState(createInitialExtractionState());
  }, []);

  return {
    state,
    extractFeatures,
    toggleAccepted,
    toggleVisible,
    removeFeature,
    acceptAll,
    rejectAll,
    dismiss,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export type MapFeatureExtractionReturn = ReturnType<typeof useMapFeatureExtraction>;
