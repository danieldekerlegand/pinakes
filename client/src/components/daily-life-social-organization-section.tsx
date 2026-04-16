import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Crown,
  Home,
  Heart,
  Briefcase,
  Scale,
  GraduationCap,
  Gamepad2,
  ChevronDown,
  ChevronRight,
  Filter,
} from "lucide-react";

export interface SocialOrganization {
  id: string;
  name: string;
  cultureOrLanguage: string;
  region: string;
  politicalStructure: string;
  stratificationType: string;
  subsistencePattern: string;
  marriageSystem: string;
  descentSystem: string;
  residencePattern: string;
  kinshipTerminology: string;
  propertyInheritance: string;
  genderRoles: string;
  ageGrades: string;
  clanOrMoietySystem: string;
  timeOrigin: string;
  timeEnd: string;
  notes: string;
}

interface SocialOrganizationResponse {
  organizations: SocialOrganization[];
  count: number;
}

interface Props {
  cultureId?: string;
  embedded?: boolean;
}

const SOCIAL_CLASS_COLORS: Record<string, string> = {
  egalitarian: "#16a34a",
  ranked: "#d97706",
  stratified: "#dc2626",
  "class-based": "#7c3aed",
};

const SUBSISTENCE_ICONS: Record<string, string> = {
  pastoralism: "🐄",
  horticulture: "🌱",
  foraging: "🍂",
  agriculture: "🌾",
  maritime: "⚓",
  mixed: "🔄",
};

function getStratificationColor(type: string): string {
  return SOCIAL_CLASS_COLORS[type.toLowerCase()] || "#6b7280";
}

function getSubsistenceIcon(pattern: string): string {
  for (const [key, icon] of Object.entries(SUBSISTENCE_ICONS)) {
    if (pattern.toLowerCase().includes(key)) return icon;
  }
  return "🏠";
}

export function formatTimePeriod(origin: string, end: string): string {
  const start = origin === "present" ? "present" : origin;
  const endStr = end === "present" ? "present" : end;
  if (!start && !endStr) return "Unknown period";
  const formatYear = (y: string) => {
    const num = parseInt(y, 10);
    if (isNaN(num)) return y;
    if (num < 0) return `${Math.abs(num)} BCE`;
    return `${num} CE`;
  };
  return `${formatYear(start)} – ${formatYear(endStr)}`;
}

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  colorClass: string;
}

