import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVisualization } from "@/contexts/VisualizationContext";
import {
  ADAPTERS,
  VISUALIZATIONS,
  getAdapter,
  getVisualization,
} from "@/lib/visualization/adapters/registry";
import { compatibleVisualizations } from "@/lib/visualization/adapters/compatibility";
import type { DetailDescriptor } from "@/lib/visualization/adapters/types";
import { ProvenanceList } from "@/components/graph/Provenance";
import { DatasetVisualizationPicker } from "./DatasetVisualizationPicker";

// URL params owned by the explorer. Namespaced ("ds", "viz", "dsq", "f.<key>")
// so they don't collide with the dashboard-level shareable state.
const EXPLORER_URL_KEYS = ["ds", "viz", "dsq"] as const;
const FACET_PREFIX = "f.";

function readExplorerUrlState(): {
  adapterId?: string;
  vizId?: string;
  searchQuery?: string;
  facetFilters: Record<string, string>;
} {
  if (typeof window === "undefined") return { facetFilters: {} };
  const params = new URLSearchParams(window.location.search);
  const facetFilters: Record<string, string> = {};
  params.forEach((v, k) => {
    if (k.startsWith(FACET_PREFIX) && v) {
      facetFilters[k.slice(FACET_PREFIX.length)] = v;
    }
  });
  return {
    adapterId: params.get("ds") ?? undefined,
    vizId: params.get("viz") ?? undefined,
    searchQuery: params.get("dsq") ?? undefined,
    facetFilters,
  };
}

function writeExplorerUrlState(state: {
  adapterId: string;
  vizId: string;
  searchQuery: string;
  facetFilters: Record<string, string>;
}): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  // Clear our owned keys before writing the new values
  for (const k of EXPLORER_URL_KEYS) params.delete(k);
  for (const k of Array.from(params.keys())) {
    if (k.startsWith(FACET_PREFIX)) params.delete(k);
  }
  params.set("ds", state.adapterId);
  params.set("viz", state.vizId);
  if (state.searchQuery) params.set("dsq", state.searchQuery);
  for (const [k, v] of Object.entries(state.facetFilters)) {
    if (v) params.set(`${FACET_PREFIX}${k}`, v);
  }
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState({}, "", next);
}

function clearExplorerUrlState(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const k of EXPLORER_URL_KEYS) params.delete(k);
  for (const k of Array.from(params.keys())) {
    if (k.startsWith(FACET_PREFIX)) params.delete(k);
  }
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", next);
}

interface SelectedDetail {
  payload: unknown;
  descriptor: DetailDescriptor;
}

interface UnifiedExplorerProps {
  initialAdapterId?: string;
  initialVizId?: string;
  hidePicker?: boolean;
}

