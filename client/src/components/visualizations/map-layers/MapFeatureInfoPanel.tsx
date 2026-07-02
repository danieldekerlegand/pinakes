import React, { useMemo } from 'react';
import {
  MapPin, Globe, Route, Pickaxe, Landmark, Music, UtensilsCrossed,
  Church, Swords, Dna, BookOpen, Footprints, Building, Wheat, Flame,
  Star, Users, X,
} from 'lucide-react';
import {
  DetailDrawer,
  DetailDrawerHeader,
  DetailDrawerContent,
} from '../../ui/detail-drawer';
import { Badge } from '../../ui/badge';
import { formatTimePeriod } from '../../../lib/visualization/geospatial-transformers';
import type {
  LanguageRangeFeature,
  ArchaeologicalSiteFeature,
  ArchaeologicalCultureFeature,
  CivilizationFeature,
  HistoricalRouteFeature,
} from '../../../lib/visualization/geospatial-types';
import type { CuisineFeature } from './CuisineLayer';
import type { MusicTraditionFeature } from './MusicTraditionLayer';
import type { DanceTraditionFeature } from './DanceTraditionLayer';
import type { ReligionFeature } from './ReligionLayer';
import type { BattleFeature } from './BattlesLayer';
import type { DeityFeature } from './MythologyLayer';
import type { HaplogroupFeature } from './HaplogroupLayer';
import type { FoodwayEventFeature } from './FoodwayEventLayer';
import type { KinshipSystemFeature } from './KinshipSystemLayer';
import type { ArchitecturalStyleFeature } from './ArchitecturalStylesLayer';
import type { IngredientOriginFeature } from './IngredientOriginsLayer';
import type { CookingTechniqueFeature } from './CookingTechniquesLayer';
import type { UrheimatHypothesisFeature } from './UrheimatHypothesisLayer';

/**
 * Union of all possible feature data that can be displayed in the info panel.
 * Each variant carries a `featureType` discriminator.
 */
export type MapFeatureData =
  | { featureType: 'language-range'; feature: LanguageRangeFeature }
  | { featureType: 'archaeological-site'; feature: ArchaeologicalSiteFeature }
  | { featureType: 'archaeological-culture'; feature: ArchaeologicalCultureFeature }
  | { featureType: 'civilization'; feature: CivilizationFeature }
  | { featureType: 'route'; feature: HistoricalRouteFeature }
  | { featureType: 'cuisine'; feature: CuisineFeature }
  | { featureType: 'music'; feature: MusicTraditionFeature }
  | { featureType: 'dance'; feature: DanceTraditionFeature }
  | { featureType: 'religion'; feature: ReligionFeature }
  | { featureType: 'battle'; feature: BattleFeature }
  | { featureType: 'deity'; feature: DeityFeature }
  | { featureType: 'haplogroup'; feature: HaplogroupFeature }
  | { featureType: 'foodway-event'; feature: FoodwayEventFeature }
  | { featureType: 'kinship-system'; feature: KinshipSystemFeature }
  | { featureType: 'architectural-style'; feature: ArchitecturalStyleFeature }
  | { featureType: 'ingredient-origin'; feature: IngredientOriginFeature }
  | { featureType: 'cooking-technique'; feature: CookingTechniqueFeature }
  | { featureType: 'urheimat-hypothesis'; feature: UrheimatHypothesisFeature };

interface MapFeatureInfoPanelProps {
  data: MapFeatureData | null;
  onClose: () => void;
}

export function MapFeatureInfoPanel({ data, onClose }: MapFeatureInfoPanelProps) {
  if (!data) return null;

  return (
    <DetailDrawer isOpen={!!data} onClose={onClose} width="md">
      <FeatureContent data={data} onClose={onClose} />
    </DetailDrawer>
  );
}

