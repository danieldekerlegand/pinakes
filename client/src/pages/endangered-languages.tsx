/**
 * Endangered-language dashboard & field-research workflow (US-010).
 *
 * A preservation-status dashboard driven by the corpus `status` field (normalized
 * server-side onto a UNESCO-style vitality scale): coarse living/endangered/extinct
 * counts, an endangerment rate, speakers-at-risk, a per-region breakdown, and a
 * most-endangered watchlist. Below it, a **field-research update** form lets a named,
 * sourced researcher submit a structured status/speaker update for one language — it
 * rides the existing contribution review pipeline (never a live write) and is recorded
 * in the versioned changelog. Data comes from `GET /api/languages/preservation`; updates
 * post to `POST /api/languages/field-update`.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, HeartPulse, Loader2, ShieldAlert, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type PreservationCategory = "living" | "endangered" | "extinct" | "unknown";

interface VitalityBucket {
  key: string;
  label: string;
  category: PreservationCategory;
  count: number;
  share: number;
}
interface RegionPreservation {
  region: string;
  total: number;
  living: number;
  endangered: number;
  extinct: number;
  unknown: number;
  endangermentRate: number;
}
interface WatchlistEntry {
  id: string;
  name: string;
  region: string | null;
  vitalityKey: string;
  vitalityLabel: string;
  category: PreservationCategory;
  totalSpeakers: number | null;
}
interface PreservationMetrics {
  total: number;
  classified: number;
  byCategory: Record<PreservationCategory, number>;
  vitality: VitalityBucket[];
  endangermentRate: number;
  speakersAtRisk: number;
  regions: RegionPreservation[];
  watchlist: WatchlistEntry[];
  note: string;
}

/** Canonical vitality options for the field-update status picker (mirrors the server). */
const STATUS_OPTIONS = [
  "living",
  "revitalizing",
  "vulnerable",
  "endangered",
  "definitely endangered",
  "severely endangered",
  "critically endangered",
  "moribund",
  "dormant",
  "extinct",
];

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

const CATEGORY_TONE: Record<PreservationCategory, string> = {
  living: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  endangered: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  extinct: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  unknown: "bg-muted text-muted-foreground",
};

const CATEGORY_BAR: Record<PreservationCategory, string> = {
  living: "bg-emerald-500",
  endangered: "bg-amber-500",
  extinct: "bg-rose-500",
  unknown: "bg-muted-foreground/40",
};

