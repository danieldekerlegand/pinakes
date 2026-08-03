/**
 * React Query hooks for collaborative collections (US-007).
 *
 * Reads go through the default `getQueryFn` (object query-key parts become query
 * params — so `owner` authorizes the read server-side); writes go through
 * `apiRequest` with the owner in the body. All mutations invalidate the owner's
 * list and the affected collection so the UI stays consistent.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/queryClient";
import {
  collectionQueryKey,
  collectionsQueryKey,
  getOwnerId,
  sharedCollectionQueryKey,
  type Collection,
  type CollectionEntityRef,
  type CollectionShareView,
  type CollectionVisibility,
} from "@/lib/collections";

interface CollectionEnvelope {
  collection: Collection;
}
interface CollectionListEnvelope {
  collections: Collection[];
  total: number;
}
interface ShareEnvelope {
  collection: CollectionShareView;
}

/** List the current browser-owner's collections. */
export function useCollections() {
  const owner = getOwnerId();
  return useQuery<CollectionListEnvelope>({
    queryKey: collectionsQueryKey(owner),
  });
}

/** Fetch a single owned (or public) collection. */
export function useCollection(id: string | undefined) {
  const owner = getOwnerId();
  return useQuery<CollectionEnvelope>({
    queryKey: id ? collectionQueryKey(id, owner) : ["/api/collections/__none__"],
    enabled: !!id,
  });
}

/** Fetch a read-only shared collection by token (no owner). */
export function useSharedCollection(token: string | undefined) {
  return useQuery<ShareEnvelope>({
    queryKey: token ? sharedCollectionQueryKey(token) : ["/api/collections/shared/__none__"],
    enabled: !!token,
  });
}

interface CreateInput {
  title: string;
  description?: string;
  visibility?: CollectionVisibility;
  items?: CollectionEntityRef[];
}

export function useCreateCollection() {
  const qc = useQueryClient();
  const owner = getOwnerId();
  return useMutation({
    mutationFn: async (input: CreateInput): Promise<Collection> => {
      const res = await apiRequest("POST", "/api/collections", { ...input, owner });
      return (await res.json()).collection;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: collectionsQueryKey(owner) });
    },
  });
}

interface UpdateInput {
  id: string;
  title?: string;
  description?: string;
  visibility?: CollectionVisibility;
}

export function useUpdateCollection() {
  const qc = useQueryClient();
  const owner = getOwnerId();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateInput): Promise<Collection> => {
      const res = await apiRequest("PATCH", `/api/collections/${id}`, { ...patch, owner });
      return (await res.json()).collection;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: collectionsQueryKey(owner) });
      qc.invalidateQueries({ queryKey: collectionQueryKey(id, owner) });
    },
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  const owner = getOwnerId();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiRequest("DELETE", `/api/collections/${id}`, { owner });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: collectionsQueryKey(owner) });
    },
  });
}

interface AddItemInput {
  id: string;
  ref: CollectionEntityRef;
  note?: string;
}

export function useAddToCollection() {
  const qc = useQueryClient();
  const owner = getOwnerId();
  return useMutation({
    mutationFn: async ({ id, ref, note }: AddItemInput): Promise<Collection> => {
      const res = await apiRequest("POST", `/api/collections/${id}/items`, { ...ref, note, owner });
      return (await res.json()).collection;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: collectionsQueryKey(owner) });
      qc.invalidateQueries({ queryKey: collectionQueryKey(id, owner) });
    },
  });
}

interface RemoveItemInput {
  id: string;
  stableId: string;
}

export function useRemoveFromCollection() {
  const qc = useQueryClient();
  const owner = getOwnerId();
  return useMutation({
    mutationFn: async ({ id, stableId }: RemoveItemInput): Promise<Collection> => {
      const res = await apiRequest(
        "DELETE",
        `/api/collections/${id}/items/${encodeURIComponent(stableId)}`,
        { owner },
      );
      return (await res.json()).collection;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: collectionsQueryKey(owner) });
      qc.invalidateQueries({ queryKey: collectionQueryKey(id, owner) });
    },
  });
}