function FeatureContent({ data, onClose }: { data: MapFeatureData; onClose: () => void }) {
  switch (data.featureType) {
    case 'language-range':
      return <LanguageRangeDetail feature={data.feature} onClose={onClose} />;
    case 'archaeological-site':
      return <ArchaeologicalSiteDetail feature={data.feature} onClose={onClose} />;
    case 'archaeological-culture':
      return <ArchaeologicalCultureDetail feature={data.feature} onClose={onClose} />;
    case 'civilization':
      return <CivilizationDetail feature={data.feature} onClose={onClose} />;
    case 'route':
      return <RouteDetail feature={data.feature} onClose={onClose} />;
    case 'cuisine':
      return <CuisineDetail feature={data.feature} onClose={onClose} />;
    case 'music':
      return <MusicDetail feature={data.feature} onClose={onClose} />;
    case 'dance':
      return <DanceDetail feature={data.feature} onClose={onClose} />;
    case 'religion':
      return <ReligionDetail feature={data.feature} onClose={onClose} />;
    case 'battle':
      return <BattleDetail feature={data.feature} onClose={onClose} />;
    case 'deity':
      return <DeityDetail feature={data.feature} onClose={onClose} />;
    case 'haplogroup':
      return <HaplogroupDetail feature={data.feature} onClose={onClose} />;
    case 'foodway-event':
      return <FoodwayEventDetail feature={data.feature} onClose={onClose} />;
    case 'kinship-system':
      return <KinshipSystemDetail feature={data.feature} onClose={onClose} />;
    case 'architectural-style':
      return <ArchitecturalStyleDetail feature={data.feature} onClose={onClose} />;
    case 'ingredient-origin':
      return <IngredientOriginDetail feature={data.feature} onClose={onClose} />;
    case 'cooking-technique':
      return <CookingTechniqueDetail feature={data.feature} onClose={onClose} />;
    case 'urheimat-hypothesis':
      return <UrheimatDetail feature={data.feature} onClose={onClose} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-start py-1.5">
      <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right ml-4">{value}</span>
    </div>
  );
}

