import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  TimelineVisualization,
  type TimelineItem,
  type TimelineTooltipContent,
} from '@/components/visualizations/shared/TimelineVisualization';
import { getFamilyColor } from '@/lib/visualization/d3-helpers';
import { formatNumber } from '@/lib/visualization/d3-helpers';
import type { CivilizationFeature } from '@/lib/visualization/geospatial-types';

type GroupByOption = 'political-structure' | 'region' | 'writing-system';

function formatYear(year: number | null): string {
  if (year === null) return 'Present';
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function inferRegion(civ: CivilizationFeature['properties']): string {
  const langIds = civ.associatedLanguageIds ?? [];
  const id = civ.civilizationId ?? '';
  const name = civ.name ?? '';

  const patterns: Array<[RegExp, string]> = [
    [/han-dynasty|tang-dynasty|song-dynasty|ming-dynasty|qing-dynasty|shang-dynasty|zhou-dynasty|qin-dynasty/i, 'East Asia'],
    [/heian|nara|tokugawa/i, 'East Asia'],
    [/goryeo|joseon/i, 'East Asia'],
    [/xiongnu|mongol|golden-horde|timurid/i, 'Central Asia'],
    [/sogdian|khwarazmian/i, 'Central Asia'],
    [/srivijaya|majapahit|khmer|ayutthaya|pagan|dai-viet/i, 'Southeast Asia'],
    [/maurya|gupta|chola|vijayanagara|delhi-sultanate|mughal|kushan|indus-valley/i, 'South Asia'],
    [/tibetan/i, 'Central Asia'],
    [/roman|byzantine|hre|carolingian|kievan|viking|celtic/i, 'Europe'],
    [/spanish-empire|portuguese-empire|british-empire/i, 'Europe'],
    [/persian|achaemenid|sasanian|safavid|seljuk|parthian/i, 'Middle East'],
    [/umayyad|abbasid/i, 'Middle East'],
    [/ottoman/i, 'Middle East'],
    [/sumerian|akkadian|babylonian|assyrian|hittite|lydian|urartu|elamite|nabataean/i, 'Middle East'],
    [/ancient-egypt|kingdom-of-kush|axum|ghana-empire|mali|songhai|great-zimbabwe|zulu|benin|ethiopian|kanem|swahili|kingdom-of-punt/i, 'Africa'],
    [/aztec|inca|maya|olmec|zapotec|toltec|muisca|tiwanaku|mississippian|haudenosaunee/i, 'Americas'],
    [/minoan|mycenaean|ancient-greece|carthage|phoenicia/i, 'Mediterranean'],
  ];

  for (const [pattern, region] of patterns) {
    if (pattern.test(id) || pattern.test(name)) return region;
  }

  if (langIds.some((l: string) => ['cmn', 'jpn', 'kor'].includes(l))) return 'East Asia';
  if (langIds.some((l: string) => ['san', 'hin', 'tam', 'kan', 'tel'].includes(l))) return 'South Asia';
  if (langIds.some((l: string) => ['arb', 'fas', 'tur'].includes(l))) return 'Middle East';
  if (langIds.some((l: string) => ['lat', 'fra', 'deu', 'eng', 'spa', 'por'].includes(l))) return 'Europe';

  return 'Other';
}

export default function CivilizationTimeline() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByOption>('political-structure');

  const { data, isLoading, error } = useQuery<{ features: CivilizationFeature[] }>({
    queryKey: ['/api/map/civilizations'],
  });

  const timelineItems: TimelineItem[] = useMemo(() => {
    if (!data?.features) return [];

    return data.features.map((feature) => {
      const props = feature.properties;
      let group: string;

      switch (groupBy) {
        case 'political-structure':
          group = props.politicalStructure || 'Unknown';
          break;
        case 'region':
          group = inferRegion(props);
          break;
        case 'writing-system':
          group = props.writingSystems?.[0] || 'Unknown';
          break;
        default:
          group = 'Unknown';
      }

      return {
        id: props.civilizationId,
        name: props.name,
        groupName: group,
        startYear: props.timePeriod.start,
        endYear: props.timePeriod.end,
        metadata: {
          nativeName: props.nativeName,
          politicalStructure: props.politicalStructure,
          capital: props.capital,
          population: props.population,
          writingSystems: props.writingSystems,
          associatedLanguageIds: props.associatedLanguageIds,
        },
      };
    });
  }, [data, groupBy]);

  const getColor = useCallback((item: TimelineItem) => {
    return getFamilyColor(item.groupName, 0.7);
  }, []);

  const getTooltipContent = useCallback((item: TimelineItem): TimelineTooltipContent => {
    const meta = item.metadata ?? {};
    const fields: Array<{ label: string; value: string }> = [
      { label: 'Period', value: `${formatYear(item.startYear)} - ${formatYear(item.endYear)}` },
    ];

    if (meta.politicalStructure) {
      fields.push({ label: 'Structure', value: meta.politicalStructure as string });
    }
    if (meta.capital) {
      fields.push({ label: 'Capital', value: meta.capital as string });
    }
    if (meta.population) {
      fields.push({ label: 'Population', value: formatNumber(meta.population as number) });
    }
    if (meta.writingSystems && (meta.writingSystems as string[]).length > 0) {
      fields.push({ label: 'Writing', value: (meta.writingSystems as string[]).join(', ') });
    }

    return {
      title: item.name,
      subtitle: meta.nativeName as string | undefined,
      fields,
    };
  }, []);

  const handleItemClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
          <p className="text-gray-600 dark:text-gray-400">Loading civilizations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4">
          <p className="text-red-500">Failed to load civilization data</p>
          <Link href="/">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center justify-between px-4 py-3 border-b bg-white dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">Civilization Timeline</h1>
          <span className="text-sm text-gray-500">
            {timelineItems.length} civilizations
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Group by:</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
            className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="political-structure">Political Structure</option>
            <option value="region">Region</option>
            <option value="writing-system">Writing System</option>
          </select>
        </div>
      </header>
      <main className="flex-1 min-h-0 p-4">
        <TimelineVisualization
          items={timelineItems}
          getColor={getColor}
          getTooltipContent={getTooltipContent}
          onItemClick={handleItemClick}
          selectedItemId={selectedId}
          helpText="Click bars to select \u2022 Hover for details \u2022 Group by political structure, region, or writing system"
        />
      </main>
    </div>
  );
}