export default function EndangeredLanguagesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<PreservationMetrics>({
    queryKey: ["/api/languages/preservation"],
  });

  // ---- Field-research update form state ----
  const [form, setForm] = useState({
    languageId: "",
    languageName: "",
    researcherName: "",
    status: "",
    totalSpeakers: "",
    notes: "",
    sourceTitle: "",
    sourceUrl: "",
  });
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function prefillFrom(entry: WatchlistEntry) {
    setForm((f) => ({ ...f, languageId: entry.id, languageName: entry.name, status: "" }));
    toast({ title: `Selected ${entry.name}`, description: "Fill in your field observation below." });
  }

  async function submitFieldUpdate() {
    if (!form.languageId.trim() || !form.researcherName.trim() || !form.sourceTitle.trim()) {
      toast({
        title: "Missing required fields",
        description: "A language id, your name, and a source are all required.",
        variant: "destructive",
      });
      return;
    }
    if (!form.status.trim() && !form.totalSpeakers.trim()) {
      toast({
        title: "Nothing to update",
        description: "Provide a new status and/or a speaker count.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        languageId: form.languageId.trim(),
        languageName: form.languageName.trim() || undefined,
        researcherName: form.researcherName.trim(),
        notes: form.notes.trim() || undefined,
        sources: [{ title: form.sourceTitle.trim(), url: form.sourceUrl.trim() || undefined }],
      };
      if (form.status.trim()) payload.status = form.status.trim();
      if (form.totalSpeakers.trim()) payload.totalSpeakers = Number(form.totalSpeakers);

      const res = await apiRequest("POST", "/api/languages/field-update", payload);
      const body = await res.json();
      toast({
        title: "Field update submitted",
        description: `Queued for review (contribution ${body.contribution?.id}) and logged to the changelog.`,
      });
      setForm((f) => ({ ...f, status: "", totalSpeakers: "", notes: "", sourceTitle: "", sourceUrl: "" }));
      void queryClient.invalidateQueries({ queryKey: ["/api/languages/preservation"] });
    } catch (error) {
      toast({
        title: "Could not submit update",
        description: error instanceof Error ? error.message : "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="endangered-languages-page">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldAlert className="h-6 w-6 text-amber-500" /> Endangered-Language Dashboard
        </h1>
        <p className="text-muted-foreground">
          Preservation status across the corpus, plus a field-research workflow so the dataset reflects living
          linguistic reality. Status updates are attributed, sourced, queued for review, and versioned in the
          changelog.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="preservation-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preservation metrics…
        </div>
      )}
      {isError && (
        <Card className="border-rose-500/40">
          <CardContent className="py-4 text-sm text-rose-700 dark:text-rose-300">
            Failed to load preservation metrics.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="preservation-summary">
            <SummaryCard label="Languages" value={data.total.toLocaleString()} tone="bg-muted text-foreground" />
            <SummaryCard
              label="Living"
              value={data.byCategory.living.toLocaleString()}
              tone={CATEGORY_TONE.living}
            />
            <SummaryCard
              label="Endangered"
              value={data.byCategory.endangered.toLocaleString()}
              tone={CATEGORY_TONE.endangered}
            />
            <SummaryCard
              label="Extinct"
              value={data.byCategory.extinct.toLocaleString()}
              tone={CATEGORY_TONE.extinct}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold">{pct(data.endangermentRate)}</p>
                  <p className="text-sm text-muted-foreground">
                    of still-spoken languages are endangered
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{data.speakersAtRisk.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">speakers in endangered languages</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Vitality breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vitality breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.vitality.map((v) => (
                <div key={v.key} className="flex items-center gap-3 text-sm" data-testid={`vitality-${v.key}`}>
                  <span className="w-44 shrink-0 text-muted-foreground">{v.label}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${CATEGORY_BAR[v.category]}`}
                      style={{ width: `${Math.max(2, v.share * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums">{v.count.toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Regional preservation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regional preservation (most at-risk first)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.regions.slice(0, 12).map((r) => (
                <div
                  key={r.region}
                  className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                  data-testid={`region-${r.region}`}
                >
                  <span className="truncate font-medium">{r.region}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{r.total} langs</span>
                    <Badge className={CATEGORY_TONE.endangered}>{pct(r.endangermentRate)} at risk</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Watchlist */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HeartPulse className="h-4 w-4 text-rose-500" /> Preservation watchlist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.watchlist.length === 0 && (
                <p className="text-sm text-muted-foreground">No endangered languages in the corpus.</p>
              )}
              {data.watchlist.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                  data-testid={`watchlist-${w.id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{w.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {w.region ?? "—"}
                      {w.totalSpeakers !== null && ` · ${w.totalSpeakers.toLocaleString()} speakers`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={CATEGORY_TONE.endangered}>{w.vitalityLabel}</Badge>
                    <Button size="sm" variant="outline" onClick={() => prefillFrom(w)} data-testid={`select-${w.id}`}>
                      Update
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{data.note}</p>
        </>
      )}

      {/* Field-research update form */}
      <Card className="border-primary/30" data-testid="field-update-form">
        <CardHeader>
          <CardTitle className="text-base">Submit a field-research update</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Structured, attributed edits from researchers. Your update is queued for review (never written
            directly) and recorded in the versioned changelog.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Language id *">
              <Input
                value={form.languageId}
                onChange={(e) => set("languageId", e.target.value)}
                placeholder="e.g. welsh"
                data-testid="input-languageId"
              />
            </Field>
            <Field label="Your name * (attribution)">
              <Input
                value={form.researcherName}
                onChange={(e) => set("researcherName", e.target.value)}
                placeholder="Dr. Jane Smith"
                data-testid="input-researcherName"
              />
            </Field>
            <Field label="New status">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                data-testid="select-status"
              >
                <option value="">(unchanged)</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Total speakers">
              <Input
                type="number"
                min={0}
                value={form.totalSpeakers}
                onChange={(e) => set("totalSpeakers", e.target.value)}
                placeholder="e.g. 900"
                data-testid="input-totalSpeakers"
              />
            </Field>
            <Field label="Source title *">
              <Input
                value={form.sourceTitle}
                onChange={(e) => set("sourceTitle", e.target.value)}
                placeholder="2026 field survey"
                data-testid="input-sourceTitle"
              />
            </Field>
            <Field label="Source URL">
              <Input
                value={form.sourceUrl}
                onChange={(e) => set("sourceUrl", e.target.value)}
                placeholder="https://…"
                data-testid="input-sourceUrl"
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Field observations, methodology, caveats…"
              data-testid="input-notes"
            />
          </Field>
          <Button onClick={submitFieldUpdate} disabled={submitting} data-testid="submit-field-update">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit for review
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 inline-block rounded px-2 py-0.5 text-xl font-bold ${tone}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
