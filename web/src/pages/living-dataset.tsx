/**
 * Living-dataset dashboard (US-011 — speculative PRD).
 *
 * Surfaces the corpus's freshness + versioning lifecycle in one place, building on
 * `data-freshness.ts`:
 *   - **Current release**: version, DOI, license, row count, and the annual release
 *     cadence (when the next citable snapshot is due). A "Mint release" button posts
 *     to `POST /api/living-dataset/release`.
 *   - **Discovery ingestion**: which acquisition domains are stale and a "Run
 *     ingestion" button that posts to `POST /api/living-dataset/ingest` (culture-scrape
 *     bulk acquisition → contribution review queue, never a live write).
 *   - **Dataset freshness**: per-file staleness from the freshness summary.
 *
 * Data comes from `GET /api/living-dataset/status`.
 */
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, DownloadCloud, Loader2, PackageCheck, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Staleness = "fresh" | "aging" | "stale";

interface DatasetFreshness {
  name: string;
  file: string;
  recordCount: number;
  lastModified: string;
  ageDays: number;
  staleness: Staleness;
}
interface FreshnessSummary {
  datasets: DatasetFreshness[];
  totalDatasets: number;
  totalRecords: number;
  freshCount: number;
  agingCount: number;
  staleCount: number;
}
interface CurrentRelease {
  version: string;
  doi: string | null;
  doiUrl: string | null;
  releaseDate: string | null;
  totalRows: number | null;
  license: string;
  released: boolean;
}
interface ReleaseCadence {
  cadence: string;
  intervalDays: number;
  nextReleaseDate: string | null;
  dueNow: boolean;
  daysUntilDue: number | null;
}
interface IngestionEntry {
  domain: string;
  label: string;
  lastIngested: string | null;
  nextDue: string | null;
  dueNow: boolean;
  daysSinceLastIngest: number | null;
}
interface LivingDatasetStatus {
  generatedAt: string;
  freshness: FreshnessSummary;
  currentRelease: CurrentRelease;
  releaseCadence: ReleaseCadence;
  ingestion: {
    intervalDays: number;
    entries: IngestionEntry[];
    dueDomains: string[];
    dueCount: number;
  };
}

