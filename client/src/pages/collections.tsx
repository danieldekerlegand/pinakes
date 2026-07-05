/**
 * Collections pages (US-007).
 *
 * `/collections`            — list + create the owner's collections.
 * `/collections/:id`        — a collection detail: entities, add/remove, share,
 *                             edit title/visibility, delete.
 * `/shared/collection/:token` — a read-only public share view (owner-free).
 *
 * All mutating logic lives in the `use-collections` hooks; entity references use
 * the stable `cs:<type>:<id>` id.
 */
import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Check, Copy, Globe, Loader2, Lock, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  useCollection,
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useRemoveFromCollection,
  useSharedCollection,
  useUpdateCollection,
} from "@/hooks/use-collections";
import {
  collectionShareUrl,
  type CollectionItem,
  type CollectionShareView,
} from "@/lib/collections";

function ItemRow({ item, onRemove }: { item: CollectionItem; onRemove?: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.ref.name ?? item.ref.id}</div>
        <div className="text-xs text-muted-foreground">
          {item.ref.type}
          {item.ref.region ? ` · ${item.ref.region}` : ""}
        </div>
      </div>
      {onRemove && (
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove from collection">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List + create
// ---------------------------------------------------------------------------

function CollectionsList() {
  const { data, isLoading } = useCollections();
  const createCollection = useCreateCollection();
  const [title, setTitle] = useState("");
  const { toast } = useToast();

  async function create() {
    if (title.trim() === "") return;
    try {
      await createCollection.mutateAsync({ title: title.trim() });
      setTitle("");
    } catch {
      toast({ title: "Could not create collection", variant: "destructive" });
    }
  }

  const collections = data?.collections ?? [];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Collections</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Curate groups of entities around a theme and share them by link.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New collection title…"
        />
        <Button onClick={create} disabled={title.trim() === "" || createCollection.isPending}>
          Create
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : collections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No collections yet.</p>
      ) : (
        <div className="space-y-2">
          {collections.map((c) => (
            <Link key={c.id} href={`/collections/${c.id}`}>
              <Card className="cursor-pointer transition-colors hover:bg-accent/50">
                <CardHeader className="flex flex-row items-center justify-between py-4">
                  <div>
                    <CardTitle className="text-base">{c.title}</CardTitle>
                    {c.description && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{c.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{c.items.length} items</Badge>
                    {c.visibility === "public" ? (
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail (owner view)
// ---------------------------------------------------------------------------

function CopyShareLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = collectionShareUrl(token, typeof window !== "undefined" ? window.location.origin : "");
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="gap-1.5"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy share link"}
    </Button>
  );
}

function CollectionDetail({ id }: { id: string }) {
  const { data, isLoading, isError } = useCollection(id);
  const updateCollection = useUpdateCollection();
  const deleteCollection = useDeleteCollection();
  const removeItem = useRemoveFromCollection();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data?.collection) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">Collection not found.</p>
        <Link href="/collections" className="text-sm text-primary hover:underline">
          Back to collections
        </Link>
      </div>
    );
  }

  const collection = data.collection;
  const isPublic = collection.visibility === "public";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href="/collections" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Collections
      </Link>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{collection.title}</h1>
          {collection.description && (
            <p className="mt-1 text-sm text-muted-foreground">{collection.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              updateCollection.mutate({ id, visibility: isPublic ? "private" : "public" })
            }
          >
            {isPublic ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {isPublic ? "Public" : "Private"}
          </Button>
          {isPublic && <CopyShareLink token={collection.shareToken} />}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete collection"
            onClick={async () => {
              await deleteCollection.mutateAsync(id);
              toast({ title: "Collection deleted" });
              navigate("/collections");
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-2 py-4">
          {collection.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No entities yet. Add them from any detail panel’s “Add to collection” button.
            </p>
          ) : (
            collection.items.map((item) => (
              <ItemRow
                key={item.stableId}
                item={item}
                onRemove={() => removeItem.mutate({ id, stableId: item.stableId })}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public share view (read-only)
// ---------------------------------------------------------------------------

function SharedView({ view }: { view: CollectionShareView }) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Badge variant="secondary" className="mb-2">Shared collection</Badge>
      <h1 className="text-2xl font-semibold">{view.title}</h1>
      {view.description && <p className="mt-1 text-sm text-muted-foreground">{view.description}</p>}
      <p className="mb-4 mt-1 text-xs text-muted-foreground">{view.itemCount} entities</p>
      <Card>
        <CardContent className="space-y-2 py-4">
          {view.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">This collection is empty.</p>
          ) : (
            view.items.map((item) => <ItemRow key={item.stableId} item={item} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SharedCollectionPage() {
  const [, params] = useRoute("/shared/collection/:token");
  const token = params?.token;
  const { data, isLoading, isError } = useSharedCollection(token);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data?.collection) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">Shared collection not found.</p>
      </div>
    );
  }
  return <SharedView view={data.collection} />;
}

// ---------------------------------------------------------------------------
// Route entry
// ---------------------------------------------------------------------------

export default function CollectionsPage() {
  const [, params] = useRoute("/collections/:id");
  if (params?.id) return <CollectionDetail id={params.id} />;
  return <CollectionsList />;
}
