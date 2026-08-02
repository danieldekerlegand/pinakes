/**
 * "Add to collection" affordance for entity detail panels (US-007).
 *
 * Drop it into any panel with a {@link GraphEntityRef} — the same ref shape used
 * by `ShowInGraphButton` / `RelatedEntities`. Opens a popover listing the user's
 * collections (with a checkmark for the ones already containing this entity) plus
 * an inline "create a new collection" form. Entities are referenced by their
 * stable `cs:<type>:<id>` id (see `lib/collections.ts`).
 *
 * Self-hides when the entity has no stable id (no local id to reference).
 */
import { useState } from "react";
import { Check, FolderPlus, Loader2, Plus } from "lucide-react";
import { Link } from "wouter";

import type { GraphEntityRef } from "@/components/graph/ShowInGraphButton";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  useAddToCollection,
  useCollections,
  useCreateCollection,
  useRemoveFromCollection,
} from "@/hooks/use-collections";
import { isEntityInCollection, toCollectionRef } from "@/lib/collections";

export interface AddToCollectionButtonProps {
  entity: GraphEntityRef;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}

export function AddToCollectionButton({
  entity,
  label = "Add to collection",
  variant = "outline",
  size = "sm",
}: AddToCollectionButtonProps) {
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const { toast } = useToast();

  const ref = toCollectionRef(entity);
  const { data, isLoading } = useCollections();
  const addItem = useAddToCollection();
  const removeItem = useRemoveFromCollection();
  const createCollection = useCreateCollection();

  // No stable id → nothing to reference. Render nothing.
  if (!ref) return null;

  const collections = data?.collections ?? [];

  async function toggle(collectionId: string, contains: boolean, stableId: string) {
    if (!ref) return;
    try {
      if (contains) {
        await removeItem.mutateAsync({ id: collectionId, stableId });
      } else {
        await addItem.mutateAsync({ id: collectionId, ref });
      }
    } catch {
      toast({ title: "Could not update collection", variant: "destructive" });
    }
  }

  async function createAndAdd() {
    if (!ref || newTitle.trim() === "") return;
    try {
      await createCollection.mutateAsync({ title: newTitle.trim(), items: [ref] });
      setNewTitle("");
      toast({ title: `Added to “${newTitle.trim()}”` });
    } catch {
      toast({ title: "Could not create collection", variant: "destructive" });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size={size} className="gap-1.5">
          <FolderPlus className="h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
          Your collections
        </div>

        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : collections.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No collections yet — create one below.
            </div>
          ) : (
            collections.map((c) => {
              const contains = isEntityInCollection(c, ref);
              const stableId = `cs:${ref.type}:${ref.id}`;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id, contains, stableId)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span className="truncate">{c.title}</span>
                  {contains && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createAndAdd();
            }}
            placeholder="New collection…"
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8 shrink-0 px-2"
            disabled={newTitle.trim() === "" || createCollection.isPending}
            onClick={createAndAdd}
            aria-label="Create collection and add"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-2 border-t pt-2 text-center">
          <Link
            href="/collections"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Manage collections
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
