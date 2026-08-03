import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import SiteReconstruction3DViewer, {
  Site3DReconstruction,
} from "@/components/visualizations/SiteReconstruction3DViewer";
import {
  RawSiteFeature,
  filterSitesForCulture,
  rankSites,
  toReconstruction,
} from "./architecture-3d-reconstruction-utils";

interface RawSiteCollection {
  type: "FeatureCollection";
  features: RawSiteFeature[];
}

export interface Architecture3DReconstructionProps {
  /** Language IDs to match against archaeological sites */
  languageIds?: string[];
  /** Culture profile's notable settlements (matches site name) */
  notableSettlements?: string[];
  /** Culture profile's time period, used to filter sites by overlap */
  timePeriodStart?: number;
  timePeriodEnd?: number;
  /** Civilization / culture name, shown in header */
  civilizationName?: string;
}

const MAX_SITES = 6;

export default function Architecture3DReconstructionSection({
  languageIds,
  notableSettlements,
  timePeriodStart,
  timePeriodEnd,
  civilizationName,
}: Architecture3DReconstructionProps) {
  const { data, isLoading, isError } = useQuery<RawSiteCollection>({
    queryKey: ["/api/map/archaeological-sites"],
    queryFn: async () => {
      const res = await fetch("/api/map/archaeological-sites");
      if (!res.ok) return { type: "FeatureCollection", features: [] };
      return res.json();
    },
  });

  const reconstructions = useMemo<Site3DReconstruction[]>(() => {
    const features = data?.features ?? [];
    const matched = filterSitesForCulture(features, {
      languageIds,
      notableSettlements,
      timePeriodStart,
      timePeriodEnd,
    });
    return rankSites(matched).slice(0, MAX_SITES).map(toReconstruction);
  }, [data, languageIds, notableSettlements, timePeriodStart, timePeriodEnd]);

  return (
    <div className="space-y-4" data-testid="architecture-3d-reconstruction-section">
      <div className="flex items-center space-x-2">
        <Building2 className="h-5 w-5 text-amber-600" />
        <h3 className="text-base font-semibold text-gray-900">
          3D Reconstruction
          {civilizationName ? ` · ${civilizationName}` : ""}
        </h3>
      </div>

      {isLoading && (
        <div className="p-4 text-center text-sm text-gray-500">
          Loading archaeological sites…
        </div>
      )}

      {!isLoading && (isError || reconstructions.length === 0) && (
        <div className="p-4 text-center text-sm text-gray-500 border border-dashed border-gray-200 rounded">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p>No 3D-reconstructible archaeological sites available for this culture.</p>
        </div>
      )}

      {!isLoading && reconstructions.length > 0 && (
        <>
          <p className="text-xs text-gray-500">
            Interactive isometric reconstructions generated from each site's
            excavation findings. Use rotate and zoom to inspect the massing of
            walls, towers, platforms, and other structures.
          </p>
          <SiteReconstruction3DViewer sites={reconstructions} />
        </>
      )}
    </div>
  );
}
