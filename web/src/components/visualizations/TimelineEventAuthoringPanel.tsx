import React, { useCallback, useMemo, useRef, useState } from 'react';
import { CalendarClock, Send, X, AlertCircle, Loader2, MousePointerClick } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  formatYear,
  yearToX,
  xToYear,
  getAxisTicks,
  LANE_ORDER,
} from '@/components/culture-profile/culture-evolution-timeline-utils';

// Vocabulary mirrors the server's timeline-event service
// (services/api/src/pinakes/authoring/timeline_event.py). Kept small & local — the server is the
// source of truth and re-validates every submission.
const ENTRY_KINDS = [
  { value: 'event', label: 'Event (single year)' },
  { value: 'period', label: 'Period (date range)' },
] as const;
type EntryKind = (typeof ENTRY_KINDS)[number]['value'];

const MAGNITUDES = ['major', 'moderate', 'minor'] as const;

interface TimelineEventAuthoringPanelProps {
  /** Existing entity the authored entries attach to. */
  cultureProfileId: string;
  cultureName?: string;
  /** Active-period bounds used to seed the clickable axis. */
  axisStart: number;
  axisEnd: number;
  onClose?: () => void;
  /** Called after a successful submit (e.g. to refetch the timeline). */
  onSubmitted?: () => void;
}

const AXIS_PAD = 12;
const AXIS_WIDTH = 320;
const AXIS_HEIGHT = 64;

/**
 * In-app timeline authoring UI (US-002). A contributor clicks the temporal axis
 * to pick a start (and, for a period, an end) year, fills in the event details,
 * and submits — the entry lands in the contribution review queue with
 * provenance `source='user-authored'` (never a direct TSV write).
 */
