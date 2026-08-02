import { useState, useCallback } from 'react';
import type { Position } from 'geojson';
import {
  polylineDistance,
  calculateArea,
  generateIsochrones,
  type DistanceUnit,
  type TravelMode,
  type DistanceResult,
  type AreaResult,
  type IsochroneResult,
} from '../../../lib/visualization/measurement-utils';

// ============================================================================
// Types
// ============================================================================

export type MeasurementMode = 'none' | 'distance' | 'area' | 'isochrone';

export interface MeasurementState {
  mode: MeasurementMode;
  points: Position[];
  unit: DistanceUnit;
  travelMode: TravelMode;
  distanceResult: DistanceResult | null;
  areaResult: AreaResult | null;
  isochroneResult: IsochroneResult | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useMeasurementTool() {
  const [state, setState] = useState<MeasurementState>({
    mode: 'none',
    points: [],
    unit: 'km',
    travelMode: 'walking',
    distanceResult: null,
    areaResult: null,
    isochroneResult: null,
  });

  const setMode = useCallback((mode: MeasurementMode) => {
    setState((s) => ({
      ...s,
      mode,
      points: [],
      distanceResult: null,
      areaResult: null,
      isochroneResult: null,
    }));
  }, []);

  const setUnit = useCallback((unit: DistanceUnit) => {
    setState((s) => {
      const next = { ...s, unit };
      // Recalculate distance if we have points
      if (s.mode === 'distance' && s.points.length >= 2) {
        next.distanceResult = polylineDistance(s.points, unit);
      }
      return next;
    });
  }, []);

  const setTravelMode = useCallback((travelMode: TravelMode) => {
    setState((s) => {
      const next = { ...s, travelMode };
      // Recalculate isochrone if we have a center point
      if (s.mode === 'isochrone' && s.points.length === 1) {
        next.isochroneResult = generateIsochrones(s.points[0], travelMode);
      }
      return next;
    });
  }, []);

  const addPoint = useCallback((position: Position) => {
    setState((s) => {
      if (s.mode === 'none') return s;

      // Isochrone only uses one point
      if (s.mode === 'isochrone') {
        const points = [position];
        return {
          ...s,
          points,
          isochroneResult: generateIsochrones(position, s.travelMode),
        };
      }

      const points = [...s.points, position];

      let distanceResult = s.distanceResult;
      let areaResult = s.areaResult;

      if (s.mode === 'distance' && points.length >= 2) {
        distanceResult = polylineDistance(points, s.unit);
      }

      if (s.mode === 'area' && points.length >= 3) {
        areaResult = calculateArea(points);
      }

      return { ...s, points, distanceResult, areaResult };
    });
  }, []);

  const removeLastPoint = useCallback(() => {
    setState((s) => {
      if (s.points.length === 0) return s;

      const points = s.points.slice(0, -1);

      let distanceResult: DistanceResult | null = null;
      let areaResult: AreaResult | null = null;
      let isochroneResult: IsochroneResult | null = null;

      if (s.mode === 'distance' && points.length >= 2) {
        distanceResult = polylineDistance(points, s.unit);
      }
      if (s.mode === 'area' && points.length >= 3) {
        areaResult = calculateArea(points);
      }
      if (s.mode === 'isochrone' && points.length === 1) {
        isochroneResult = generateIsochrones(points[0], s.travelMode);
      }

      return { ...s, points, distanceResult, areaResult, isochroneResult };
    });
  }, []);

  const clear = useCallback(() => {
    setState((s) => ({
      ...s,
      points: [],
      distanceResult: null,
      areaResult: null,
      isochroneResult: null,
    }));
  }, []);

  const close = useCallback(() => {
    setState({
      mode: 'none',
      points: [],
      unit: 'km',
      travelMode: 'walking',
      distanceResult: null,
      areaResult: null,
      isochroneResult: null,
    });
  }, []);

  return {
    state,
    setMode,
    setUnit,
    setTravelMode,
    addPoint,
    removeLastPoint,
    clear,
    close,
  };
}

export type MeasurementToolReturn = ReturnType<typeof useMeasurementTool>;
