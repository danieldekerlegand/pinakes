import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/visualization/types";
import {
  TreePine,
  Network,
  Clock,
  Map,
  Box,
  Compass,
  GitBranch,
  Plus,
  FileText,
  BookOpen,
  Scale,
  Ruler,
  Volume2,
  Languages,
  PenTool,
  ListOrdered,
  Building2,
  BarChart3,
  Database,
  Library,
  Brain,
  Hammer,
  ClipboardCheck,
  Dna,
  FlaskConical,
  Globe,
  ShieldAlert,
} from "lucide-react";

interface AppSidebarProps {
  activeView: ViewMode;
  activeSection: string | null;
  onViewChange: (view: ViewMode) => void;
  onSectionChange: (section: string | null) => void;
  onNavigate: (path: string) => void;
}

type ViewItem = {
  id: ViewMode;
  label: string;
  icon: typeof TreePine;
};

type SectionItem = {
  id: string;
  label: string;
  icon: typeof TreePine;
};

type RouteItem = {
  path: string;
  label: string;
  icon: typeof TreePine;
};

const VIEW_ITEMS: ViewItem[] = [
  { id: "tree", label: "Family Tree", icon: TreePine },
  { id: "network", label: "Network", icon: Network },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "map", label: "Map", icon: Map },
  { id: "map-3d", label: "3D Map", icon: Box },
  { id: "explorer", label: "Explorer", icon: Compass },
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "contribute", label: "Contribute", icon: Plus },
];

const DATA_SECTIONS: SectionItem[] = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "data-overview", label: "Data Overview", icon: Database },
];

const TOOLS_SECTIONS: SectionItem[] = [
  { id: "text-analyzer", label: "Text Analyzer", icon: FileText },
  { id: "word-etymology", label: "Word Etymology", icon: BookOpen },
  { id: "comparison", label: "Word Comparison", icon: Scale },
  { id: "distance", label: "Linguistic Distance", icon: Ruler },
  { id: "correlation", label: "Correlation Explorer", icon: BarChart3 },
];

const SPECIALIST_SECTIONS: SectionItem[] = [
  { id: "phonology", label: "Phonology (IPA)", icon: Volume2 },
  { id: "grammar", label: "Grammar Features", icon: Languages },
  { id: "writing", label: "Writing Systems", icon: PenTool },
  { id: "verbs", label: "Verb Paradigms", icon: ListOrdered },
  { id: "mesopotamia", label: "Mesopotamia", icon: Building2 },
];

const ROUTE_ITEMS: RouteItem[] = [
  { path: "/stories", label: "Stories", icon: Library },
  { path: "/quiz", label: "Quiz", icon: Brain },
  { path: "/civilization-timeline", label: "Civilizations", icon: Clock },
  { path: "/scraper", label: "Scraper", icon: Hammer },
  { path: "/ai-review", label: "AI Review", icon: ClipboardCheck },
  { path: "/ancestry", label: "Ancestry (DNA)", icon: Dna },
  { path: "/hypotheses", label: "Hypotheses", icon: FlaskConical },
  { path: "/immersive", label: "Immersive (3D)", icon: Globe },
  { path: "/endangered-languages", label: "Endangered Langs", icon: ShieldAlert },
  { path: "/living-dataset", label: "Living Dataset", icon: Library },
];

export function AppSidebar({
  activeView,
  activeSection,
  onViewChange,
  onSectionChange,
  onNavigate,
}: AppSidebarProps) {
  const handleSectionClick = (id: string) => {
    onSectionChange(activeSection === id ? null : id);
  };

  return (
    <aside
      className="w-56 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col"
      role="navigation"
      aria-label="Primary"
    >
      <ScrollArea className="flex-1">
        <div className="py-3">
          <SidebarGroup label="Visualizations">
            {VIEW_ITEMS.map((item) => (
              <SidebarButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={!activeSection && activeView === item.id}
                onClick={() => {
                  onSectionChange(null);
                  onViewChange(item.id);
                }}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup label="Data">
            {DATA_SECTIONS.map((item) => (
              <SidebarButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === item.id}
                onClick={() => handleSectionClick(item.id)}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup label="Tools">
            {TOOLS_SECTIONS.map((item) => (
              <SidebarButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === item.id}
                onClick={() => handleSectionClick(item.id)}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup label="Specialist Views">
            {SPECIALIST_SECTIONS.map((item) => (
              <SidebarButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === item.id}
                onClick={() => handleSectionClick(item.id)}
              />
            ))}
          </SidebarGroup>

          <SidebarGroup label="Pages">
            {ROUTE_ITEMS.map((item) => (
              <SidebarButton
                key={item.path}
                icon={item.icon}
                label={item.label}
                active={false}
                onClick={() => onNavigate(item.path)}
              />
            ))}
          </SidebarGroup>
        </div>
      </ScrollArea>
    </aside>
  );
}

interface SidebarGroupProps {
  label: string;
  children: React.ReactNode;
}

function SidebarGroup({ label, children }: SidebarGroupProps) {
  return (
    <div className="px-2 pb-3">
      <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

interface SidebarButtonProps {
  icon: typeof TreePine;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SidebarButton({ icon: Icon, label, active, onClick }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-xs transition-colors",
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-gray-700 hover:bg-gray-100"
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
