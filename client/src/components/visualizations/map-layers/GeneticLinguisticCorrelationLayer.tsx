import React, { useMemo } from 'react';
import { Circle, Popup, Tooltip } from 'react-leaflet';
import { Badge } from '../../ui/badge';

export interface CorrelationFeature {
  haplogroupId: string;
  haplogroupName: string;
  haplogroupType: string;
  languageFamilyId: string;
  languageFamilyName: string;
  overlapScore: number;
  sharedRegions: string[];
  divergence: string | null;
}

export interface DivergenceAnnotation {
  haplogroupName: string;
  languageFamilyName: string;
  annotation: string;
}

interface GeneticLinguisticCorrelationLayerProps {
  correlations: CorrelationFeature[];
  divergences: DivergenceAnnotation[];
  opacity?: number;
  haplogroupTypeFilter?: 'Y-chromosome' | 'mtDNA' | null;
  onFilterChange?: (filter: 'Y-chromosome' | 'mtDNA' | null) => void;
}

// Geographic region to approximate coordinates (matching HaplogroupLayer)
const REGION_COORDS: Record<string, { lat: number; lng: number }> = {
  'Africa': { lat: 5, lng: 20 },
  'East Africa': { lat: 0, lng: 35 },
  'West Africa': { lat: 10, lng: -5 },
  'North Africa': { lat: 30, lng: 10 },
  'South Africa': { lat: -25, lng: 28 },
  'Central Africa': { lat: 0, lng: 20 },
  'Europe': { lat: 48, lng: 10 },
  'Western Europe': { lat: 46, lng: 2 },
  'Eastern Europe': { lat: 50, lng: 30 },
  'Northern Europe': { lat: 60, lng: 15 },
  'Southern Europe': { lat: 40, lng: 15 },
  'Central Europe': { lat: 48, lng: 15 },
  'Middle East': { lat: 32, lng: 44 },
  'Near East': { lat: 35, lng: 38 },
  'Central Asia': { lat: 42, lng: 65 },
  'South Asia': { lat: 22, lng: 78 },
  'East Asia': { lat: 35, lng: 105 },
  'Southeast Asia': { lat: 10, lng: 110 },
  'Northeast Asia': { lat: 55, lng: 130 },
  'Siberia': { lat: 60, lng: 100 },
  'Oceania': { lat: -10, lng: 150 },
  'Americas': { lat: 10, lng: -80 },
  'North America': { lat: 45, lng: -100 },
  'South America': { lat: -15, lng: -60 },
  'Arctic': { lat: 70, lng: -40 },
};

// Haplogroup region associations (approximate geographic distribution centers)
const HAPLOGROUP_REGIONS: Record<string, string> = {
  'a': 'East Africa',
  'b': 'Central Africa',
  'c': 'East Asia',
  'd': 'East Asia',
  'e': 'Africa',
  'e1b1a': 'West Africa',
  'e1b1b': 'North Africa',
  'g': 'Middle East',
  'h': 'South Asia',
  'i': 'Europe',
  'i1': 'Northern Europe',
  'i2': 'Southern Europe',
  'j': 'Middle East',
  'j1': 'Middle East',
  'j2': 'Middle East',
  'l': 'South Asia',
  'n': 'Northern Europe',
  'o': 'East Asia',
  'q': 'Americas',
  'r': 'Central Asia',
  'r1a': 'Central Asia',
  'r1b': 'Western Europe',
  'r2': 'South Asia',
  't': 'East Africa',
};

function getRegionForHaplogroup(haplogroupId: string): string {
  const normalized = haplogroupId.toLowerCase();
  // Try exact match then prefix match
  if (HAPLOGROUP_REGIONS[normalized]) return HAPLOGROUP_REGIONS[normalized];
  for (const [key, region] of Object.entries(HAPLOGROUP_REGIONS)) {
    if (normalized.startsWith(key)) return region;
  }
  return 'Africa'; // fallback
}

function getCoordinatesForRegion(region: string): { lat: number; lng: number } {
  if (REGION_COORDS[region]) return REGION_COORDS[region];
  for (const [key, coords] of Object.entries(REGION_COORDS)) {
    if (region.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(region.toLowerCase())) {
      return coords;
    }
  }
  return { lat: 20, lng: 0 };
}

// Color based on correlation score (green = high, yellow = medium, red = low/divergence)
function getCorrelationColor(score: number, isDivergence: boolean): string {
  if (isDivergence) return '#ef4444'; // red for divergences
  if (score >= 0.7) return '#22c55e'; // green - strong correlation
  if (score >= 0.4) return '#eab308'; // yellow - moderate
  return '#f97316'; // orange - weak
}