export default function UnifiedExplorer({
  initialAdapterId,
  initialVizId,
  hidePicker,
}: UnifiedExplorerProps = {}) {
  // Explicit prop wins, else URL state, else defaults. Read once on mount.
  const initialFromUrl = useRef(readExplorerUrlState()).current;
  const [adapterId, setAdapterId] = useState<string>(
    initialAdapterId ?? initialFromUrl.adapterId ?? ADAPTERS[0]?.id ?? ""
  );
  const [vizId, setVizId] = useState<string>(
    initialVizId ?? initialFromUrl.vizId ?? "timeline"
  );
  const [searchQuery, setSearchQuery] = useState(initialFromUrl.searchQuery ?? "");
  const [facetFilters, setFacetFilters] = useState<Record<string, string>>(
    initialFromUrl.facetFilters
  );
  const [selected, setSelected] = useState<SelectedDetail | null>(null);

  const adapter = getAdapter(adapterId) ?? ADAPTERS[0];
  const compat = useMemo(
    () => compatibleVisualizations(adapter, VISUALIZATIONS),
    [adapter]
  );
  const activeVizId =
    compat.find((v) => v.id === vizId)?.id ?? compat[0]?.id ?? vizId;
  const viz = getVisualization(activeVizId);

  // When the parent passes initialAdapterId/initialVizId as controlled inputs
  // (e.g. dashboard top-level use), sync local state to follow them. We only
  // do this when hidePicker is true — otherwise the picker drives state and
  // re-syncing would fight user clicks.
  useEffect(() => {
    if (hidePicker && initialAdapterId && initialAdapterId !== adapterId) {
      setAdapterId(initialAdapterId);
      setFacetFilters({});
      setSelected(null);
    }
  }, [hidePicker, initialAdapterId]);

  useEffect(() => {
    if (hidePicker && initialVizId && initialVizId !== vizId) {
      setVizId(initialVizId);
    }
  }, [hidePicker, initialVizId]);

  // Sync state → URL (debounced for searchQuery). Only when standalone — when
  // the dashboard owns adapter/viz state at top level, it manages URL itself.
  useEffect(() => {
    if (hidePicker) return;
    const handle = setTimeout(() => {
      writeExplorerUrlState({
        adapterId: adapter.id,
        vizId: activeVizId,
        searchQuery,
        facetFilters,
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [hidePicker, adapter.id, activeVizId, searchQuery, facetFilters]);

  // On unmount (user leaves the explorer section), strip our params so the
  // URL doesn't carry stale dataset state into other dashboard sections.
  useEffect(() => {
    if (hidePicker) return;
    return () => clearExplorerUrlState();
  }, [hidePicker]);

  const { data: rawData, isLoading, error } = useQuery({
    queryKey: [adapter.endpoint],
    queryFn: async () => {
      const res = await fetch(adapter.endpoint);
      if (!res.ok) throw new Error(`Failed to load ${adapter.endpoint}`);
      return res.json();
    },
  });

  // Unfiltered projection — drives facet dropdown options so users can always
  // re-expand a narrowed filter.
  const unfilteredProjection = useMemo(() => {
    if (!rawData) return null;
    const rows = adapter.unwrap(rawData);
    return adapter.project(rows, { searchQuery });
  }, [rawData, adapter, searchQuery]);

  const projections = useMemo(() => {
    if (!rawData) return null;
    const rows = adapter.unwrap(rawData);
    return adapter.project(rows, { searchQuery, facetFilters });
  }, [rawData, adapter, searchQuery, facetFilters]);

  const facetOptions = useMemo(() => {
    if (!unfilteredProjection?.categorical || !adapter.filterableFacets) return {};
    const out: Record<string, string[]> = {};
    for (const facet of adapter.filterableFacets) {
      const values = new Set<string>();
      for (const row of unfilteredProjection.categorical) {
        const v = row.facets[facet.key];
        if (typeof v === "string" && v) values.add(v);
      }
      out[facet.key] = Array.from(values).sort();
    }
    return out;
  }, [unfilteredProjection, adapter.filterableFacets]);

  const { state } = useVisualization();

  const handleSelect = (_id: string, payload: unknown) => {
    if (!adapter.detail) {
      setSelected({
        payload,
        descriptor: {
          title: String(_id),
          fields: [],
        },
      });
      return;
    }
    setSelected({ payload, descriptor: adapter.detail(payload) });
  };

  const handlePickerSelect = (newAdapterId: string, newVizId: string) => {
    setAdapterId(newAdapterId);
    setVizId(newVizId);
    setFacetFilters({});
    setSelected(null);
  };

  const handleFacetChange = (key: string, value: string) => {
    setFacetFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };

  const Component = viz?.Component;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {!hidePicker && (
        <DatasetVisualizationPicker
          adapters={ADAPTERS}
          visualizations={VISUALIZATIONS}
          selectedAdapterId={adapter.id}
          selectedVisualizationId={activeVizId}
          onSelect={handlePickerSelect}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
        <input
          type="text"
          placeholder={`Search ${adapter.name.toLowerCase()}…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[160px] max-w-sm px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {(adapter.filterableFacets ?? []).map((facet) => {
          const options = facetOptions[facet.key] ?? [];
          if (options.length === 0) return null;
          return (
            <select
              key={facet.key}
              value={facetFilters[facet.key] ?? ""}
              onChange={(e) => handleFacetChange(facet.key, e.target.value)}
              className="px-2 py-1 text-xs border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All {facet.label.toLowerCase()}</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          );
        })}
        {Object.keys(facetFilters).length > 0 && (
          <button
            type="button"
            onClick={() => setFacetFilters({})}
            className="text-[10px] text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
        {projections && (
          <span className="ml-auto text-[10px] text-gray-500">
            {(projections.categorical?.length ?? 0)} items
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          {isLoading && (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-gray-500">
              Loading {adapter.name}…
            </div>
          )}
          {error && (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-red-600">
              Failed to load: {(error as Error).message}
            </div>
          )}
          {!isLoading && !error && projections && Component && (
            <Suspense
              fallback={
                <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-gray-500">
                  Loading visualization…
                </div>
              }
            >
              <Component
                projections={projections}
                state={state}
                searchQuery={searchQuery}
                onSelect={handleSelect}
              />
            </Suspense>
          )}
        </div>

        {selected && (
          <aside className="w-80 flex-shrink-0 border-l border-gray-200 bg-white overflow-auto">
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {selected.descriptor.title}
                  </h3>
                  {selected.descriptor.subtitle && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {selected.descriptor.subtitle}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-400 hover:text-gray-600 text-xs"
                  aria-label="Close detail"
                >
                  ✕
                </button>
              </div>
              <dl className="mt-4 space-y-3">
                {selected.descriptor.fields.map((f, i) => (
                  <div key={i}>
                    <dt className="text-[10px] uppercase tracking-wider text-gray-400">
                      {f.label}
                    </dt>
                    <dd className="text-xs text-gray-700 mt-0.5">
                      {Array.isArray(f.value)
                        ? f.value.join(", ")
                        : f.value === null || f.value === ""
                        ? "—"
                        : String(f.value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.descriptor.provenance && (
                <ProvenanceList
                  provenance={selected.descriptor.provenance}
                  className="mt-4"
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
