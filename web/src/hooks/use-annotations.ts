/**
 * React Query hooks for user annotations & notes on entities (US-008).
 *
 * Reads go through the default `getQueryFn` (object query-key parts become query
 * params — so `entity`+`owner` scope the read server-side); writes go through
 * `apiRequest` with the owner in the body. All mutations invalidate the entity's
 * annotation list so the panel stays consistent.
 *
 * The browser-owner id is shared with collections (`lib/collections.getOwnerId`)
 * so a browser has a single soft identity across the app.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/queryClient";
import { getOwnerId } from "@/lib/collections";
import {
  entityAnnotationsQueryKey,
  stableEntityId,
  type AnnotationEntityRef,
  type AnnotationView,
  type AnnotationVisibility,
} from "@/lib/annotations";

interface AnnotationListEnvelope {
  annotations: AnnotationView[];
  total: number;
}

/** List the annotations on an entity visible to the current browser-owner. */
export function useEntityAnnotations(ref: AnnotationEntityRef | null) {
  const owner = getOwnerId();
  const stableId = ref ? stableEntityId(ref) : "";
  return useQuery<AnnotationListEnvelope>({
    queryKey: ref
      ? entityAnnotationsQueryKey(stableId, owner)
      : ["/api/annotations/__none__"],
    enabled: !!ref,
  });
}

function useInvalidateEntity() {
  const qc = useQueryClient();
  const owner = getOwnerId();
  return (ref: AnnotationEntityRef) =>
    qc.invalidateQueries({ queryKey: entityAnnotationsQueryKey(stableEntityId(ref), owner) });
}

interface CreateInput {
  ref: AnnotationEntityRef;
  body: string;
  visibility?: AnnotationVisibility;
}

export function useCreateAnnotation() {
  const owner = getOwnerId();
  const invalidate = useInvalidateEntity();
  return useMutation({
    mutationFn: async ({ ref, body, visibility }: CreateInput): Promise<AnnotationView> => {
      const res = await apiRequest("POST", "/api/annotations", { ...ref, body, visibility, owner });
      return (await res.json()).annotation;
    },
    onSuccess: (_data, { ref }) => invalidate(ref),
  });
}

interface UpdateInput {
  id: string;
  /** The entity the note belongs to — needed to invalidate the right list. */
  ref: AnnotationEntityRef;
  body?: string;
  visibility?: AnnotationVisibility;
}

export function useUpdateAnnotation() {
  const owner = getOwnerId();
  const invalidate = useInvalidateEntity();
  return useMutation({
    mutationFn: async ({ id, body, visibility }: UpdateInput): Promise<AnnotationView> => {
      const res = await apiRequest("PATCH", `/api/annotations/${id}`, { body, visibility, owner });
      return (await res.json()).annotation;
    },
    onSuccess: (_data, { ref }) => invalidate(ref),
  });
}

interface DeleteInput {
  id: string;
  ref: AnnotationEntityRef;
}

export function useDeleteAnnotation() {
  const owner = getOwnerId();
  const invalidate = useInvalidateEntity();
  return useMutation({
    mutationFn: async ({ id }: DeleteInput): Promise<void> => {
      await apiRequest("DELETE", `/api/annotations/${id}`, { owner });
    },
    onSuccess: (_data, { ref }) => invalidate(ref),
  });
}
