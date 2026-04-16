import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  X,
  Clock,
  MapPin,
  Users,
  Landmark,
  BookOpen,
  Palette,
  Music,
  UtensilsCrossed,
  Swords,
  Lightbulb,
  ScrollText,
  Building2,
  TrendingUp,
} from "lucide-react";
import type { CultureProfile } from "@shared/types";
import EconomyTradeSection from "@/components/culture-profile/economy-trade-section";
import TechnologyInnovationSection from "@/components/culture-profile/technology-innovation-section";
import CultureEvolutionTimelineSection from "@/components/culture-profile/culture-evolution-timeline-section";

interface CultureProfilePanelProps {
  cultureId: string;
  onClose: () => void;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatTimePeriod(start: number, end: number): string {
  return `${formatYear(start)} \u2013 ${formatYear(end)}`;
}

function formatPopulation(pop: number): string {
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(pop % 1_000_000 === 0 ? 0 : 1)}M`;
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(0)}K`;
  return pop.toLocaleString();
}

const SOCIAL_ORG_LABELS: Record<string, string> = {
  egalitarian: "Egalitarian",
  chiefdom: "Chiefdom",
  state: "State",
  empire: "Empire",
};

const SUBSISTENCE_LABELS: Record<string, string> = {
  "hunter-gatherer": "Hunter-Gatherer",
  pastoral: "Pastoral",
  agricultural: "Agricultural",
  maritime: "Maritime",
  mixed: "Mixed",
};

const URBANISM_LABELS: Record<string, string> = {
  nomadic: "Nomadic",
  village: "Village",
  town: "Town",
  "city-state": "City-State",
  metropolis: "Metropolis",
};

const TECH_LABELS: Record<string, string> = {
  stone: "Stone Age",
  copper: "Copper Age",
  bronze: "Bronze Age",
  iron: "Iron Age",
  steel: "Steel Age",
  industrial: "Industrial",
};

const TECH_COLORS: Record<string, string> = {
  stone: "bg-gray-500",
  copper: "bg-orange-400",
  bronze: "bg-amber-600",
  iron: "bg-slate-600",
  steel: "bg-zinc-400",
  industrial: "bg-blue-600",
};

function QuickStatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="text-gray-400">{icon}</div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</p>
      </div>
    </div>
  );
}