function SectionCard({ icon, title, children, colorClass }: SectionCardProps) {
  return (
    <div className={`rounded-lg border p-4 ${colorClass}`}>
      <div className="flex items-center space-x-2 mb-3">
        {icon}
        <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function HierarchyPyramid({ stratificationType, politicalStructure }: {
  stratificationType: string;
  politicalStructure: string;
}) {
  const tiers = buildHierarchyTiers(stratificationType, politicalStructure);
  const maxWidth = 100;

  return (
    <div className="flex flex-col items-center space-y-1" data-testid="hierarchy-pyramid">
      {tiers.map((tier, idx) => {
        const widthPercent = ((idx + 1) / tiers.length) * maxWidth;
        return (
          <div
            key={tier.label}
            className="text-center text-xs text-white font-medium py-1.5 rounded"
            style={{
              width: `${widthPercent}%`,
              backgroundColor: tier.color,
              minWidth: "60px",
            }}
            title={tier.description}
          >
            {tier.label}
          </div>
        );
      })}
    </div>
  );
}

export function buildHierarchyTiers(
  stratificationType: string,
  politicalStructure: string
): Array<{ label: string; color: string; description: string }> {
  const lower = stratificationType.toLowerCase();

  if (lower.includes("egalitarian")) {
    return [
      { label: "Elders / Leaders", color: "#059669", description: "Informal authority based on experience" },
      { label: "Community Members", color: "#10b981", description: "Equal access to resources" },
    ];
  }

  if (lower.includes("ranked")) {
    return [
      { label: "Chief / Paramount", color: "#b45309", description: "Hereditary or elected leadership" },
      { label: "Sub-chiefs / Nobles", color: "#d97706", description: "Supporting leadership roles" },
      { label: "Commoners", color: "#f59e0b", description: "General population" },
    ];
  }

  // Default: stratified / class-based
  const isState = politicalStructure.toLowerCase().includes("state") ||
    politicalStructure.toLowerCase().includes("empire") ||
    politicalStructure.toLowerCase().includes("confederacy");

  if (isState) {
    return [
      { label: "Ruler / Council", color: "#7c2d12", description: "Supreme authority" },
      { label: "Nobility / Priesthood", color: "#b91c1c", description: "Privileged class with land and power" },
      { label: "Warriors / Merchants", color: "#dc2626", description: "Professional and commercial class" },
      { label: "Commoners / Farmers", color: "#ef4444", description: "Majority of population" },
      { label: "Enslaved / Bonded", color: "#fca5a5", description: "Lowest social stratum" },
    ];
  }

  return [
    { label: "Leadership", color: "#6d28d9", description: "Political authority" },
    { label: "Specialists", color: "#7c3aed", description: "Skilled roles" },
    { label: "General Population", color: "#a78bfa", description: "Common members" },
  ];
}

function OrganizationDetail({ org }: { org: SocialOrganization }) {
  const color = getStratificationColor(org.stratificationType);

  return (
    <div className="space-y-4" data-testid={`org-detail-${org.id}`}>
      {/* Social Hierarchy */}
      <SectionCard
        icon={<Crown className="h-4 w-4 text-amber-600" />}
        title="Social Hierarchy"
        colorClass="bg-amber-50/50 border-amber-200"
      >
        <HierarchyPyramid
          stratificationType={org.stratificationType}
          politicalStructure={org.politicalStructure}
        />
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-500">Political Structure:</span>
            <Badge variant="outline" className="ml-1" style={{ borderColor: color, color }}>
              {org.politicalStructure}
            </Badge>
          </div>
          <div>
            <span className="text-gray-500">Stratification:</span>
            <Badge variant="outline" className="ml-1" style={{ borderColor: color, color }}>
              {org.stratificationType}
            </Badge>
          </div>
        </div>
      </SectionCard>

      {/* Family & Kinship */}
      <SectionCard
        icon={<Heart className="h-4 w-4 text-rose-500" />}
        title="Family Structure & Kinship"
        colorClass="bg-rose-50/50 border-rose-200"
      >
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-1">Marriage System</p>
            <p className="font-medium">{org.marriageSystem}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Descent System</p>
            <p className="font-medium">{org.descentSystem}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Residence Pattern</p>
            <p className="font-medium">{org.residencePattern}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Kinship Terminology</p>
            <p className="font-medium">{org.kinshipTerminology}</p>
          </div>
          {org.clanOrMoietySystem && (
            <div className="col-span-2">
              <p className="text-xs text-gray-500 mb-1">Clan / Moiety System</p>
              <p className="font-medium">{org.clanOrMoietySystem}</p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Gender Roles */}
      {org.genderRoles && (
        <SectionCard
          icon={<Users className="h-4 w-4 text-violet-500" />}
          title="Gender Roles"
          colorClass="bg-violet-50/50 border-violet-200"
        >
          <p className="text-sm text-gray-700">{org.genderRoles}</p>
        </SectionCard>
      )}

      {/* Subsistence & Economy */}
      <SectionCard
        icon={<Briefcase className="h-4 w-4 text-emerald-600" />}
        title="Subsistence & Economy"
        colorClass="bg-emerald-50/50 border-emerald-200"
      >
        <div className="flex items-center space-x-2 mb-2">
          <span className="text-2xl">{getSubsistenceIcon(org.subsistencePattern)}</span>
          <div>
            <p className="text-sm font-medium">{org.subsistencePattern}</p>
            <p className="text-xs text-gray-500">Primary subsistence pattern</p>
          </div>
        </div>
        <div className="text-sm">
          <p className="text-xs text-gray-500 mb-1">Property Inheritance</p>
          <p>{org.propertyInheritance}</p>
        </div>
      </SectionCard>

      {/* Age Grades */}
      {org.ageGrades && org.ageGrades !== "no formal age-grades" && (
        <SectionCard
          icon={<GraduationCap className="h-4 w-4 text-blue-500" />}
          title="Age Grades & Education"
          colorClass="bg-blue-50/50 border-blue-200"
        >
          <p className="text-sm text-gray-700">{org.ageGrades}</p>
        </SectionCard>
      )}

      {/* Notes */}
      {org.notes && (
        <SectionCard
          icon={<Scale className="h-4 w-4 text-gray-500" />}
          title="Historical Notes"
          colorClass="bg-gray-50 border-gray-200"
        >
          <p className="text-sm text-gray-700">{org.notes}</p>
        </SectionCard>
      )}
    </div>
  );
}

export default function DailyLifeSocialOrganizationSection({
  cultureId,
  embedded = false,
}: Props) {
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [selectedSubsistence, setSelectedSubsistence] = useState<string>("all");

  const { data, isLoading } = useQuery<SocialOrganizationResponse>({
    queryKey: ["/api/social-organization", cultureId],
    enabled: true,
  });

  const organizations = data?.organizations ?? [];

  const regions = useMemo(() => {
    const r = new Set<string>();
    organizations.forEach((o) => r.add(o.region));
    return Array.from(r).sort();
  }, [organizations]);

  const subsistencePatterns = useMemo(() => {
    const s = new Set<string>();
    organizations.forEach((o) => s.add(o.subsistencePattern));
    return Array.from(s).sort();
  }, [organizations]);

  const filtered = useMemo(() => {
    return organizations.filter((o) => {
      if (selectedRegion !== "all" && o.region !== selectedRegion) return false;
      if (selectedSubsistence !== "all" && o.subsistencePattern !== selectedSubsistence) return false;
      return true;
    });
  }, [organizations, selectedRegion, selectedSubsistence]);

  return (
    <div
      className={embedded ? "h-full flex flex-col" : "space-y-4"}
      data-testid="daily-life-social-organization-section"
    >
      {/* Section Header */}
      <div className="px-1">
        <div className="flex items-center space-x-2 mb-2">
          <Home className="h-5 w-5 text-teal-600" />
          <h3 className="text-base font-semibold text-gray-900">
            Daily Life & Social Organization
          </h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Explore social hierarchies, kinship systems, gender roles, and daily
          life patterns across cultures.
        </p>

        {/* Filters */}
        <div className="flex items-center space-x-3 mb-4">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            className="text-sm border rounded px-2 py-1 bg-white"
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            data-testid="region-filter"
          >
            <option value="all">All Regions ({organizations.length})</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r} ({organizations.filter((o) => o.region === r).length})
              </option>
            ))}
          </select>
          <select
            className="text-sm border rounded px-2 py-1 bg-white"
            value={selectedSubsistence}
            onChange={(e) => setSelectedSubsistence(e.target.value)}
            data-testid="subsistence-filter"
          >
            <option value="all">All Subsistence</option>
            {subsistencePatterns.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center text-gray-500 py-8" data-testid="loading-state">
          Loading social organization data...
        </div>
      )}

      {/* Organization Cards */}
      {!isLoading && (
        <div className="space-y-3">
          {filtered.map((org) => {
            const isExpanded = expandedOrg === org.id;
            const stratColor = getStratificationColor(org.stratificationType);

            return (
              <Card key={org.id} className="overflow-hidden" data-testid={`org-card-${org.id}`}>
                <button
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                  onClick={() => setExpandedOrg(isExpanded ? null : org.id)}
                  data-testid={`org-toggle-${org.id}`}
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stratColor }}
                    />
                    <div>
                      <p className="font-medium text-sm">{org.name}</p>
                      <p className="text-xs text-gray-500">
                        {org.cultureOrLanguage} · {org.region} ·{" "}
                        {formatTimePeriod(org.timeOrigin, org.timeEnd)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge
                      variant="outline"
                      className="text-xs"
                      style={{ borderColor: stratColor, color: stratColor }}
                    >
                      {org.stratificationType}
                    </Badge>
                    <Badge variant="outline" className="text-xs bg-emerald-50 border-emerald-200">
                      {getSubsistenceIcon(org.subsistencePattern)} {org.subsistencePattern}
                    </Badge>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t pt-3">
                    <OrganizationDetail org={org} />
                  </div>
                )}
              </Card>
            );
          })}

          {filtered.length === 0 && !isLoading && (
            <div className="text-center text-gray-500 py-12" data-testid="empty-state">
              No social organization data found for the selected filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
