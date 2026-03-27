import React, { useMemo } from 'react';
import type { ElevationProfile } from '../../../lib/visualization/terrain-route-utils';

interface RouteElevationProfileProps {
  profile: ElevationProfile;
  width?: number;
  height?: number;
  color?: string;
}

/**
 * Inline SVG elevation profile chart shown in route popups.
 * Renders a filled area chart of elevation along a route.
 */
export function RouteElevationProfile({
  profile,
  width = 200,
  height = 60,
  color = '#3b82f6',
}: RouteElevationProfileProps) {
  const { pathD, areaD } = useMemo(() => {
    const { points, minElevation, maxElevation, totalDistance } = profile;
    if (points.length < 2 || totalDistance === 0) {
      return { pathD: '', areaD: '' };
    }

    const padding = 2;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;
    const elevRange = maxElevation - minElevation || 1;

    const toX = (dist: number) => padding + (dist / totalDistance) * chartW;
    const toY = (elev: number) => padding + chartH - ((elev - minElevation) / elevRange) * chartH;

    const linePoints = points.map(p => `${toX(p.distance)},${toY(p.elevation)}`);
    const pathD = `M${linePoints.join(' L')}`;
    const areaD = `${pathD} L${toX(totalDistance)},${padding + chartH} L${padding},${padding + chartH} Z`;

    return { pathD, areaD };
  }, [profile, width, height]);

  if (profile.points.length < 2) {
    return null;
  }

  return (
    <div className="elevation-profile">
      <svg width={width} height={height} className="block">
        <defs>
          <linearGradient id="elev-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        {areaD && (
          <path d={areaD} fill="url(#elev-gradient)" />
        )}
        {pathD && (
          <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 mt-0.5">
        <span>{Math.round(profile.minElevation)}m</span>
        <span>{Math.round(profile.totalDistance)} km</span>
        <span>{Math.round(profile.maxElevation)}m</span>
      </div>
    </div>
  );
}