export function GeneticLinguisticCorrelationLayer({
  correlations,
  divergences,
  opacity = 0.7,
  haplogroupTypeFilter,
}: GeneticLinguisticCorrelationLayerProps) {
  if (correlations.length === 0) return null;

  // Filter by haplogroup type
  const filtered = useMemo(() => {
    if (!haplogroupTypeFilter) return correlations;
    return correlations.filter(c => c.haplogroupType === haplogroupTypeFilter);
  }, [correlations, haplogroupTypeFilter]);

  // Group correlations by haplogroup for zone rendering
  const haplogroupZones = useMemo(() => {
    const groups = new Map<string, CorrelationFeature[]>();
    for (const corr of filtered) {
      const existing = groups.get(corr.haplogroupId) || [];
      existing.push(corr);
      groups.set(corr.haplogroupId, existing);
    }
    return groups;
  }, [filtered]);

  // Create divergence lookup
  const divergenceMap = useMemo(() => {
    const map = new Map<string, DivergenceAnnotation>();
    for (const d of divergences) {
      map.set(`${d.haplogroupName}__${d.languageFamilyName}`, d);
    }
    return map;
  }, [divergences]);

  return (
    <>
      {/* Haplogroup distribution zones as shaded circles */}
      {Array.from(haplogroupZones.entries()).map(([haplogroupId, corrs]) => {
        const region = getRegionForHaplogroup(haplogroupId);
        const coords = getCoordinatesForRegion(region);
        const avgScore = corrs.reduce((s, c) => s + c.overlapScore, 0) / corrs.length;
        const hasDivergence = corrs.some(c => c.divergence !== null);
        const color = getCorrelationColor(avgScore, hasDivergence);
        const hapName = corrs[0].haplogroupName;
        const hapType = corrs[0].haplogroupType;

        // Scale radius by number of associated families (100km base, up to 400km)
        const radius = Math.min(100000 + corrs.length * 80000, 400000);

        return (
          <Circle
            key={`zone-${haplogroupId}`}
            center={[coords.lat, coords.lng]}
            radius={radius}
            pathOptions={{
              fillColor: color,
              fillOpacity: opacity * 0.35,
              color: color,
              weight: hasDivergence ? 3 : 2,
              opacity: opacity * 0.8,
              dashArray: hasDivergence ? '8 4' : undefined,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
              <span className="font-medium">{hapName} ({hapType})</span>
              <br />
              <span className="text-xs">
                {corrs.length} language {corrs.length === 1 ? 'family' : 'families'} | Avg score: {(avgScore * 100).toFixed(0)}%
              </span>
              {hasDivergence && (
                <>
                  <br />
                  <span className="text-xs text-red-600">⚠ Notable divergence</span>
                </>
              )}
            </Tooltip>
            <Popup>
              <div className="min-w-[260px] max-w-[320px] p-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-base">{hapName}</h3>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={{
                      borderColor: hapType === 'Y-chromosome' ? '#16a34a' : '#9333ea',
                      color: hapType === 'Y-chromosome' ? '#16a34a' : '#9333ea',
                    }}
                  >
                    {hapType}
                  </Badge>
                </div>

                <div className="text-sm font-medium text-gray-700 mb-1">
                  Language Family Correlations:
                </div>

                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {corrs.sort((a, b) => b.overlapScore - a.overlapScore).map((c) => (
                    <div
                      key={`${c.haplogroupId}-${c.languageFamilyId}`}
                      className="flex items-center justify-between text-xs border-b border-gray-100 pb-1"
                    >
                      <span className="font-medium truncate max-w-[160px]">
                        {c.languageFamilyName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-12 h-2 rounded-full bg-gray-200 overflow-hidden"
                          title={`Overlap: ${(c.overlapScore * 100).toFixed(0)}%`}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${c.overlapScore * 100}%`,
                              backgroundColor: getCorrelationColor(c.overlapScore, c.divergence !== null),
                            }}
                          />
                        </div>
                        <span className="text-gray-500 w-8 text-right">
                          {(c.overlapScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {corrs.some(c => c.divergence) && (
                  <div className="mt-2 p-2 bg-red-50 rounded border border-red-200">
                    <div className="text-xs font-medium text-red-700 mb-1">⚠ Notable Divergences:</div>
                    {corrs
                      .filter(c => c.divergence)
                      .map((c, i) => (
                        <p key={i} className="text-xs text-red-600 mb-1">
                          {c.divergence}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            </Popup>
          </Circle>
        );
      })}

      {/* Standalone divergence markers for pairs without direct data association */}
      {divergences
        .filter(d => !correlations.some(
          c => c.haplogroupName === d.haplogroupName && c.languageFamilyName === d.languageFamilyName && c.divergence
        ))
        .map((d, i) => {
          // Position at a midpoint between related regions
          const coords = getCoordinatesForRegion('Central Europe');
          return (
            <Circle
              key={`div-${i}`}
              center={[coords.lat + i * 2, coords.lng + i * 3]}
              radius={80000}
              pathOptions={{
                fillColor: '#ef4444',
                fillOpacity: opacity * 0.25,
                color: '#ef4444',
                weight: 2,
                dashArray: '6 3',
                opacity: opacity * 0.7,
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                <span className="text-xs text-red-600">⚠ {d.haplogroupName} / {d.languageFamilyName}</span>
              </Tooltip>
              <Popup>
                <div className="min-w-[200px] p-2">
                  <h3 className="font-bold text-sm text-red-700 mb-1">Genetic-Linguistic Divergence</h3>
                  <div className="text-xs text-gray-600 mb-1">
                    <strong>{d.haplogroupName}</strong> × <strong>{d.languageFamilyName}</strong>
                  </div>
                  <p className="text-xs text-red-600">{d.annotation}</p>
                </div>
              </Popup>
            </Circle>
          );
        })}
    </>
  );
}

export default GeneticLinguisticCorrelationLayer;
