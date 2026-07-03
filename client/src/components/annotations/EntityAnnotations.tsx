/**
 * "Notes & annotations" section for entity detail panels (US-008).
 *
 * Drop it into any panel with a {@link GraphEntityRef} — the same ref shape used
 * by `ShowInGraphButton` / `RelatedEntities` / `AddToCollectionButton`. It lists
 * the current browser-owner's own notes plus everyone's public notes on the
 * entity, and lets the owner add / edit / delete / share (make public) their own.
 *
 * Notes are **user-generated** and are visually and structurally separated from
 * the authoritative curated data (a distinct card with a "your notes" caption and
 * a "Note" badge on every entry). Private by default; sharing is one toggle.
 *
 * Self-hides when the entity has no stable id (no local id to reference).
 */
import { useState } from "react";
import { Loader2, NotebookPen, Pencil, Trash2, Globe, Lock } from "lucide-react";

import type { GraphEntityRef } from "@/components/graph/ShowInGraphButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateAnnotation,
  useDeleteAnnotation,
  useEntityAnnotations,
  useUpdateAnnotation,
} from "@/hooks/use-annotations";
import { toAnnotationRef, type AnnotationView } from "@/lib/annotations";

export interface EntityAnnotationsProps {
  entity: GraphEntityRef;
  className?: string;
}

export function EntityAnnotations({ entity, className }: EntityAnnotationsProps) {
  const ref = toAnnotationRef(entity);
  const { data, isLoading } = useEntityAnnotations(ref);
  const create = useCreateAnnotation();
  const [draft, setDraft] = useState("");
  const [shareNew, setShareNew] = useState(false);
  const { toast } = useToast();

  // No stable id → nothing to attach a note to. Render nothing.
  if (!ref) return null;

  const annotations = data?.annotations ?? [];

  async function addNote() {
    if (!ref || draft.trim() === "") return;
    try {
      await create.mutateAsync({ ref, body: draft.trim(), visibility: shareNew ? "public" : "private" });
      setDraft("");
      setShareNew(false);
    } catch {
      toast({ title: "Could not save note", variant: "destructive" });
    }
  }

  return (
    <div className={`rounded-lg border bg-muted/30 p-4 ${className ?? ""}`} data-testid="entity-annotations">
      <div className="mb-3 flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Your notes</h3>
        <span className="text-xs text-muted-foreground">— personal annotations, separate from the curated data</span>
      </div>

      {/* Add a note */}
      <div className="mb-3 space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add your own note about this entity…"
          className="min-h-[72px] text-sm"
          maxLength={10000}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={shareNew}
              onChange={(e) => setShareNew(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Share publicly
          </label>
          <Button
            size="sm"
            onClick={addNote}
            disabled={draft.trim() === "" || create.isPending}
          >
            {create.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Add note
          </Button>
        </div>
      </div>

      {/* Existing notes */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading notes…
        </div>
      ) : annotations.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {annotations.map((a) => (
            <AnnotationRow key={a.id} annotation={a} entityRef={ref} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AnnotationRow({
  annotation,
  entityRef,
}: {
  annotation: AnnotationView;
  entityRef: NonNullable<ReturnType<typeof toAnnotationRef>>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(annotation.body);
  const update = useUpdateAnnotation();
  const remove = useDeleteAnnotation();
  const { toast } = useToast();

  async function save() {
    if (text.trim() === "") return;
    try {
      await update.mutateAsync({ id: annotation.id, ref: entityRef, body: text.trim() });
      setEditing(false);
    } catch {
      toast({ title: "Could not update note", variant: "destructive" });
    }
  }

  async function toggleShare() {
    try {
      await update.mutateAsync({
        id: annotation.id,
        ref: entityRef,
        visibility: annotation.visibility === "public" ? "private" : "public",
      });
    } catch {
      toast({ title: "Could not change visibility", variant: "destructive" });
    }
  }

  async function del() {
    try {
      await remove.mutateAsync({ id: annotation.id, ref: entityRef });
    } catch {
      toast({ title: "Could not delete note", variant: "destructive" });
    }
  }

  return (
    <li className="rounded-md border bg-background p-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">Note</Badge>
        {annotation.visibility === "public" ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Globe className="h-3 w-3" /> Public
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Private
          </Badge>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[60px] text-sm"
            maxLength={10000}
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(annotation.body); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={text.trim() === "" || update.isPending}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{annotation.body}</p>
      )}

      {annotation.editable && !editing && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button
            type="button"
            onClick={toggleShare}
            disabled={update.isPending}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            {annotation.visibility === "public" ? (
              <><Lock className="h-3 w-3" /> Make private</>
            ) : (
              <><Globe className="h-3 w-3" /> Share</>
            )}
          </button>
          <button
            type="button"
            onClick={del}
            disabled={remove.isPending}
            className="flex items-center gap-1 text-destructive/80 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </li>
  );
}
