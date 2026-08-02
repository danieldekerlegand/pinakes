/**
 * AI-extraction review queue (US-009).
 *
 * `/ai-review` lists AI-generated drafts (from the URL extractor US-004 and the
 * text extractor US-008) and lets a human accept / edit / reject each field
 * before commit. Low-confidence fields are highlighted. Approving promotes the
 * accepted draft into the live dataset (server-side, `lexicons/*.tsv`) with
 * provenance recording both the AI source and the reviewer; rejecting drops it.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ReviewField {
  field: string;
  value: unknown;
  confidence: number | null;
  lowConfidence: boolean;
}

interface AiDraftView {
  id: string;
  entityType: string;
  status: string;
  aiSource: string | null;
  overallConfidence: number;
  submittedAt: string;
  reviewer?: string;
  fields: ReviewField[];
  relationships: unknown[];
  promotable: boolean;
  promotion?: { file: string; targetId: string };
}

type FieldState =
  | { decision: "accept" }
  | { decision: "edit"; value: string }
  | { decision: "reject" };

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function confidenceLabel(c: number | null): string {
  return c === null ? "—" : `${Math.round(c * 100)}%`;
}

function DraftCard({ draft, reviewer }: { draft: AiDraftView; reviewer: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});

  const setState = (field: string, state: FieldState) =>
    setFieldStates((prev) => ({ ...prev, [field]: state }));

  const review = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const fields: Record<string, unknown> = {};
      for (const [field, state] of Object.entries(fieldStates)) {
        if (state.decision !== "accept") fields[field] = state;
      }
      const res = await apiRequest("PATCH", `/api/ai-review/${draft.id}`, {
        decision,
        reviewer: reviewer.trim() || "anonymous",
        fields,
      });
      return res.json();
    },
    onSuccess: (_data, decision) => {
      toast({
        title: decision === "approved" ? "Draft approved & promoted" : "Draft rejected",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-review"] });
    },
    onError: (err: Error) => {
      toast({ title: "Review failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`ai-draft-${draft.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {displayValue(draft.fields.find((f) => f.field === "name")?.value) || draft.id}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{draft.entityType}</Badge>
            <Badge variant="outline">{draft.aiSource ?? "ai"}</Badge>
            <Badge>{draft.overallConfidence}%</Badge>
          </div>
        </div>
        {!draft.promotable && (
          <div className="flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" /> No live-dataset target for this type — can only be
            rejected.
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {draft.fields.map((f) => {
          const state = fieldStates[f.field] ?? { decision: "accept" };
          return (
            <div
              key={f.field}
              className={`rounded-md border p-2 ${
                f.lowConfidence ? "border-amber-400 bg-amber-50" : ""
              }`}
              data-testid={`field-${f.field}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{f.field}</span>
                <span
                  className={`text-xs ${f.lowConfidence ? "text-amber-700" : "text-muted-foreground"}`}
                >
                  confidence {confidenceLabel(f.confidence)}
                  {f.lowConfidence ? " · low" : ""}
                </span>
              </div>
              {state.decision === "edit" ? (
                <Input
                  className="mt-1"
                  value={state.value}
                  onChange={(e) => setState(f.field, { decision: "edit", value: e.target.value })}
                />
              ) : (
                <div
                  className={`mt-1 text-sm ${
                    state.decision === "reject" ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {displayValue(f.value) || <span className="italic">(empty)</span>}
                </div>
              )}
              <div className="mt-2 flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={state.decision === "accept" ? "default" : "outline"}
                  onClick={() => setState(f.field, { decision: "accept" })}
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={state.decision === "edit" ? "default" : "outline"}
                  onClick={() =>
                    setState(f.field, { decision: "edit", value: displayValue(f.value) })
                  }
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={state.decision === "reject" ? "destructive" : "outline"}
                  onClick={() => setState(f.field, { decision: "reject" })}
                >
                  Reject
                </Button>
              </div>
            </div>
          );
        })}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => review.mutate("approved")}
            disabled={review.isPending || !draft.promotable}
            data-testid="approve-draft"
          >
            {review.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
            Approve & commit
          </Button>
          <Button
            variant="outline"
            onClick={() => review.mutate("rejected")}
            disabled={review.isPending}
            data-testid="reject-draft"
          >
            <X className="mr-1 h-4 w-4" /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AiReviewPage() {
  const [reviewer, setReviewer] = useState("");
  const { data, isLoading } = useQuery<{ drafts: AiDraftView[]; total: number }>({
    queryKey: ["/api/ai-review", { status: "pending" }],
  });

  const drafts = useMemo(() => data?.drafts ?? [], [data]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold">AI extraction review</h1>
        <p className="text-sm text-muted-foreground">
          Accept, edit, or reject each field of an AI-generated draft before it enters the dataset.
          Low-confidence fields are highlighted.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor="reviewer">
          Reviewer
        </label>
        <Input
          id="reviewer"
          className="max-w-xs"
          placeholder="your name"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading drafts…
        </div>
      ) : drafts.length === 0 ? (
        <p className="text-muted-foreground">No AI drafts awaiting review.</p>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} reviewer={reviewer} />
          ))}
        </div>
      )}
    </div>
  );
}
