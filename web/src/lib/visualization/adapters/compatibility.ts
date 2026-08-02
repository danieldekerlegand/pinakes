import type {
  DatasetAdapter,
  Dimension,
  VisualizationDescriptor,
} from "./types";

export function isCompatible(
  adapter: DatasetAdapter,
  viz: VisualizationDescriptor
): boolean {
  return viz.required.every((dim) => adapter.dimensions.includes(dim));
}

export function compatibleVisualizations(
  adapter: DatasetAdapter,
  all: VisualizationDescriptor[]
): VisualizationDescriptor[] {
  return all.filter((viz) => isCompatible(adapter, viz));
}

export function compatibleAdapters(
  viz: VisualizationDescriptor,
  all: DatasetAdapter[]
): DatasetAdapter[] {
  return all.filter((adapter) => isCompatible(adapter, viz));
}

export function missingDimensions(
  adapter: DatasetAdapter,
  viz: VisualizationDescriptor
): Dimension[] {
  return viz.required.filter((dim) => !adapter.dimensions.includes(dim));
}
