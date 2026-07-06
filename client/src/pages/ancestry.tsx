/**
 * DNA-to-culture ancestry mapper (US-001).
 *
 * Upload a 23andMe / AncestryDNA raw-data export and see the languages, cultures, and
 * cuisines your deep paternal (Y-DNA) ancestry is associated with. **All DNA parsing +
 * haplogroup inference happens in your browser** (`@/lib/dna`); only the resulting,
 * non-identifying haplogroup ids are sent to the server for enrichment — the raw
 * genotype file is never uploaded or stored. Results always carry clear caveats.
 */
import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Dna, Loader2, ShieldCheck, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseDnaFile, inferHaplogroups, type InferredHaplogroup } from "@/lib/dna";

interface LanguageResult {
  familyId: string;
  familyName: string;
  region: string | null;
  confidence: number;
  sampleLanguages: string[];
  viaHaplogroups: string[];
}
interface CultureResult {
  civilizationId: string;
  name: string;
  confidence: number;
  viaHaplogroups: string[];
}
interface CuisineResult {
  cuisineId: string;
  name: string;
  region: string;
  confidence: number;
}
interface AncestryMappingResult {
  matchedHaplogroups: { id: string; name: string; geographicOrigin: string; timeOrigin: number | null }[];
  unmatchedHaplogroupIds: string[];
  spoke: LanguageResult[];
  livedAmong: CultureResult[];
  ate: CuisineResult[];
  divergences: { haplogroupName: string; languageFamilyName: string; annotation: string }[];
  caveats: string[];
  summary: string;
}

function pct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

function confidenceTone(c: number): string {
  if (c >= 0.7) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (c >= 0.45) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

export default function AncestryPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inferred, setInferred] = useState<InferredHaplogroup | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; format: string; snps: number } | null>(null);
  const [result, setResult] = useState<AncestryMappingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [noYData, setNoYData] = useState(false);

  async function handleFile(file: File) {
    setLoading(true);
    setResult(null);
    setInferred(null);
    setNoYData(false);
    try {
      const text = await file.text();
      // ---- Everything below happens in-browser; nothing is uploaded. ----
      const parsed = parseDnaFile(text);
      const inference = inferHaplogroups(parsed);
      setFileMeta({ name: file.name, format: parsed.format, snps: parsed.counts.total });

      if (!inference.hasYData) {
        setNoYData(true);
        toast({
          title: "No Y-chromosome data found",
          description:
            "This reference dataset covers paternal (Y-DNA) haplogroups; your file has no Y-chromosome calls (this is expected for many profiles).",
        });
        return;
      }
      if (!inference.yHaplogroup) {
        toast({
          title: "Could not assign a haplogroup",
          description: "Your Y-chromosome markers did not match any known defining SNPs in our simplified model.",
          variant: "destructive",
        });
        return;
      }

      setInferred(inference.yHaplogroup);
      // Only the haplogroup id (public, non-identifying) is sent to the server.
      const res = await apiRequest("POST", "/api/ancestry/map", {
        haplogroupIds: [inference.yHaplogroup.haplogroupId],
      });
      setResult((await res.json()) as AncestryMappingResult);
    } catch (error) {
      toast({
        title: "Could not read this file",
        description: error instanceof Error ? error.message : "Unexpected error parsing the DNA export.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6" data-testid="ancestry-page">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Dna className="h-6 w-6 text-primary" /> DNA-to-Culture Ancestry Mapper
        </h1>
        <p className="text-muted-foreground">
          Upload your 23andMe or AncestryDNA raw-data file to explore the languages, cultures, and cuisines
          your deep paternal ancestry is associated with.
        </p>
      </header>

      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p>
            <strong>Your data stays private.</strong> Your raw DNA file is parsed entirely in your browser.
            Only a non-identifying haplogroup label (for example <code>R1b</code>) is sent to the server —
            your genetic file is never uploaded or stored.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.tsv,text/plain"
            className="hidden"
            data-testid="ancestry-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <div
            className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center hover:border-primary/50"
            onClick={() => fileInputRef.current?.click()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            onDragOver={(e) => e.preventDefault()}
            data-testid="ancestry-dropzone"
          >
            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <Upload className="h-8 w-8 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium">Drop your raw-DNA file here, or click to browse</p>
              <p className="text-sm text-muted-foreground">Supports 23andMe and AncestryDNA exports (.txt)</p>
            </div>
          </div>
          {fileMeta && (
            <p className="mt-3 text-sm text-muted-foreground" data-testid="ancestry-file-meta">
              Parsed <strong>{fileMeta.name}</strong> — detected format{" "}
              <Badge variant="secondary">{fileMeta.format}</Badge> · {fileMeta.snps.toLocaleString()} SNPs read
              in-browser.
            </p>
          )}
        </CardContent>
      </Card>

      {noYData && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p>
              No Y-chromosome data was found in this file. This reference dataset currently maps
              <strong> paternal (Y-DNA) </strong> haplogroups only, so no ancestry could be inferred. This is
              expected for many profiles (for example, if the profile has no Y chromosome).
            </p>
          </CardContent>
        </Card>
      )}

      {inferred && (
        <Card data-testid="ancestry-haplogroup">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Inferred Y-DNA haplogroup: <span className="text-primary">{inferred.label}</span>
              <Badge className={confidenceTone(inferred.confidence)}>{pct(inferred.confidence)} confidence</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {inferred.derivedMarkers.length > 0 ? (
              <p>Supported by derived markers: {inferred.derivedMarkers.join(", ")}.</p>
            ) : (
              <p>Assigned from a single defining marker — treat this as a low-confidence estimate.</p>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4" data-testid="ancestry-results">
          <p className="text-lg font-medium">Your ancestors likely…</p>

          <ResultSection title="…spoke" empty="No language families associated.">
            {result.spoke.map((s) => (
              <div key={s.familyId} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{s.familyName}</p>
                  {s.region && <p className="text-xs text-muted-foreground">{s.region}</p>}
                  {s.sampleLanguages.length > 0 && (
                    <p className="text-xs text-muted-foreground">e.g. {s.sampleLanguages.join(", ")}</p>
                  )}
                </div>
                <Badge className={confidenceTone(s.confidence)}>{pct(s.confidence)}</Badge>
              </div>
            ))}
          </ResultSection>

          <ResultSection title="…lived among" empty="No historical cultures associated.">
            {result.livedAmong.map((c) => (
              <div key={c.civilizationId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <p className="font-medium">{c.name}</p>
                <Badge className={confidenceTone(c.confidence)}>{pct(c.confidence)}</Badge>
              </div>
            ))}
          </ResultSection>

          <ResultSection title="…ate" empty="No cuisines associated.">
            {result.ate.map((c) => (
              <div key={c.cuisineId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.region}</p>
                </div>
                <Badge className={confidenceTone(c.confidence)}>{pct(c.confidence)}</Badge>
              </div>
            ))}
          </ResultSection>

          {result.divergences.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Genetics ≠ language: notable divergences</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {result.divergences.map((d, i) => (
                  <p key={i}>
                    <strong>
                      {d.haplogroupName} / {d.languageFamilyName}:
                    </strong>{" "}
                    {d.annotation}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="border-muted-foreground/30 bg-muted/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" /> Important caveats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" data-testid="ancestry-caveats">
                {result.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ResultSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some(Boolean) && (!Array.isArray(children) || children.length > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {hasItems ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}