function MiniTimeline({ start, end }: { start: number; end: number }) {
  const timelineMin = -5000;
  const timelineMax = 2100;
  const range = timelineMax - timelineMin;
  const left = Math.max(0, ((start - timelineMin) / range) * 100);
  const width = Math.max(2, ((end - start) / range) * 100);

  return (
    <div className="mt-3" data-testid="mini-timeline">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Historical Position</p>
      <div className="relative h-6 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
        <div
          className="absolute h-full bg-indigo-500 rounded opacity-80"
          style={{ left: `${left}%`, width: `${width}%`, minWidth: "4px" }}
        />
        {/* Zero marker */}
        <div
          className="absolute h-full w-px bg-gray-300 dark:bg-gray-600"
          style={{ left: `${((0 - timelineMin) / range) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>5000 BCE</span>
        <span>0</span>
        <span>2000 CE</span>
      </div>
    </div>
  );
}

function SummaryTab({ profile }: { profile: CultureProfile }) {
  return (
    <div className="space-y-4" data-testid="summary-tab">
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {profile.summaryDescription}
      </p>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        {profile.populationEstimate && (
          <QuickStatCard
            label="Population"
            value={formatPopulation(profile.populationEstimate)}
            icon={<Users className="h-4 w-4" />}
          />
        )}
        <QuickStatCard
          label="Urbanism"
          value={URBANISM_LABELS[profile.urbanismLevel] || profile.urbanismLevel}
          icon={<Building2 className="h-4 w-4" />}
        />
        <QuickStatCard
          label="Technology"
          value={TECH_LABELS[profile.technologyLevel] || profile.technologyLevel}
          icon={<Lightbulb className="h-4 w-4" />}
        />
        <QuickStatCard
          label="Subsistence"
          value={SUBSISTENCE_LABELS[profile.subsistenceType] || profile.subsistenceType}
          icon={<UtensilsCrossed className="h-4 w-4" />}
        />
      </div>

      <MiniTimeline start={profile.timePeriodStart} end={profile.timePeriodEnd} />

      {/* Notable Settlements */}
      {profile.notableSettlements.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notable Settlements</p>
          <div className="flex flex-wrap gap-1">
            {profile.notableSettlements.map((s) => (
              <Badge key={s} variant="outline" className="text-xs">
                <MapPin className="h-3 w-3 mr-1" />
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Associated IDs preview */}
      {profile.associatedLanguageIds.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Languages</p>
          <div className="flex flex-wrap gap-1">
            {profile.associatedLanguageIds.map((id) => (
              <Badge key={id} variant="outline" className="text-xs bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                {id}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {profile.associatedReligionIds.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Religions</p>
          <div className="flex flex-wrap gap-1">
            {profile.associatedReligionIds.map((id) => (
              <Badge key={id} variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800">
                {id}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {profile.sources.length > 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
          Sources: {profile.sources.join("; ")}
        </p>
      )}
    </div>
  );
}

function PlaceholderSection({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-500">
      <div className="mb-2">{icon}</div>
      <p className="text-sm">{title}</p>
      <p className="text-xs mt-1">Content coming soon</p>
    </div>
  );
}

export default function CultureProfilePanel({ cultureId, onClose }: CultureProfilePanelProps) {
  const [activeTab, setActiveTab] = useState("summary");

  const { data: profile, isLoading } = useQuery<CultureProfile>({
    queryKey: ["/api/culture-profiles", cultureId],
    queryFn: async () => {
      const response = await fetch(`/api/culture-profiles/${cultureId}`);
      if (!response.ok) throw new Error("Failed to fetch culture profile");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
        <div
          className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-white dark:bg-gray-900 shadow-xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
          data-testid="culture-profile-panel-loading"
        >
          <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2 animate-pulse">
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i}>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                  <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-white dark:bg-gray-900 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="culture-profile-panel"
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30">
          <div className="p-6 pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Landmark className="h-6 w-6 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100" data-testid="culture-name">
                    {profile.name}
                  </h2>
                  {profile.alternateNames.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {profile.alternateNames.join(", ")}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="culture-panel-close">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge variant="outline" className="text-xs" data-testid="badge-time-period">
                <Clock className="h-3 w-3 mr-1" />
                {formatTimePeriod(profile.timePeriodStart, profile.timePeriodEnd)}
              </Badge>
              <Badge variant="outline" className="text-xs" data-testid="badge-region">
                <MapPin className="h-3 w-3 mr-1" />
                {profile.region}
              </Badge>
              <Badge className={`text-xs text-white ${TECH_COLORS[profile.technologyLevel] || "bg-gray-500"}`} data-testid="badge-tech">
                {TECH_LABELS[profile.technologyLevel] || profile.technologyLevel}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {SOCIAL_ORG_LABELS[profile.socialOrganization] || profile.socialOrganization}
              </Badge>
            </div>
          </div>

          {/* Tabs Navigation */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4">
            <TabsList className="w-full h-auto flex-wrap justify-start gap-0.5 bg-transparent p-0 pb-1">
              <TabsTrigger value="summary" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-summary">
                Summary
              </TabsTrigger>
              <TabsTrigger value="evolution" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-evolution">
                Evolution
              </TabsTrigger>
              <TabsTrigger value="language" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-language">
                Language
              </TabsTrigger>
              <TabsTrigger value="religion" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-religion">
                Religion
              </TabsTrigger>
              <TabsTrigger value="architecture" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-architecture">
                Architecture
              </TabsTrigger>
              <TabsTrigger value="arts" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-arts">
                Arts
              </TabsTrigger>
              <TabsTrigger value="cuisine" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-cuisine">
                Cuisine
              </TabsTrigger>
              <TabsTrigger value="economy" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-economy">
                Economy
              </TabsTrigger>
              <TabsTrigger value="daily-life" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-daily-life">
                Daily Life
              </TabsTrigger>
              <TabsTrigger value="military" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-military">
                Military
              </TabsTrigger>
              <TabsTrigger value="technology" className="text-xs px-2 py-1 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-800" data-testid="tab-technology">
                Technology
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsContent value="summary">
              <SummaryTab profile={profile} />
            </TabsContent>
            <TabsContent value="evolution">
              <CultureEvolutionTimelineSection
                cultureProfileId={profile.id}
                cultureName={profile.name}
                profileStart={profile.timePeriodStart}
                profileEnd={profile.timePeriodEnd}
              />
            </TabsContent>
            <TabsContent value="language">
              <PlaceholderSection title="Language & Writing" icon={<ScrollText className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="religion">
              <PlaceholderSection title="Religion & Mythology" icon={<BookOpen className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="architecture">
              <PlaceholderSection title="Architecture & Urban Planning" icon={<Building2 className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="arts">
              <PlaceholderSection title="Material Culture & Arts" icon={<Palette className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="cuisine">
              <PlaceholderSection title="Cuisine & Foodways" icon={<UtensilsCrossed className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="economy">
              <EconomyTradeSection
                cultureProfileId={profile.id}
                languageIds={profile.associatedLanguageIds}
                cultureName={profile.name}
                region={profile.region}
              />
            </TabsContent>
            <TabsContent value="daily-life">
              <PlaceholderSection title="Daily Life & Social Organization" icon={<Users className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="military">
              <PlaceholderSection title="Military & Warfare" icon={<Swords className="h-8 w-8" />} />
            </TabsContent>
            <TabsContent value="technology">
              <TechnologyInnovationSection
                cultureProfileId={profile.id}
                cultureName={profile.name}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