function TagList({ items, color = 'blue' }: { items: string[]; color?: string }) {
  if (!items || items.length === 0) return null;
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };
  const cls = colorMap[color] || colorMap.blue;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((item, i) => (
        <span key={i} className={`inline-block px-2 py-0.5 text-xs rounded ${cls}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{title}</h4>
      {children}
    </div>
  );
}

function SourcesList({ sources }: { sources?: string[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <Section title="Sources">
      <ul className="list-disc list-inside space-y-1">
        {sources.map((s, i) => (
          <li key={i} className="text-xs text-gray-600 dark:text-gray-400">{s}</li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Feature type detail components
// ---------------------------------------------------------------------------

function LanguageRangeDetail({ feature, onClose }: { feature: LanguageRangeFeature; onClose: () => void }) {
  const p = feature.properties;
  return (
    <>
      <DetailDrawerHeader
        icon={<Globe className="h-6 w-6 text-blue-600" />}
        title={p.languageName}
        subtitle={p.nativeName || p.familyName}
        onClose={onClose}
        gradient="from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950"
      />
      <DetailDrawerContent>
        <InfoRow label="Language Family" value={p.familyName} />
        <InfoRow label="Range Type" value={<Badge variant="outline" className="capitalize">{p.rangeType}</Badge>} />
        <InfoRow label="Time Period" value={formatTimePeriod(p.timePeriod.start, p.timePeriod.end)} />
        <InfoRow label="Confidence" value={`${p.confidence}%`} />
        {p.totalSpeakers && <InfoRow label="Total Speakers" value={p.totalSpeakers.toLocaleString()} />}
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.status && <InfoRow label="Status" value={p.status} />}
        {p.iso639_1 && <InfoRow label="ISO 639-1" value={p.iso639_1} />}
        <SourcesList sources={p.sources} />
      </DetailDrawerContent>
    </>
  );
}

function ArchaeologicalSiteDetail({ feature, onClose }: { feature: ArchaeologicalSiteFeature; onClose: () => void }) {
  const p = feature.properties;
  return (
    <>
      <DetailDrawerHeader
        icon={<Pickaxe className="h-6 w-6 text-amber-600" />}
        title={p.name}
        subtitle={`${p.siteType} site`}
        onClose={onClose}
        gradient="from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950"
      />
      <DetailDrawerContent>
        <InfoRow label="Site Type" value={<Badge variant="outline" className="capitalize">{p.siteType}</Badge>} />
        <InfoRow label="Time Period" value={formatTimePeriod(p.timePeriod.start, p.timePeriod.end)} />
        <InfoRow label="Excavation Status" value={<Badge variant="outline" className="capitalize">{p.excavationStatus}</Badge>} />
        <InfoRow label="Importance" value={`${p.importance}/100`} />
        <InfoRow label="Attribution Confidence" value={`${p.confidence}%`} />
        {p.findings.length > 0 && (
          <Section title="Major Findings">
            <TagList items={p.findings} color="amber" />
          </Section>
        )}
        {p.associatedLanguageIds.length > 0 && (
          <Section title="Associated Languages">
            <p className="text-sm text-gray-600">{p.associatedLanguageIds.length} language(s) associated</p>
          </Section>
        )}
        <SourcesList sources={p.sources} />
      </DetailDrawerContent>
    </>
  );
}

function ArchaeologicalCultureDetail({ feature, onClose }: { feature: ArchaeologicalCultureFeature; onClose: () => void }) {
  const p = feature.properties;
  return (
    <>
      <DetailDrawerHeader
        icon={<Pickaxe className="h-6 w-6 text-orange-600" />}
        title={p.name}
        subtitle={p.region}
        onClose={onClose}
        gradient="from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950"
      />
      <DetailDrawerContent>
        <InfoRow label="Time Period" value={formatTimePeriod(p.timePeriod.start, p.timePeriod.end)} />
        <InfoRow label="Subsistence" value={<Badge variant="outline" className="capitalize">{p.subsistencePattern}</Badge>} />
        <InfoRow label="Probable Language Family" value={p.probableLanguageFamily} />
        <InfoRow label="Confidence" value={`${p.confidence}%`} />
        {p.potteryStyle && (
          <Section title="Pottery Style">
            <p className="text-sm text-gray-700 dark:text-gray-300">{p.potteryStyle}</p>
          </Section>
        )}
        {p.burialPractices && (
          <Section title="Burial Practices">
            <p className="text-sm text-gray-700 dark:text-gray-300">{p.burialPractices}</p>
          </Section>
        )}
        {p.description && (
          <Section title="Description">
            <p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p>
          </Section>
        )}
        {p.probableHaplogroups.length > 0 && (
          <Section title="Probable Haplogroups">
            <TagList items={p.probableHaplogroups} color="purple" />
          </Section>
        )}
        <SourcesList sources={p.sources} />
      </DetailDrawerContent>
    </>
  );
}

function CivilizationDetail({ feature, onClose }: { feature: CivilizationFeature; onClose: () => void }) {
  const p = feature.properties;
  return (
    <>
      <DetailDrawerHeader
        icon={<Landmark className="h-6 w-6 text-purple-600" />}
        title={p.name}
        subtitle={p.nativeName}
        onClose={onClose}
        gradient="from-purple-50 to-violet-50 dark:from-purple-950 dark:to-violet-950"
      />
      <DetailDrawerContent>
        <InfoRow label="Time Period" value={formatTimePeriod(p.timePeriod.start, p.timePeriod.end)} />
        {p.politicalStructure && <InfoRow label="Political Structure" value={<Badge variant="outline" className="capitalize">{p.politicalStructure}</Badge>} />}
        {p.capital && <InfoRow label="Capital" value={p.capital} />}
        {p.population && <InfoRow label="Peak Population" value={p.population.toLocaleString()} />}
        {p.writingSystems.length > 0 && (
          <Section title="Writing Systems">
            <TagList items={p.writingSystems} color="purple" />
          </Section>
        )}
        {p.associatedLanguageIds.length > 0 && (
          <Section title="Languages">
            <p className="text-sm text-gray-600">{p.associatedLanguageIds.length} associated language(s)</p>
          </Section>
        )}
        <SourcesList sources={p.sources} />
      </DetailDrawerContent>
    </>
  );
}

function RouteDetail({ feature, onClose }: { feature: HistoricalRouteFeature; onClose: () => void }) {
  const p = feature.properties;
  return (
    <>
      <DetailDrawerHeader
        icon={<Route className="h-6 w-6 text-green-600" />}
        title={p.name}
        subtitle={`${p.routeType} route`}
        onClose={onClose}
        gradient="from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950"
      />
      <DetailDrawerContent>
        <InfoRow label="Route Type" value={<Badge variant="outline" className="capitalize">{p.routeType}</Badge>} />
        <InfoRow label="Time Period" value={formatTimePeriod(p.timePeriod.start, p.timePeriod.end)} />
        {p.direction && <InfoRow label="Direction" value={<span className="capitalize">{p.direction}</span>} />}
        {p.linguisticImpact && (
          <Section title="Linguistic Impact">
            <p className="text-sm text-gray-700 dark:text-gray-300">{p.linguisticImpact}</p>
          </Section>
        )}
        {p.tradedGoods && p.tradedGoods.length > 0 && (
          <Section title="Traded Goods">
            <TagList items={p.tradedGoods} color="green" />
          </Section>
        )}
        {p.associatedLanguageIds.length > 0 && (
          <Section title="Languages Along Route">
            <p className="text-sm text-gray-600">{p.associatedLanguageIds.length} language(s) influenced</p>
          </Section>
        )}
        <SourcesList sources={p.sources} />
      </DetailDrawerContent>
    </>
  );
}

function CuisineDetail({ feature, onClose }: { feature: CuisineFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<UtensilsCrossed className="h-6 w-6 text-orange-600" />}
        title={p.name || p.id}
        subtitle="Cuisine tradition"
        onClose={onClose}
        gradient="from-orange-50 to-yellow-50 dark:from-orange-950 dark:to-yellow-950"
      />
      <DetailDrawerContent>
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.stapleFoods && <Section title="Staple Foods"><TagList items={Array.isArray(p.stapleFoods) ? p.stapleFoods : [p.stapleFoods]} color="amber" /></Section>}
        {p.cookingMethods && <Section title="Cooking Methods"><TagList items={Array.isArray(p.cookingMethods) ? p.cookingMethods : [p.cookingMethods]} color="green" /></Section>}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function MusicDetail({ feature, onClose }: { feature: MusicTraditionFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Music className="h-6 w-6 text-pink-600" />}
        title={p.name || p.id}
        subtitle="Music tradition"
        onClose={onClose}
        gradient="from-pink-50 to-rose-50 dark:from-pink-950 dark:to-rose-950"
      />
      <DetailDrawerContent>
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.instruments && <Section title="Instruments"><TagList items={Array.isArray(p.instruments) ? p.instruments : [p.instruments]} color="purple" /></Section>}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function DanceDetail({ feature, onClose }: { feature: DanceTraditionFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Footprints className="h-6 w-6 text-teal-600" />}
        title={p.name || p.id}
        subtitle="Dance tradition"
        onClose={onClose}
        gradient="from-teal-50 to-cyan-50 dark:from-teal-950 dark:to-cyan-950"
      />
      <DetailDrawerContent>
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function ReligionDetail({ feature, onClose }: { feature: ReligionFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Church className="h-6 w-6 text-indigo-600" />}
        title={p.name || p.id}
        subtitle="Religion"
        onClose={onClose}
        gradient="from-indigo-50 to-blue-50 dark:from-indigo-950 dark:to-blue-950"
      />
      <DetailDrawerContent>
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.adherents && <InfoRow label="Adherents" value={typeof p.adherents === 'number' ? p.adherents.toLocaleString() : p.adherents} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function BattleDetail({ feature, onClose }: { feature: BattleFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Swords className="h-6 w-6 text-red-600" />}
        title={p.name || p.id}
        subtitle="Historical battle"
        onClose={onClose}
        gradient="from-red-50 to-rose-50 dark:from-red-950 dark:to-rose-950"
      />
      <DetailDrawerContent>
        {p.year && <InfoRow label="Year" value={p.year < 0 ? `${Math.abs(p.year)} BCE` : `${p.year} CE`} />}
        {p.belligerents && <Section title="Belligerents"><TagList items={Array.isArray(p.belligerents) ? p.belligerents : [p.belligerents]} color="red" /></Section>}
        {p.outcome && <InfoRow label="Outcome" value={p.outcome} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function DeityDetail({ feature, onClose }: { feature: DeityFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Star className="h-6 w-6 text-yellow-600" />}
        title={p.name || p.id}
        subtitle="Deity / Mythological figure"
        onClose={onClose}
        gradient="from-yellow-50 to-amber-50 dark:from-yellow-950 dark:to-amber-950"
      />
      <DetailDrawerContent>
        {p.pantheon && <InfoRow label="Pantheon" value={p.pantheon} />}
        {p.domain && <InfoRow label="Domain" value={p.domain} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function HaplogroupDetail({ feature, onClose }: { feature: HaplogroupFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Dna className="h-6 w-6 text-emerald-600" />}
        title={p.name || p.id}
        subtitle={p.haplogroupType || 'Haplogroup'}
        onClose={onClose}
        gradient="from-emerald-50 to-green-50 dark:from-emerald-950 dark:to-green-950"
      />
      <DetailDrawerContent>
        {p.haplogroupType && <InfoRow label="Type" value={p.haplogroupType} />}
        {p.geographicOrigin && <InfoRow label="Geographic Origin" value={p.geographicOrigin} />}
        {p.timeOrigin && <InfoRow label="Time of Origin" value={p.timeOrigin} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function FoodwayEventDetail({ feature, onClose }: { feature: FoodwayEventFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Wheat className="h-6 w-6 text-lime-600" />}
        title={p.name || p.id}
        subtitle="Foodway event"
        onClose={onClose}
        gradient="from-lime-50 to-green-50 dark:from-lime-950 dark:to-green-950"
      />
      <DetailDrawerContent>
        {p.eventType && <InfoRow label="Event Type" value={<Badge variant="outline" className="capitalize">{p.eventType}</Badge>} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function KinshipSystemDetail({ feature, onClose }: { feature: KinshipSystemFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Users className="h-6 w-6 text-sky-600" />}
        title={p.name || p.id}
        subtitle="Kinship system"
        onClose={onClose}
        gradient="from-sky-50 to-blue-50 dark:from-sky-950 dark:to-blue-950"
      />
      <DetailDrawerContent>
        {p.systemType && <InfoRow label="System Type" value={<Badge variant="outline" className="capitalize">{p.systemType}</Badge>} />}
        {p.descentRule && <InfoRow label="Descent Rule" value={p.descentRule} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function ArchitecturalStyleDetail({ feature, onClose }: { feature: ArchitecturalStyleFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Building className="h-6 w-6 text-stone-600" />}
        title={p.name || p.id}
        subtitle="Architectural style"
        onClose={onClose}
        gradient="from-stone-50 to-gray-50 dark:from-stone-950 dark:to-gray-950"
      />
      <DetailDrawerContent>
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function IngredientOriginDetail({ feature, onClose }: { feature: IngredientOriginFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Wheat className="h-6 w-6 text-green-600" />}
        title={p.name || p.id}
        subtitle="Ingredient origin"
        onClose={onClose}
        gradient="from-green-50 to-lime-50 dark:from-green-950 dark:to-lime-950"
      />
      <DetailDrawerContent>
        {p.originRegion && <InfoRow label="Origin Region" value={p.originRegion} />}
        {p.domesticationDate && <InfoRow label="Domesticated" value={p.domesticationDate} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function CookingTechniqueDetail({ feature, onClose }: { feature: CookingTechniqueFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<Flame className="h-6 w-6 text-red-500" />}
        title={p.name || p.id}
        subtitle="Cooking technique"
        onClose={onClose}
        gradient="from-red-50 to-orange-50 dark:from-red-950 dark:to-orange-950"
      />
      <DetailDrawerContent>
        {p.region && <InfoRow label="Region" value={p.region} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}

function UrheimatDetail({ feature, onClose }: { feature: UrheimatHypothesisFeature; onClose: () => void }) {
  const p = feature as any;
  return (
    <>
      <DetailDrawerHeader
        icon={<BookOpen className="h-6 w-6 text-violet-600" />}
        title={p.name || p.id}
        subtitle="Urheimat hypothesis"
        onClose={onClose}
        gradient="from-violet-50 to-purple-50 dark:from-violet-950 dark:to-purple-950"
      />
      <DetailDrawerContent>
        {p.languageFamily && <InfoRow label="Language Family" value={p.languageFamily} />}
        {p.proposedBy && <InfoRow label="Proposed By" value={p.proposedBy} />}
        {p.confidence && <InfoRow label="Confidence" value={`${p.confidence}%`} />}
        {p.description && <Section title="Description"><p className="text-sm text-gray-700 dark:text-gray-300">{p.description}</p></Section>}
      </DetailDrawerContent>
    </>
  );
}
