import { useVisualization } from "@/contexts/VisualizationContext";
import type { ViewMode } from "@/lib/visualization/types";
import { Badge } from "@/components/ui/badge";
import {
  TreePine,
  Network,
  Clock,
  Map,
  Combine,
  GitBranch,
  BarChart3,
} from "lucide-react";

type PanelType =
  | "language-detail"
  | "phonology"
  | "grammar"
  | "writing-systems"
  | "verb-paradigms"
  | "language-contacts"
  | "sound-changes"
  | "correlation"
  | "art-traditions"
  | "literary-traditions"
  | "archaeological-cultures"
  | "trade-goods"
  | "word-comparison"
  | "linguistic-distance";

interface Recommendation {
  view: ViewMode;
  label: string;
  reason: string;
  icon: React.ReactNode;
}

const ICON_CLASS = "h-3.5 w-3.5";

const ALL_RECOMMENDATIONS: Record<ViewMode, Omit<Recommendation, "reason">> = {
  tree: { view: "tree", label: "Family Tree", icon: <TreePine className={ICON_CLASS} /> },
  network: { view: "network", label: "Network", icon: <Network className={ICON_CLASS} /> },
  timeline: { view: "timeline", label: "Timeline", icon: <Clock className={ICON_CLASS} /> },
  map: { view: "map", label: "Map", icon: <Map className={ICON_CLASS} /> },
  explorer: { view: "explorer", label: "Explorer", icon: <Combine className={ICON_CLASS} /> },
  lineage: { view: "lineage", label: "Lineage", icon: <GitBranch className={ICON_CLASS} /> },
  contribute: { view: "contribute", label: "Contribute", icon: <BarChart3 className={ICON_CLASS} /> },
};

function buildRec(view: ViewMode, reason: string): Recommendation {
  return { ...ALL_RECOMMENDATIONS[view], reason };
}

const PANEL_RECOMMENDATIONS: Record<PanelType, Recommendation[]> = {
  "language-detail": [
    buildRec("map", "See geographic distribution"),
    buildRec("tree", "View family relationships"),
    buildRec("timeline", "Explore historical evolution"),
    buildRec("network", "Find related languages"),
  ],
  phonology: [
    buildRec("network", "Compare phoneme inventories"),
    buildRec("tree", "See family phonological patterns"),
    buildRec("map", "View areal phonological features"),
  ],
  grammar: [
    buildRec("network", "Cluster by typological features"),
    buildRec("map", "Map grammatical features"),
    buildRec("tree", "Compare within families"),
  ],
  "writing-systems": [
    buildRec("map", "Map script distributions"),
    buildRec("timeline", "Trace script evolution"),
    buildRec("lineage", "View script derivation chains"),
  ],
  "verb-paradigms": [
    buildRec("network", "Compare conjugation complexity"),
    buildRec("tree", "Family paradigm patterns"),
    buildRec("map", "Regional verb morphology"),
  ],
  "language-contacts": [
    buildRec("network", "Visualize contact networks"),
    buildRec("map", "See geographic contact zones"),
    buildRec("timeline", "Contact events over time"),
  ],
  "sound-changes": [
    buildRec("timeline", "Sound change chronology"),
    buildRec("tree", "Trace changes through families"),
    buildRec("network", "Shared sound change patterns"),
  ],
  correlation: [
    buildRec("explorer", "Deep cross-domain analysis"),
    buildRec("network", "Entity relationship graph"),
    buildRec("map", "Geographic correlation patterns"),
  ],
  "art-traditions": [
    buildRec("timeline", "Art tradition timelines"),
    buildRec("map", "Geographic spread of styles"),
    buildRec("lineage", "Style influence chains"),
  ],
  "literary-traditions": [
    buildRec("timeline", "Literary period timelines"),
    buildRec("map", "Centers of literary production"),
    buildRec("lineage", "Literary influence paths"),
  ],
  "archaeological-cultures": [
    buildRec("timeline", "Culture chronology"),
    buildRec("map", "Archaeological site locations"),
    buildRec("lineage", "Cultural succession chains"),
  ],
  "trade-goods": [
    buildRec("map", "Trade route geography"),
    buildRec("timeline", "Trade good emergence"),
    buildRec("network", "Trade relationship networks"),
  ],
  "word-comparison": [
    buildRec("network", "Cognate relationship graph"),
    buildRec("tree", "Word heritage through families"),
    buildRec("map", "Loanword geographic spread"),
  ],
  "linguistic-distance": [
    buildRec("network", "Distance-based clustering"),
    buildRec("tree", "Phylogenetic grouping"),
    buildRec("map", "Geographic distance overlay"),
  ],
};

interface VisualizationRecommendationsProps {
  panelType: PanelType;
  onClose?: () => void;
}

export default function VisualizationRecommendations({
  panelType,
  onClose,
}: VisualizationRecommendationsProps) {
  const { setView, state } = useVisualization();
  const recommendations = PANEL_RECOMMENDATIONS[panelType];

  const handleClick = (view: ViewMode) => {
    setView(view);
    onClose?.();
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        Suggested Visualizations
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {recommendations.map((rec) => (
          <button
            key={rec.view}
            onClick={() => handleClick(rec.view)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors
              ${
                state.currentView === rec.view
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
              }`}
            title={rec.reason}
            data-testid={`viz-rec-${rec.view}`}
          >
            {rec.icon}
            {rec.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
        Click to switch visualization view
      </p>
    </div>
  );
}

export type { PanelType };