export function TimelineEventAuthoringPanel({
  cultureProfileId,
  cultureName,
  axisStart,
  axisEnd,
  onClose,
  onSubmitted,
}: TimelineEventAuthoringPanelProps) {
  const queryClient = useQueryClient();
  const svgRef = useRef<SVGSVGElement>(null);

  const [kind, setKind] = useState<EntryKind>('event');
  const [title, setTitle] = useState('');
  const [lane, setLane] = useState(LANE_ORDER[0].key);
  const [magnitude, setMagnitude] = useState<(typeof MAGNITUDES)[number]>('moderate');
  const [eventType, setEventType] = useState('');
  const [description, setDescription] = useState('');
  const [startYear, setStartYear] = useState<number | null>(null);
  const [endYear, setEndYear] = useState<number | null>(null);
  const [sourceTitle, setSourceTitle] = useState('');
  const [confidence, setConfidence] = useState(60);
  const [contributorName, setContributorName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  // A little padding around the active period so events at the edges are clickable.
  const bounds = useMemo(() => {
    const span = Math.max(1, axisEnd - axisStart);
    const pad = Math.round(span * 0.05);
    return { start: axisStart - pad, end: axisEnd + pad };
  }, [axisStart, axisEnd]);

  const innerWidth = AXIS_WIDTH - AXIS_PAD * 2;
  const ticks = useMemo(() => getAxisTicks(bounds, 5), [bounds]);

  const handleAxisClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * AXIS_WIDTH - AXIS_PAD;
      const year = xToYear(Math.max(0, Math.min(innerWidth, x)), bounds, innerWidth);

      if (kind === 'event') {
        setStartYear(year);
        setEndYear(null);
        return;
      }
      // Period: first click sets start, second sets end; a third restarts.
      if (startYear === null || endYear !== null) {
        setStartYear(year);
        setEndYear(null);
      } else if (year < startYear) {
        // Clicking before the start swaps so the range stays non-inverted.
        setEndYear(startYear);
        setStartYear(year);
      } else {
        setEndYear(year);
      }
    },
    [kind, startYear, endYear, bounds, innerWidth],
  );

  const submitMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await fetch('/api/timeline/event', {
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
      setTitle('');
      setDescription('');
      setEventType('');
      setStartYear(null);
      setEndYear(null);
      setSourceTitle('');
      setErrors([]);
      onSubmitted?.();
    },
    onError: (error: any) => {
      setErrors(error.errors || [error.message || 'Submission failed']);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const localErrors: string[] = [];
    if (!title.trim()) localErrors.push('Title is required');
    if (startYear === null) localErrors.push('Click the axis (or the timeline) to set a start year');
    if (kind === 'period' && endYear === null) {
      localErrors.push('A period needs an end year — click the axis a second time');
    }
    if (localErrors.length > 0) {
      setErrors(localErrors);
      return;
    }

    submitMutation.mutate({
      kind,
      cultureProfileId,
      title: title.trim(),
      lane,
      eventType: eventType.trim() || undefined,
      magnitude,
      timePeriodStart: startYear,
      timePeriodEnd: kind === 'period' ? endYear : null,
      description: description.trim() || undefined,
      confidence,
      sources: sourceTitle ? [{ title: sourceTitle }] : undefined,
      contributorName: contributorName || undefined,
    });
  };

  const startX = startYear !== null ? yearToX(startYear, bounds, innerWidth) : null;
  const endX = endYear !== null ? yearToX(endYear, bounds, innerWidth) : null;

  return (
    <div className="p-4 space-y-4" data-testid="timeline-authoring-panel">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-indigo-600" />
          Add Timeline Entry
        </h3>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Add an event or dated period{cultureName ? ` for ${cultureName}` : ''}. Click the axis
        below to pick years; entries enter the review queue.
      </p>

      {/* Clickable temporal axis */}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
          <MousePointerClick className="h-3.5 w-3.5" />
          {kind === 'event' ? 'Click to set the year' : 'Click twice to set start & end'}
        </label>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${AXIS_WIDTH} ${AXIS_HEIGHT}`}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 cursor-pointer"
          onClick={handleAxisClick}
          role="slider"
          aria-label="Timeline year picker"
          aria-valuemin={bounds.start}
          aria-valuemax={bounds.end}
          aria-valuenow={startYear ?? bounds.start}
          data-testid="timeline-authoring-axis"
        >
          <line
            x1={AXIS_PAD}
            x2={AXIS_WIDTH - AXIS_PAD}
            y1={AXIS_HEIGHT / 2}
            y2={AXIS_HEIGHT / 2}
            stroke="currentColor"
            className="text-gray-300 dark:text-gray-600"
          />
          {ticks.map((tick) => {
            const x = AXIS_PAD + yearToX(tick, bounds, innerWidth);
            return (
              <g key={tick}>
                <line x1={x} x2={x} y1={AXIS_HEIGHT / 2 - 4} y2={AXIS_HEIGHT / 2 + 4} stroke="currentColor" className="text-gray-400" />
                <text x={x} y={AXIS_HEIGHT - 6} textAnchor="middle" style={{ fontSize: 9 }} className="fill-gray-500">
                  {formatYear(tick)}
                </text>
              </g>
            );
          })}
          {/* Selected range band */}
          {startX !== null && endX !== null && (
            <rect
              x={AXIS_PAD + Math.min(startX, endX)}
              y={AXIS_HEIGHT / 2 - 6}
              width={Math.max(2, Math.abs(endX - startX))}
              height={12}
              fill="#6366f1"
              opacity={0.25}
            />
          )}
          {/* Start marker */}
          {startX !== null && (
            <circle cx={AXIS_PAD + startX} cy={AXIS_HEIGHT / 2} r={5} fill="#6366f1" data-testid="axis-start-marker" />
          )}
          {/* End marker */}
          {endX !== null && (
            <circle cx={AXIS_PAD + endX} cy={AXIS_HEIGHT / 2} r={5} fill="#4338ca" data-testid="axis-end-marker" />
          )}
        </svg>
        <p className="text-xs text-gray-500 mt-1" data-testid="axis-year-readout">
          {startYear === null
            ? 'No year selected'
            : kind === 'period' && endYear !== null
              ? `${formatYear(startYear)} – ${formatYear(endYear)}`
              : formatYear(startYear)}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Entry Type</label>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as EntryKind);
              setEndYear(null);
            }}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            {ENTRY_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Fall of Constantinople" required />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Lane</label>
            <select value={lane} onChange={(e) => setLane(e.target.value as typeof lane)} className="w-full border rounded-md px-3 py-2 text-sm">
              {LANE_ORDER.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Magnitude</label>
            <select value={magnitude} onChange={(e) => setMagnitude(e.target.value as typeof magnitude)} className="w-full border rounded-md px-3 py-2 text-sm">
              {MAGNITUDES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Event Type</label>
          <Input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="e.g., founding, conquest (optional)" />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[50px]"
            placeholder="What happened?"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Source</label>
          <Input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} placeholder="Source title (optional)" />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Confidence: {confidence}%</label>
          <input type="range" min={1} max={100} value={confidence} onChange={(e) => setConfidence(parseInt(e.target.value, 10))} className="w-full" />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Your Name (optional)</label>
          <Input value={contributorName} onChange={(e) => setContributorName(e.target.value)} placeholder="Name" />
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

        <Button type="submit" className="w-full" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
          Submit Entry
        </Button>
      </form>
    </div>
  );
}
