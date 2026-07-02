import React, { useCallback } from 'react';
import { useVisualization } from '../../contexts/VisualizationContext';
import { TimelineVisualization } from './shared/TimelineVisualization';
import type { TimelineEvent, TooltipData } from '../../lib/visualization/types';
import { getFamilyColor } from '../../lib/visualization/d3-helpers';

interface LanguageTimelineViewProps {
  timelineData: TimelineEvent[];
  onEventClick?: (id: string) => void;
}

export function LanguageTimelineView({ timelineData, onEventClick }: LanguageTimelineViewProps) {
  const { isLanguageSelected, isHighlighted } = useVisualization();

  const colorFn = useCallback(
    (event: TimelineEvent) => getFamilyColor(event.familyId, 0.7),
    []
  );

  const isSelectedFn = useCallback(
    (event: TimelineEvent) => isLanguageSelected(event.id),
    [isLanguageSelected]
  );

  const isHighlightedFn = useCallback(
    (event: TimelineEvent) => isHighlighted(event.id),
    [isHighlighted]
  );

  const buildTooltip = useCallback(
    (event: TimelineEvent): TooltipData => ({
      id: event.id,
      name: event.name,
      nativeName: event.nativeName,
      type: event.type,
      familyName: event.familyName,
      region: event.region,
      status: event.status,
      totalSpeakers: event.totalSpeakers,
      timeOrigin: `${event.startYear} ${event.startYear < 0 ? 'BCE' : 'CE'}`,
      timeEnd: event.endYear ? `${event.endYear} ${event.endYear < 0 ? 'BCE' : 'CE'}` : 'Present',
    }),
    []
  );

  return (
    <TimelineVisualization<TimelineEvent>
      data={timelineData}
      onItemClick={onEventClick}
      colorFn={colorFn}
      isSelected={isSelectedFn}
      isHighlighted={isHighlightedFn}
      buildTooltip={buildTooltip}
    />
  );
}
