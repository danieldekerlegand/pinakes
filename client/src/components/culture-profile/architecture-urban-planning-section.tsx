import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Grid3X3,
  Landmark,
  MapPin,
  Layers,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────

export interface ArchitecturalStyle {
  id: string;
  name: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  region: string;
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
  buildingTypes: string[];
}

export interface CityLayout {
  id: string;
  settlementName: string;
  cultureProfileId: string;
  layoutType: string;
  keyFeatures: string[];
  streetPattern: string;
  waterManagement: string;
  fortificationType: string;
  estimatedAreaHectares: number;
  description: string;
  reconstructionNotes: string;
}

interface Props {
  /** Architectural style IDs associated with the culture */
  architecturalStyleIds?: string[];
  /** Culture profile ID to fetch city layouts */
  cultureProfileId?: string;
  /** Civilization name to filter styles */
  civilizationName?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

export function formatPeriod(start: number, end: number): string {
  return `${formatYear(start)} – ${formatYear(end)}`;
}

const LAYOUT_TYPE_COLORS: Record<string, string> = {
  grid: "bg-blue-100 text-blue-800",
  organic: "bg-green-100 text-green-800",
  radial: "bg-purple-100 text-purple-800",
  linear: "bg-amber-100 text-amber-800",
  citadel: "bg-red-100 text-red-800",
  terraced: "bg-emerald-100 text-emerald-800",
  "canal-based": "bg-cyan-100 text-cyan-800",
  fortified: "bg-orange-100 text-orange-800",
};

export function getLayoutTypeColor(layoutType: string): string {
  return LAYOUT_TYPE_COLORS[layoutType.toLowerCase()] || "bg-gray-100 text-gray-800";
}

const FEATURE_ICONS: Record<string, string> = {
  temple_precinct: "🏛️",
  palace: "👑",
  market: "🏪",
  agora: "🗣️",
  forum: "📜",
  granary: "🌾",
  bathhouse: "🛁",
  amphitheater: "🎭",
  walls: "🧱",
  gates: "🚪",
  aqueduct: "💧",
  sewers: "🔧",
  harbor: "⚓",
  necropolis: "⚱️",
  residential_quarter: "🏘️",
  industrial_quarter: "🔨",
  garden: "🌿",
};

export function getFeatureIcon(feature: string): string {
  return FEATURE_ICONS[feature] || "📍";
}

export function getFeatureLabel(feature: string): string {
  return feature
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Data transformation helpers ──────────────────────────────────────

export function filterStylesByCivilization(
  styles: ArchitecturalStyle[],
  civilizationName: string
): ArchitecturalStyle[] {
  const lowerName = civilizationName.toLowerCase();
  return styles.filter(
    (s) =>
      s.associatedCivilizations.toLowerCase().includes(lowerName)
  );
}

export function sortStylesByDate(styles: ArchitecturalStyle[]): ArchitecturalStyle[] {
  return [...styles].sort((a, b) => a.originDate - b.originDate);
}

export function computeTimelineRange(styles: ArchitecturalStyle[]): {
  min: number;
  max: number;
} {
  if (styles.length === 0) return { min: -3500, max: 2100 };
  let min = Infinity;
  let max = -Infinity;
  for (const s of styles) {
    if (s.originDate < min) min = s.originDate;
    if (s.endDate > max) max = s.endDate;
  }
  return { min: min - 200, max: max + 200 };
}

export function yearToPercent(
  year: number,
  range: { min: number; max: number }
): number {
  const span = range.max - range.min;
  if (span === 0) return 50;
  return ((year - range.min) / span) * 100;
}

// ── Sub-components ───────────────────────────────────────────────────

function StyleTimelineMini({ styles }: { styles: ArchitecturalStyle[] }) {
  const sorted = useMemo(() => sortStylesByDate(styles), [styles]);
  const range = useMemo(() => computeTimelineRange(sorted), [sorted]);

  if (sorted.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-2">
        <Clock className="h-3 w-3" />
        <span>Architectural Timeline</span>
      </div>
      <div className="relative">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{formatYear(range.min)}</span>
          <span>{formatYear(range.max)}</span>
        </div>
        <div className="h-1 bg-gray-200 rounded relative">
          {range.min < 0 && range.max > 0 && (
            <div
              className="absolute h-full bg-gray-400"
              style={{ left: `${yearToPercent(0, range)}%`, width: "1px" }}
            />
          )}
        </div>
        <div className="space-y-1 mt-2">
          {sorted.map((style) => {
            const left = yearToPercent(style.originDate, range);
            const width = Math.max(
              yearToPercent(style.endDate, range) - left,
              2
            );
            return (
              <div key={style.id} className="relative h-5 flex items-center">
                <div
                  className="absolute h-3 rounded-sm bg-amber-400/70 hover:bg-amber-500 transition-colors cursor-default"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${style.name}: ${formatPeriod(style.originDate, style.endDate)}`}
                />
                <span
                  className="absolute text-[10px] text-gray-600 whitespace-nowrap pointer-events-none"
                  style={{ left: `${Math.min(left + width + 1, 70)}%` }}
                >
                  {style.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StyleCard({
  style,
  expanded,
  onToggle,
}: {
  style: ArchitecturalStyle;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="p-3 border-l-4 border-l-amber-400">
      <button
        className="w-full text-left flex items-start justify-between"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <Landmark className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-900 truncate">
              {style.name}
            </span>
          </div>
          <div className="flex items-center space-x-2 mt-1">
            <Badge variant="outline" className="text-[10px]">
              {style.stylePeriod}
            </Badge>
            <span className="text-xs text-gray-500">
              {formatPeriod(style.originDate, style.endDate)}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-gray-700">{style.description}</p>

          {/* Region */}
          <div>
            <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
              <MapPin className="h-3 w-3" />
              <span>Region</span>
            </div>
            <p className="text-sm text-gray-700">{style.region}</p>
          </div>

          {/* Key Features */}
          {style.keyFeatures.length > 0 && (
            <div>
              <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
                <Layers className="h-3 w-3" />
                <span>Key Features</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {style.keyFeatures.map((feat) => (
                  <Badge
                    key={feat}
                    variant="secondary"
                    className="text-[10px]"
                  >
                    {feat}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Notable Examples */}
          {style.notableExamples.length > 0 && (
            <div>
              <div className="flex items-center space-x-1 text-xs font-medium text-gray-500 mb-1">
                <Building2 className="h-3 w-3" />
                <span>Notable Structures</span>
              </div>
              <ul className="space-y-1">
                {style.notableExamples.map((ex) => (
                  <li
                    key={ex}
                    className="text-sm text-gray-700 flex items-center space-x-1"
                  >
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full flex-shrink-0" />
                    <span>{ex}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Building Types */}
          {style.buildingTypes.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">
                Building Types
              </div>
              <div className="flex flex-wrap gap-1">
                {style.buildingTypes.map((bt) => (
                  <Badge key={bt} variant="outline" className="text-[10px]">
                    {bt.replace(/-/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CityLayoutCard({
  layout,
  expanded,
  onToggle,
}: {
  layout: CityLayout;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="p-3 border-l-4 border-l-cyan-400">
      <button
        className="w-full text-left flex items-start justify-between"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <Grid3X3 className="h-4 w-4 text-cyan-600 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-900 truncate">
              {layout.settlementName}
            </span>
          </div>
          <div className="flex items-center space-x-2 mt-1">
            <Badge className={`text-[10px] ${getLayoutTypeColor(layout.layoutType)}`}>
              {layout.layoutType}
            </Badge>
            {layout.estimatedAreaHectares > 0 && (
              <span className="text-xs text-gray-500">
                ~{layout.estimatedAreaHectares} ha
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-gray-700">{layout.description}</p>

          {/* City Features Schematic */}
          {layout.keyFeatures.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-2">
                Key Urban Features
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {layout.keyFeatures.map((feat) => (
                  <div
                    key={feat}
                    className="flex items-center space-x-1.5 px-2 py-1 bg-gray-50 rounded text-xs text-gray-700 hover:bg-cyan-50 transition-colors cursor-default"
                    title={getFeatureLabel(feat)}
                  >
                    <span>{getFeatureIcon(feat)}</span>
                    <span>{getFeatureLabel(feat)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Street Pattern & Water */}
          <div className="grid grid-cols-2 gap-3">
            {layout.streetPattern && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  Street Pattern
                </div>
                <p className="text-sm text-gray-700">{layout.streetPattern}</p>
              </div>
            )}
            {layout.waterManagement && layout.waterManagement !== "none" && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  Water Management
                </div>
                <p className="text-sm text-gray-700">{layout.waterManagement}</p>
              </div>
            )}
          </div>

          {/* Fortification */}
          {layout.fortificationType && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">
                Fortifications
              </div>
              <p className="text-sm text-gray-700">{layout.fortificationType}</p>
            </div>
          )}

          {/* Reconstruction Notes */}
          {layout.reconstructionNotes && (
            <div className="bg-amber-50 rounded p-2">
              <div className="text-xs font-medium text-amber-700 mb-1">
                Reconstruction Notes
              </div>
              <p className="text-xs text-amber-800">{layout.reconstructionNotes}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Main Section Component ───────────────────────────────────────────

export default function ArchitectureUrbanPlanningSection({
  architecturalStyleIds,
  cultureProfileId,
  civilizationName,
}: Props) {
  const [expandedStyle, setExpandedStyle] = useState<string | null>(null);
  const [expandedLayout, setExpandedLayout] = useState<string | null>(null);

  // Fetch all architectural styles
  const { data: stylesData } = useQuery<{
    styles: ArchitecturalStyle[];
    count: number;
  }>({
    queryKey: ["/api/architectural-styles"],
  });

  // Fetch city layouts if we have a culture profile ID
  const { data: cityLayoutsData } = useQuery<{
    layouts: CityLayout[];
    count: number;
  }>({
    queryKey: ["/api/city-layouts", cultureProfileId],
    queryFn: async () => {
      const url = cultureProfileId
        ? `/api/city-layouts?culture_profile_id=${cultureProfileId}`
        : "/api/city-layouts";
      const res = await fetch(url);
      if (!res.ok) return { layouts: [], count: 0 };
      return res.json();
    },
    enabled: !!cultureProfileId,
  });

  // Filter styles relevant to this culture
  const relevantStyles = useMemo(() => {
    const allStyles = stylesData?.styles ?? [];
    if (architecturalStyleIds && architecturalStyleIds.length > 0) {
      return allStyles.filter((s) => architecturalStyleIds.includes(s.id));
    }
    if (civilizationName) {
      return filterStylesByCivilization(allStyles, civilizationName);
    }
    return allStyles;
  }, [stylesData, architecturalStyleIds, civilizationName]);

  const cityLayouts = cityLayoutsData?.layouts ?? [];

  const hasContent = relevantStyles.length > 0 || cityLayouts.length > 0;

  if (!hasContent) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        <Building2 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
        <p>No architectural data available for this culture.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center space-x-2">
        <Building2 className="h-5 w-5 text-amber-600" />
        <h3 className="text-base font-semibold text-gray-900">
          Architecture & Urban Planning
        </h3>
      </div>

      {/* Style Timeline */}
      {relevantStyles.length > 0 && (
        <StyleTimelineMini styles={relevantStyles} />
      )}

      {/* Architectural Styles */}
      {relevantStyles.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Architectural Styles ({relevantStyles.length})
          </div>
          <div className="space-y-2">
            {sortStylesByDate(relevantStyles).map((style) => (
              <StyleCard
                key={style.id}
                style={style}
                expanded={expandedStyle === style.id}
                onToggle={() =>
                  setExpandedStyle(
                    expandedStyle === style.id ? null : style.id
                  )
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* City Layouts */}
      {cityLayouts.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            City Layouts ({cityLayouts.length})
          </div>
          <div className="space-y-2">
            {cityLayouts.map((layout) => (
              <CityLayoutCard
                key={layout.id}
                layout={layout}
                expanded={expandedLayout === layout.id}
                onToggle={() =>
                  setExpandedLayout(
                    expandedLayout === layout.id ? null : layout.id
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
