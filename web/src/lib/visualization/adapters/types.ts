import type { ComponentType, LazyExoticComponent } from "react";
import type { ViewMode, VisualizationState } from "../types";
import type { Provenance } from "@/lib/graph/provenance";

export type Dimension =
  | "temporal"
  | "spatial"
  | "relational"
  | "hierarchical"
  | "categorical";

export interface TemporalItem {
  id: string;
  label: string;
  startYear: number;
  endYear: number | null;
  isEstimate?: boolean;
  group?: string;
  payload: unknown;
}

export interface SpatialItem {
  id: string;
  label: string;
  lat: number;
  lng: number;
  region?: string;
  countries?: string[];
  magnitude?: number;
  startYear?: number;
  endYear?: number | null;
  payload: unknown;
}

export interface RelationalNode {
  id: string;
  label: string;
  group?: string;
  magnitude?: number;
  payload: unknown;
}

export interface RelationalLink {
  source: string;
  target: string;
  kind: string;
  weight?: number;
  payload?: unknown;
}

export interface RelationalGraph {
  nodes: RelationalNode[];
  links: RelationalLink[];
}

export interface HierarchicalNode {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  payload: unknown;
  children?: HierarchicalNode[];
}

export interface CategoricalRow {
  id: string;
  label: string;
  facets: Record<string, string | number | string[] | null>;
  payload: unknown;
}

export interface DimensionProjections {
  temporal?: TemporalItem[];
  spatial?: SpatialItem[];
  relational?: RelationalGraph;
  hierarchical?: HierarchicalNode[];
  categorical?: CategoricalRow[];
}

export interface ProjectionOptions {
  searchQuery?: string;
  category?: string;
  facetFilters?: Record<string, string>;
  currentYear?: number;
  groupBy?: string;
}

export interface FilterableFacet {
  key: string;
  label: string;
}

export interface DetailDescriptor {
  title: string;
  subtitle?: string;
  fields: Array<{ label: string; value: string | number | string[] | null }>;
  /** Where the entity's facts came from — rendered as a <ProvenanceList> (US-010). */
  provenance?: Provenance;
}

export interface DatasetAdapter<TRaw = unknown> {
  id: string;
  name: string;
  category: string;
  endpoint: string;
  unwrap: (apiResponse: unknown) => TRaw[];
  dimensions: ReadonlyArray<Dimension>;
  project: (rows: TRaw[], opts: ProjectionOptions) => DimensionProjections;
  detail?: (row: TRaw) => DetailDescriptor;
  filterableFacets?: ReadonlyArray<FilterableFacet>;
}

export interface VisualizationProps {
  projections: DimensionProjections;
  state: VisualizationState;
  searchQuery?: string;
  onSelect?: (id: string, payload: unknown) => void;
}

export interface VisualizationDescriptor {
  id: ViewMode;
  label: string;
  required: ReadonlyArray<Dimension>;
  optional?: ReadonlyArray<Dimension>;
  Component: LazyExoticComponent<ComponentType<VisualizationProps>>;
}