const STALENESS_TONE: Record<Staleness, string> = {
  fresh: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  aging: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  stale: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export default function LivingDatasetPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<null | "ingest" | "release">(null);

  const { data, isLoading, isError } = useQuery<LivingDatasetStatus>({
    queryKey: ["/api/living-dataset/status"],
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["/api/living-dataset/status"] });
  }

  async function runIngestion() {
    setBusy("ingest");
    try {
      const res = await apiRequest("POST", "/api/living-dataset/ingest", {});
      const body = await res.json();
      toast({
        title: "Discovery ingestion complete",
        description:
          body.ran.length === 0
            ? "No domains were due for refresh."
            : `Queued ${body.totalQueued} record(s) for review across ${body.ran.length} domain(s).`,
      });
      refresh();
    } catch (error) {
      toast({
        title: "Ingestion failed",
        description: error instanceof Error ? error.message : "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function mintRelease() {
    setBusy("release");
    try {
      const res = await apiRequest("POST", "/api/living-dataset/release", {});
      const body = await res.json();
      toast({
        title: `Release v${body.release.version} minted`,
        description: body.release.doi
          ? `DOI ${body.release.doi} · ${body.release.totalRows.toLocaleString()} rows.`
          : `${body.release.totalRows.toLocaleString()} rows · DOI minting disabled (no Zenodo token).`,
      });
      refresh();
    } catch (error) {
      toast({
        title: "Could not mint release",
        description: error instanceof Error ? error.message : "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="living-dataset-page">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Database className="h-6 w-6 text-sky-500" /> Living Dataset
        </h1>
        <p className="text-muted-foreground">
          Keeps the corpus current and academically citable: scheduled discovery ingestion of
          newly-published sources (queued for review), an annual versioned-release cadence with
          DOIs, and per-file freshness.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="living-dataset-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading dataset status…
        </div>
      )}
      {isError && (
        <Card className="border-rose-500/40">
          <CardContent className="py-4 text-sm text-rose-700 dark:text-rose-300">
            Failed to load living-dataset status.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Current release + cadence */}
          <Card data-testid="release-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-emerald-500" /> Current Release
              </CardTitle>
              <Button size="sm" onClick={mintRelease} disabled={busy !== null} data-testid="mint-release">
                {busy === "release" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <DownloadCloud className="mr-2 h-4 w-4" />
                )}
                Mint {data.releaseCadence.cadence} release
              </Button>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Field label="Version" value={`v${data.currentRelease.version}`} />
              <Field
                label="DOI"
                value={
                  data.currentRelease.doiUrl ? (
                    <a className="text-sky-600 underline dark:text-sky-400" href={data.currentRelease.doiUrl} target="_blank" rel="noreferrer">
                      {data.currentRelease.doi}
                    </a>
                  ) : (
                    "not minted"
                  )
                }
              />
              <Field label="License" value={data.currentRelease.license} />
              <Field
                label="Rows"
                value={data.currentRelease.totalRows != null ? data.currentRelease.totalRows.toLocaleString() : "—"}
              />
              <Field label="Last released" value={fmtDate(data.currentRelease.releaseDate)} />
              <Field label="Next due" value={fmtDate(data.releaseCadence.nextReleaseDate)} />
              <div className="space-y-1">
                <div className="text-xs uppercase text-muted-foreground">Cadence</div>
                <Badge
                  className={
                    data.releaseCadence.dueNow
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  }
                >
                  {data.releaseCadence.dueNow
                    ? "Release due"
                    : `Due in ${data.releaseCadence.daysUntilDue ?? "?"}d`}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Discovery ingestion schedule */}
          <Card data-testid="ingestion-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-sky-500" /> Discovery Ingestion
              </CardTitle>
              <Button
                size="sm"
                onClick={runIngestion}
                disabled={busy !== null || data.ingestion.dueCount === 0}
                data-testid="run-ingestion"
              >
                {busy === "ingest" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Run ingestion ({data.ingestion.dueCount} due)
              </Button>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Domains unrefreshed for {data.ingestion.intervalDays}+ days are re-acquired via culture-scrape
                and queued for review — nothing enters the live dataset unverified.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-1">Domain</th>
                    <th className="py-1">Last ingested</th>
                    <th className="py-1">Next due</th>
                    <th className="py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ingestion.entries.map((e) => (
                    <tr key={e.domain} className="border-t border-border/50" data-testid={`ingestion-${e.domain}`}>
                      <td className="py-1.5">{e.label}</td>
                      <td className="py-1.5 text-muted-foreground">{fmtDate(e.lastIngested)}</td>
                      <td className="py-1.5 text-muted-foreground">{fmtDate(e.nextDue)}</td>
                      <td className="py-1.5">
                        <Badge
                          className={
                            e.dueNow
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {e.dueNow ? "Due" : "Fresh"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Dataset freshness */}
          <Card data-testid="freshness-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" /> Dataset Freshness
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex gap-2 text-xs">
                <Badge className={STALENESS_TONE.fresh}>{data.freshness.freshCount} fresh</Badge>
                <Badge className={STALENESS_TONE.aging}>{data.freshness.agingCount} aging</Badge>
                <Badge className={STALENESS_TONE.stale}>{data.freshness.staleCount} stale</Badge>
                <span className="text-muted-foreground">
                  {data.freshness.totalRecords.toLocaleString()} records across {data.freshness.totalDatasets} files
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="py-1">Dataset</th>
                      <th className="py-1">Records</th>
                      <th className="py-1">Age (days)</th>
                      <th className="py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.freshness.datasets.map((d) => (
                      <tr key={d.file} className="border-t border-border/50">
                        <td className="py-1.5">{d.name}</td>
                        <td className="py-1.5 text-muted-foreground">{d.recordCount.toLocaleString()}</td>
                        <td className="py-1.5 text-muted-foreground">{Math.round(d.ageDays)}</td>
                        <td className="py-1.5">
                          <Badge className={STALENESS_TONE[d.staleness]}>{d.staleness}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
