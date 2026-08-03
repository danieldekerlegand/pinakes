import { lazy } from "react";
import type { DatasetAdapter, VisualizationDescriptor } from "./types";
import { artTraditionsAdapter } from "./art-traditions.adapter";
import { tradeGoodsAdapter } from "./trade-goods.adapter";
import { languageFamiliesAdapter } from "./language-families.adapter";
import { culturalLineagesAdapter } from "./cultural-lineages.adapter";
import { religionsAdapter } from "./religions.adapter";
import { deitiesAdapter } from "./deities.adapter";
import { mythMotifsAdapter } from "./myth-motifs.adapter";
import { literaryTraditionsAdapter } from "./literary-traditions.adapter";
import { archaeologicalCulturesAdapter } from "./archaeological-cultures.adapter";
import { civilizationsAdapter } from "./civilizations.adapter";
import { battlesAdapter } from "./battles.adapter";
import { soundChangesAdapter } from "./sound-changes.adapter";
import { languageContactsAdapter } from "./language-contacts.adapter";
import { culturescrapeAdapter } from "./culturescrape.adapter";

export const ADAPTERS: DatasetAdapter[] = [
  languageFamiliesAdapter as DatasetAdapter,
  soundChangesAdapter as DatasetAdapter,
  languageContactsAdapter as DatasetAdapter,
  culturalLineagesAdapter as DatasetAdapter,
  archaeologicalCulturesAdapter as DatasetAdapter,
  civilizationsAdapter as DatasetAdapter,
  artTraditionsAdapter as DatasetAdapter,
  literaryTraditionsAdapter as DatasetAdapter,
  religionsAdapter as DatasetAdapter,
  deitiesAdapter as DatasetAdapter,
  mythMotifsAdapter as DatasetAdapter,
  battlesAdapter as DatasetAdapter,
  tradeGoodsAdapter as DatasetAdapter,
  culturescrapeAdapter as DatasetAdapter,
];

export function getAdapter(id: string): DatasetAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

export const VISUALIZATIONS: VisualizationDescriptor[] = [
  {
    id: "tree",
    label: "Tree",
    required: ["hierarchical"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericTree")),
  },
  {
    id: "timeline",
    label: "Timeline",
    required: ["temporal"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericTimeline")),
  },
  {
    id: "map",
    label: "Map",
    required: ["spatial"],
    optional: ["temporal"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericMap")),
  },
  {
    id: "map-3d",
    label: "3D Map",
    required: ["spatial"],
    optional: ["temporal"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericMap3D")),
  },
  {
    id: "network",
    label: "Network",
    required: ["relational"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericNetwork")),
  },
  {
    id: "lineage",
    label: "Lineage",
    required: ["hierarchical", "relational"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericLineage")),
  },
  {
    id: "explorer",
    label: "Table",
    required: ["categorical"],
    Component: lazy(() => import("@/components/explorer/visualizations/GenericExplorer")),
  },
];

export function getVisualization(id: string): VisualizationDescriptor | undefined {
  return VISUALIZATIONS.find((v) => v.id === id);
}
