import { cn } from "@/lib/utils";
import {
  isCompatible,
  missingDimensions,
} from "@/lib/visualization/adapters/compatibility";
import type {
  DatasetAdapter,
  Dimension,
  VisualizationDescriptor,
} from "@/lib/visualization/adapters/types";

interface DatasetVisualizationPickerProps {
  adapters: DatasetAdapter[];
  visualizations: VisualizationDescriptor[];
  selectedAdapterId: string;
  selectedVisualizationId: string;
  onSelect: (adapterId: string, visualizationId: string) => void;
}

const DIM_LABEL: Record<Dimension, string> = {
  temporal: "Time",
  spatial: "Place",
  relational: "Network",
  hierarchical: "Hierarchy",
  categorical: "Facets",
};

export function DatasetVisualizationPicker({
  adapters,
  visualizations,
  selectedAdapterId,
  selectedVisualizationId,
  onSelect,
}: DatasetVisualizationPickerProps) {
  const adaptersByCategory = new Map<string, DatasetAdapter[]>();
  for (const a of adapters) {
    const list = adaptersByCategory.get(a.category);
    if (list) list.push(a);
    else adaptersByCategory.set(a.category, [a]);
  }

  const selectedAdapter =
    adapters.find((a) => a.id === selectedAdapterId) ?? adapters[0];

  return (
    <div className="grid grid-cols-[260px_1fr] gap-0 border-b border-gray-200 bg-white">
      {/* Dataset column */}
      <div className="border-r border-gray-200 bg-gray-50/50">
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Dataset
        </div>
        <div className="px-2 pb-2 space-y-2">
          {Array.from(adaptersByCategory.entries()).map(([category, list]) => (
            <div key={category}>
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                {category}
              </div>
              <div className="flex flex-col gap-0.5">
                {list.map((a) => {
                  const active = a.id === selectedAdapter.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onSelect(a.id, selectedVisualizationId)}
                      aria-pressed={active}
                      className={cn(
                        "px-2 py-1.5 rounded-md text-left text-xs transition-colors",
                        active
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-gray-700 hover:bg-gray-100"
                      )}
                    >
                      <div>{a.name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {a.dimensions.map((d) => (
                          <span
                            key={d}
                            className="inline-flex items-center bg-gray-200 text-gray-600 text-[9px] px-1 py-0.5 rounded"
                          >
                            {DIM_LABEL[d]}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Visualization column */}
      <div>
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Visualization
        </div>
        <div className="px-2 pb-2 flex flex-wrap gap-2">
          {visualizations.map((viz) => {
            const compat = isCompatible(selectedAdapter, viz);
            const active = compat && viz.id === selectedVisualizationId;
            const missing = missingDimensions(selectedAdapter, viz);
            return (
              <button
                key={viz.id}
                type="button"
                disabled={!compat}
                onClick={() => onSelect(selectedAdapter.id, viz.id)}
                title={
                  compat
                    ? `Render ${selectedAdapter.name} as a ${viz.label.toLowerCase()}`
                    : `Needs: ${missing.map((d) => DIM_LABEL[d]).join(", ")}`
                }
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs border transition-colors",
                  active
                    ? "bg-blue-600 text-white border-blue-600"
                    : compat
                    ? "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    : "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed line-through"
                )}
              >
                {viz.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
