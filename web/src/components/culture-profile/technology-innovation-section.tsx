import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  ChevronRight,
  ChevronDown,
  MapPin,
  Clock,
  ArrowRight,
  BookOpen,
  Link2,
} from "lucide-react";
import {
  type Innovation,
  INNOVATION_CATEGORY_COLORS,
  filterInnovationsByCulture,
  formatCategoryLabel,
  formatInnovationYear,
  getUniqueInnovationCategories,
  sortInnovationsByYear,
} from "./technology-innovation-utils";

interface Props {
  cultureProfileId?: string;
  cultureName?: string;
}

function InnovationCard({
  innovation,
  expanded,
  onToggle,
  innovationNames,
  cultureNames,
}: {
  innovation: Innovation;
  expanded: boolean;
  onToggle: () => void;
  innovationNames: Record<string, string>;
  cultureNames: Record<string, string>;
}) {
  const categoryColor =
    INNOVATION_CATEGORY_COLORS[innovation.category.toLowerCase()] ||
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";

  return (
    <div
      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
      data-testid={`innovation-${innovation.id}`}
    >
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        onClick={onToggle}
      >
        <Lightbulb className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {innovation.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge className={`text-[10px] px-1.5 py-0 ${categoryColor}`}>
              {formatCategoryLabel(innovation.category)}
            </Badge>
            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatInnovationYear(innovation.yearInvented)}
            </span>
            {innovation.regionOfOrigin && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5" />
                {innovation.regionOfOrigin}
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
        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-800 pt-2 space-y-2">
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {innovation.description}
          </p>

          {innovation.diffusionPath.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                Diffusion Path
              </p>
              <div className="flex flex-wrap items-center gap-1" data-testid={`diffusion-${innovation.id}`}>
                {innovation.diffusionPath.map((cultureId, idx) => (
                  <div key={cultureId} className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {cultureNames[cultureId] || cultureId}
                    </Badge>
                    {idx < innovation.diffusionPath.length - 1 && (
                      <ArrowRight className="h-2.5 w-2.5 text-gray-400" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {innovation.relatedInnovations.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Related Innovations
              </p>
              <div className="flex flex-wrap gap-1">
                {innovation.relatedInnovations.map((relatedId) => (
                  <Badge key={relatedId} variant="outline" className="text-[10px]">
                    {innovationNames[relatedId] || relatedId}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {innovation.sources.length > 0 && (
            <div className="flex items-start gap-1 text-[10px] text-gray-400 dark:text-gray-500">
              <BookOpen className="h-2.5 w-2.5 mt-0.5" />
              <span>{innovation.sources.join("; ")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InnovationMiniTimeline({ innovations }: { innovations: Innovation[] }) {
  const withYears = innovations.filter((i) => i.yearInvented !== null);
  if (withYears.length === 0) return null;

  const years = withYears.map((i) => i.yearInvented as number);
  const minYear = Math.min(...years, -5000);
  const maxYear = Math.max(...years, 2000);
  const range = maxYear - minYear || 1;

  return (
    <div data-testid="innovation-timeline">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Timeline</p>
      <div className="relative h-8 bg-gray-100 dark:bg-gray-800 rounded">
        {withYears.map((innovation) => {
          const year = innovation.yearInvented as number;
          const left = ((year - minYear) / range) * 100;
          return (
            <div
              key={innovation.id}
              className="absolute top-1 bottom-1 w-1.5 bg-amber-500 rounded-sm hover:bg-amber-600 transition-colors"
              style={{ left: `${left}%` }}
              title={`${innovation.name} (${formatInnovationYear(year)})`}
              data-testid={`timeline-marker-${innovation.id}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{formatInnovationYear(minYear)}</span>
        <span>{formatInnovationYear(maxYear)}</span>
      </div>
    </div>
  );
}

export default function TechnologyInnovationSection({ cultureProfileId, cultureName }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ innovations: Innovation[]; count: number }>({
    queryKey: ["/api/innovations"],
  });

  const allInnovations = data?.innovations ?? [];

  const relevantInnovations = useMemo(
    () => filterInnovationsByCulture(allInnovations, cultureProfileId),
    [allInnovations, cultureProfileId],
  );

  const filteredInnovations = useMemo(() => {
    if (categoryFilter === "all") return relevantInnovations;
    return relevantInnovations.filter((i) => i.category === categoryFilter);
  }, [relevantInnovations, categoryFilter]);

  const sortedInnovations = useMemo(
    () => sortInnovationsByYear(filteredInnovations),
    [filteredInnovations],
  );

  const categories = useMemo(
    () => getUniqueInnovationCategories(relevantInnovations),
    [relevantInnovations],
  );

  const innovationNames = useMemo(() => {
    const map: Record<string, string> = {};
    allInnovations.forEach((i) => {
      map[i.id] = i.name;
    });
    return map;
  }, [allInnovations]);

  const cultureNames = useMemo(() => {
    const map: Record<string, string> = {};
    allInnovations.forEach((i) => {
      i.cultureProfileIds.forEach((id) => {
        if (!map[id]) map[id] = id.replace(/^cp-/, "").replace(/-/g, " ");
      });
      i.diffusionPath.forEach((id) => {
        if (!map[id]) map[id] = id.replace(/^cp-/, "").replace(/-/g, " ");
      });
    });
    return map;
  }, [allInnovations]);

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse" data-testid="technology-innovation-loading">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="technology-innovation-section">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Innovations</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {relevantInnovations.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
          <BookOpen className="h-4 w-4 text-indigo-500" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Categories</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {categories.length}
            </p>
          </div>
        </div>
      </div>

      {relevantInnovations.length === 0 ? (
        <div
          className="text-center py-6 text-gray-400 dark:text-gray-500"
          data-testid="technology-innovation-empty"
        >
          <Lightbulb className="h-8 w-8 mx-auto mb-2" />
          <p className="text-sm">
            No innovation data available{cultureName ? ` for ${cultureName}` : ""}
          </p>
        </div>
      ) : (
        <>
          <InnovationMiniTimeline innovations={relevantInnovations} />

          {categories.length > 1 && (
            <select
              className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              data-testid="innovation-category-filter"
            >
              <option value="all">All Categories ({relevantInnovations.length})</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {formatCategoryLabel(cat)} (
                  {relevantInnovations.filter((i) => i.category === cat).length})
                </option>
              ))}
            </select>
          )}

          <div className="space-y-2">
            {sortedInnovations.map((innovation) => (
              <InnovationCard
                key={innovation.id}
                innovation={innovation}
                expanded={expandedItem === innovation.id}
                onToggle={() =>
                  setExpandedItem(expandedItem === innovation.id ? null : innovation.id)
                }
                innovationNames={innovationNames}
                cultureNames={cultureNames}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
