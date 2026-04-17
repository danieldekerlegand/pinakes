import { useEffect, useMemo } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { CultureProfile } from "@shared/types";
import {
  buildCultureProfileReportHtml,
  REPORT_CSS,
} from "@/lib/culture-profile-report";

interface EntityMedia {
  assets?: Array<{
    id: string;
    title: string;
    sourceUrl: string;
    license?: string;
    attribution?: string;
    primary?: boolean;
  }>;
}

export default function CultureProfileReportPage() {
  const [, params] = useRoute("/culture-profile/:id/report");
  const cultureId = params?.id;

  const { data: profile, isLoading, isError } = useQuery<CultureProfile>({
    queryKey: ["/api/culture-profiles", cultureId],
    enabled: !!cultureId,
    queryFn: async () => {
      const res = await fetch(`/api/culture-profiles/${cultureId}`);
      if (!res.ok) throw new Error("Failed to load culture profile");
      return res.json();
    },
  });

  const { data: mediaResponse } = useQuery<EntityMedia>({
    queryKey: ["/api/media-assets/entity/culture_profile", cultureId],
    enabled: !!cultureId,
    queryFn: async () => {
      const res = await fetch(
        `/api/media-assets/entity/culture_profile/${cultureId}`,
      );
      if (!res.ok) return { assets: [] };
      return res.json();
    },
  });

  const reportHtml = useMemo(() => {
    if (!profile) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return buildCultureProfileReportHtml({
      profile,
      media: mediaResponse?.assets,
      shareUrl: `${origin}/culture-profile/${profile.id}/report`,
    });
  }, [profile, mediaResponse]);

  useEffect(() => {
    if (profile) {
      document.title = `${profile.name} \u2014 Culture Profile Report`;
    }
  }, [profile]);

  if (!cultureId) {
    return (
      <div className="p-8 text-center text-gray-600">
        Missing culture profile ID in URL.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-600" data-testid="report-loading">
        Loading culture profile report...
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="p-8 text-center text-red-600" data-testid="report-error">
        Unable to load this culture profile report.
      </div>
    );
  }

  return (
    <>
      <style>{REPORT_CSS}</style>
      <div
        data-testid="culture-profile-report"
        dangerouslySetInnerHTML={{
          __html: extractReportBody(reportHtml),
        }}
      />
    </>
  );
}

function extractReportBody(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}
