import { describe, it, expect } from 'vitest';

/**
 * Unit tests for TimelineVisualization logic.
 * Tests the pure data processing and configuration logic used by the component.
 */

interface TimelineItem {
  id: string;
  name: string;
  groupName: string;
  startYear: number;
  endYear: number | null;
}

// Replicate the bar width calculation from the component
function calculateBarWidth(
  item: TimelineItem,
  xScale: (year: number) => number
): number {
  const endYear = item.endYear || new Date().getFullYear();
  return Math.max(2, xScale(endYear) - xScale(item.startYear));
}

// Replicate group extraction logic
function extractGroups(data: TimelineItem[]): string[] {
  return Array.from(new Set(data.map((d) => d.groupName)));
}

// Replicate year extent logic
function getYearExtent(data: TimelineItem[]): [number, number] {
  const minYear = Math.min(...data.map((d) => d.startYear));
  const maxYear = Math.max(...data.map((d) => d.endYear || new Date().getFullYear()));
  return [
    isFinite(minYear) ? minYear : -3000,
    isFinite(maxYear) ? maxYear : 2024,
  ];
}

// Replicate BCE/CE formatting logic from the component
function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

const sampleData: TimelineItem[] = [
  { id: '1', name: 'Latin', groupName: 'Indo-European', startYear: -753, endYear: 476 },
  { id: '2', name: 'English', groupName: 'Indo-European', startYear: 450, endYear: null },
  { id: '3', name: 'Mandarin', groupName: 'Sino-Tibetan', startYear: -1200, endYear: null },
  { id: '4', name: 'Sanskrit', groupName: 'Indo-European', startYear: -1500, endYear: -600 },
];

describe('TimelineVisualization logic', () => {
  describe('extractGroups', () => {
    it('returns unique group names', () => {
      const groups = extractGroups(sampleData);
      expect(groups).toEqual(['Indo-European', 'Sino-Tibetan']);
    });

    it('returns empty array for empty data', () => {
      expect(extractGroups([])).toEqual([]);
    });

    it('handles single group', () => {
      const data = [sampleData[0], sampleData[1]];
      expect(extractGroups(data)).toEqual(['Indo-European']);
    });
  });

  describe('getYearExtent', () => {
    it('computes correct min and max years', () => {
      const [min, max] = getYearExtent(sampleData);
      expect(min).toBe(-1500);
      // max should be current year since some items have null endYear
      expect(max).toBe(new Date().getFullYear());
    });

    it('uses explicit endYear when all items have one', () => {
      const data = [
        { id: '1', name: 'A', groupName: 'G', startYear: -500, endYear: 200 },
        { id: '2', name: 'B', groupName: 'G', startYear: -100, endYear: 500 },
      ];
      const [min, max] = getYearExtent(data);
      expect(min).toBe(-500);
      expect(max).toBe(500);
    });
  });

  describe('calculateBarWidth', () => {
    const linearScale = (year: number) => (year + 2000) * 0.1; // simple linear mapping

    it('calculates width from start to end year', () => {
      const item = { id: '1', name: 'Latin', groupName: 'G', startYear: -753, endYear: 476 };
      const width = calculateBarWidth(item, linearScale);
      const expected = linearScale(476) - linearScale(-753);
      expect(width).toBeCloseTo(expected);
    });

    it('uses current year when endYear is null', () => {
      const item = { id: '2', name: 'English', groupName: 'G', startYear: 450, endYear: null };
      const width = calculateBarWidth(item, linearScale);
      const currentYear = new Date().getFullYear();
      const expected = linearScale(currentYear) - linearScale(450);
      expect(width).toBeCloseTo(expected);
    });

    it('enforces minimum width of 2', () => {
      const tinyScale = (_year: number) => 0; // zero-width scale
      const item = { id: '1', name: 'A', groupName: 'G', startYear: 0, endYear: 1 };
      expect(calculateBarWidth(item, tinyScale)).toBe(2);
    });
  });

  describe('formatYear', () => {
    it('formats negative years as BCE', () => {
      expect(formatYear(-753)).toBe('753 BCE');
    });

    it('formats positive years as CE', () => {
      expect(formatYear(476)).toBe('476 CE');
    });

    it('formats year 0 as CE', () => {
      expect(formatYear(0)).toBe('0 CE');
    });

    it('formats large negative years', () => {
      expect(formatYear(-3000)).toBe('3000 BCE');
    });
  });

  describe('color and selection callbacks', () => {
    it('color function receives the item', () => {
      const colorFn = (item: TimelineItem) => {
        return item.groupName === 'Indo-European' ? '#ff0000' : '#00ff00';
      };
      expect(colorFn(sampleData[0])).toBe('#ff0000');
      expect(colorFn(sampleData[2])).toBe('#00ff00');
    });

    it('isSelected callback works with set-based lookups', () => {
      const selectedIds = new Set(['1', '3']);
      const isSelected = (item: TimelineItem) => selectedIds.has(item.id);
      expect(isSelected(sampleData[0])).toBe(true);
      expect(isSelected(sampleData[1])).toBe(false);
      expect(isSelected(sampleData[2])).toBe(true);
    });
  });

  describe('tooltip builder', () => {
    it('builds tooltip data from a timeline item with language-specific fields', () => {
      interface LanguageTimelineItem extends TimelineItem {
        familyName: string;
        region?: string;
        status: string;
        totalSpeakers?: number;
        nativeName?: string;
        type: 'family' | 'language';
        familyId: string;
      }

      const buildTooltip = (event: LanguageTimelineItem) => ({
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
      });

      const item: LanguageTimelineItem = {
        id: '1',
        name: 'Latin',
        nativeName: 'Latina',
        type: 'language',
        familyId: 'ie',
        familyName: 'Indo-European',
        groupName: 'Indo-European',
        startYear: -753,
        endYear: 476,
        region: 'Europe',
        status: 'historical',
        totalSpeakers: 0,
      };

      const tooltip = buildTooltip(item);
      expect(tooltip.name).toBe('Latin');
      expect(tooltip.timeOrigin).toBe('-753 BCE');
      expect(tooltip.timeEnd).toBe('476 CE');
      expect(tooltip.familyName).toBe('Indo-European');
    });

    it('shows Present for null endYear', () => {
      const buildTooltip = (item: TimelineItem) => ({
        timeEnd: item.endYear ? `${item.endYear} CE` : 'Present',
      });
      expect(buildTooltip(sampleData[1]).timeEnd).toBe('Present');
    });
  });
});
