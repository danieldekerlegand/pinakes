import { useState, type ReactNode, type DragEvent } from "react";
import { ChevronDown, ChevronRight, Clock, Tag, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type CultureDataCardVariant,
  type CultureDataCardImage,
  type RelatedEntity,
  formatTimePeriod,
  getVariantClasses,
  normalizeTags,
} from "./culture-data-card-utils";

export interface CultureDataCardProps {
  id: string;
  title: string;
  icon?: ReactNode;
  category?: string;
  timePeriodStart?: number | string | null;
  timePeriodEnd?: number | string | null;
  description?: string;
  image?: CultureDataCardImage;
  tags?: string[];
  relatedEntities?: RelatedEntity[];
  detailContent?: ReactNode;
  variant?: CultureDataCardVariant;
  defaultExpanded?: boolean;
  accentColor?: string;
  onSelect?: () => void;
  draggable?: boolean;
  onDragStart?: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (id: string, event: DragEvent<HTMLDivElement>) => void;
  className?: string;
}

export function CultureDataCard({
  id,
  title,
  icon,
  category,
  timePeriodStart,
  timePeriodEnd,
  description,
  image,
  tags,
  relatedEntities,
  detailContent,
  variant = "standard",
  defaultExpanded = false,
  accentColor,
  onSelect,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  className,
}: CultureDataCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const classes = getVariantClasses(variant);
  const period = formatTimePeriod(timePeriodStart, timePeriodEnd);
  const visibleTags = normalizeTags(tags);
  const hasDetail = Boolean(detailContent);
  const isCompact = variant === "compact";

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (!draggable) return;
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart?.(id, e);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!draggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragOver?.(id, e);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!draggable) return;
    e.preventDefault();
    onDrop?.(id, e);
  };

  const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
    if (!draggable) return;
    onDragEnd?.(id, e);
  };

  return (
    <div
      className={cn(classes.root, onSelect && "cursor-pointer hover:shadow-md transition-shadow", className)}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 3 } : undefined}
      data-testid={`culture-data-card-${id}`}
      data-variant={variant}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
    >
      {draggable && (
        <span
          className="text-gray-400 dark:text-gray-500 flex-shrink-0"
          aria-label="drag handle"
          data-testid={`culture-data-card-drag-${id}`}
        >
          <GripVertical className="h-4 w-4" />
        </span>
      )}

      {image && (
        <img src={image.url} alt={image.alt ?? title} className={classes.image} loading="lazy" />
      )}

      {icon && (
        <span className="text-gray-500 dark:text-gray-400 flex-shrink-0" aria-hidden>
          {icon}
        </span>
      )}

      <div className={classes.body}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={classes.title}>{title}</p>
            {category && (
              <Badge variant="outline" className="mt-0.5 text-[10px] px-1.5 py-0">
                {category}
              </Badge>
            )}
          </div>
          {hasDetail && !isCompact && (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse detail" : "Expand detail"}
              data-testid={`culture-data-card-toggle-${id}`}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>

        {period && !isCompact && (
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{period}</span>
          </div>
        )}

        {description && !isCompact && (
          <p className={classes.description}>{description}</p>
        )}

        {isCompact && (description || period) && (
          <p className={classes.description}>
            {[period, description].filter(Boolean).join(" · ")}
          </p>
        )}

        {visibleTags.length > 0 && !isCompact && (
          <div className="flex flex-wrap gap-1 pt-1">
            {visibleTags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                <Tag className="h-2.5 w-2.5 mr-0.5" />
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {expanded && hasDetail && (
          <div
            className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2"
            data-testid={`culture-data-card-detail-${id}`}
          >
            {detailContent}
            {relatedEntities && relatedEntities.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Related</p>
                <div className="flex flex-wrap gap-1">
                  {relatedEntities.map((rel) => (
                    <Badge key={rel.id} variant="outline" className="text-[10px] px-1.5 py-0">
                      {rel.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CultureDataCard;
