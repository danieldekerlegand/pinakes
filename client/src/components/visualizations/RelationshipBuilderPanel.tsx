import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Link2, X } from 'lucide-react';

/**
 * Relationship builder (US-003) — drag one entity onto another to author a
 * typed edge (source, target, relationship_type, time range, confidence). The
 * authored edge is POSTed to `/api/relationships/edge`, which lands it in the
 * contribution review queue (never a direct TSV write). Self edges and
 * duplicates are rejected server-side (409/400) and surfaced inline; a
 * successful edge is echoed back as a confirmation card.
 *
 * The relationship-type vocabulary is the canonical edge vocabulary fetched from
 * `/api/relationships/edge/options`.
 */

export interface RelationshipEntity {
  id: string;
  name: string;
}

interface RelationshipTypeOption {
  name: string;
  token: string;
  description: string;
}

interface OptionsResponse {
  relationshipTypes: RelationshipTypeOption[];
  existingEdges: { sourceId: string; targetId: string; relationshipType: string }[];
}

interface Confirmation {
  sourceName: string;
  targetName: string;
  relationshipType: string;
  relationshipToken: string;
  timeStart: number | null;
  timeEnd: number | null;
  confidence: number;
}

interface Props {
  entities: RelationshipEntity[];
  onSubmitted?: () => void;
}

function labelFor(type: string): string {
  return type
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const DROP_MIME = 'application/x-relationship-entity';

export default function RelationshipBuilderPanel({ entities, onSubmitted }: Props) {
  const [source, setSource] = useState<RelationshipEntity | null>(null);
  const [target, setTarget] = useState<RelationshipEntity | null>(null);
  const [relationshipType, setRelationshipType] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [confidence, setConfidence] = useState('60');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: options } = useQuery<OptionsResponse>({
    queryKey: ['/api/relationships/edge/options'],
    staleTime: 60 * 1000,
  });

  const relationshipTypes = options?.relationshipTypes ?? [];

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? entities.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
      : entities;
    return list.slice(0, 60);
  }, [entities, search]);

  const handleDragStart = (e: React.DragEvent, entity: RelationshipEntity) => {
    e.dataTransfer.setData(DROP_MIME, JSON.stringify(entity));
    e.dataTransfer.effectAllowed = 'link';
  };

  const handleDrop = (e: React.DragEvent, slot: 'source' | 'target') => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DROP_MIME);
    if (!raw) return;
    try {
      const entity = JSON.parse(raw) as RelationshipEntity;
      if (slot === 'source') setSource(entity);
      else setTarget(entity);
      setConfirmation(null);
      setError(null);
    } catch {
      /* ignore malformed drops */
    }
  };

  const isSelfEdge = !!source && !!target && source.id === target.id;

  const canSubmit =
    !!source && !!target && !isSelfEdge && !!relationshipType && !submitting;

  const reset = () => {
    setSource(null);
    setTarget(null);
    setRelationshipType('');
    setTimeStart('');
    setTimeEnd('');
    setDescription('');
  };

  const handleSubmit = async () => {
    if (!source || !target) return;
    setSubmitting(true);
    setError(null);
    setConfirmation(null);
    try {
      const body = {
        sourceId: source.id,
        sourceName: source.name,
        targetId: target.id,
        targetName: target.name,
        relationshipType,
        timeStart: timeStart.trim() === '' ? null : Number(timeStart),
        timeEnd: timeEnd.trim() === '' ? null : Number(timeEnd),
        confidence: confidence.trim() === '' ? undefined : Number(confidence),
        description: description.trim() || undefined,
      };
      const res = await fetch('/api/relationships/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          Array.isArray(data.errors) && data.errors.length > 0
            ? data.errors.join('; ')
            : data.message || 'Failed to create relationship',
        );
        return;
      }
      setConfirmation(data.relationship as Confirmation);
      reset();
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create relationship');
    } finally {
      setSubmitting(false);
    }
  };

  const DropSlot = ({
    slot,
    entity,
    label,
  }: {
    slot: 'source' | 'target';
    entity: RelationshipEntity | null;
    label: string;
  }) => (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => handleDrop(e, slot)}
      className={`flex-1 min-h-[52px] rounded-md border-2 border-dashed px-3 py-2 text-sm transition-colors ${
        entity ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'
      }`}
      data-testid={`relationship-drop-${slot}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      {entity ? (
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-800 truncate">{entity.name}</span>
          <button
            onClick={() => (slot === 'source' ? setSource(null) : setTarget(null))}
            className="text-gray-400 hover:text-gray-700"
            aria-label={`Clear ${label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <span className="text-gray-400">Drag an entity here</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-2 text-gray-700">
        <Link2 className="h-4 w-4" />
        <span className="font-semibold">Relationship builder</span>
        <span className="text-xs text-gray-400">Drag one entity onto another to link them</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Entity palette */}
        <div className="border rounded-md p-2 bg-white">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter entities…"
            className="w-full mb-2 h-8 px-2 border rounded text-sm"
          />
          <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1.5">
            {filteredEntities.map((entity) => (
              <div
                key={entity.id}
                draggable
                onDragStart={(e) => handleDragStart(e, entity)}
                className="cursor-grab active:cursor-grabbing select-none rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs hover:bg-gray-100"
                title={entity.id}
                data-testid="relationship-entity-chip"
              >
                {entity.name}
              </div>
            ))}
            {filteredEntities.length === 0 && (
              <span className="text-xs text-gray-400">No entities match.</span>
            )}
          </div>
        </div>

        {/* Edge composer */}
        <div className="border rounded-md p-3 bg-white flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <DropSlot slot="source" entity={source} label="Source" />
            <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
            <DropSlot slot="target" entity={target} label="Target" />
          </div>

          {isSelfEdge && (
            <p className="text-xs text-red-600">
              An entity cannot be linked to itself — choose a different target.
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Relationship type</span>
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="h-8 px-2 border rounded text-sm"
              data-testid="relationship-type-select"
            >
              <option value="">Select a type…</option>
              {relationshipTypes.map((t) => (
                <option key={t.name} value={t.name} title={t.description}>
                  {labelFor(t.name)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Start year</span>
              <input
                type="number"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
                placeholder="e.g. -500"
                className="h-8 px-2 border rounded text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">End year</span>
              <input
                type="number"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
                placeholder="e.g. 200"
                className="h-8 px-2 border rounded text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Confidence</span>
              <input
                type="number"
                min={1}
                max={100}
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
                className="h-8 px-2 border rounded text-sm"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Description (optional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Evidence / rationale"
              className="h-8 px-2 border rounded text-sm"
            />
          </label>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-9 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="relationship-submit"
          >
            {submitting ? 'Submitting…' : 'Create relationship'}
          </button>

          {error && (
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          )}

          {confirmation && (
            <div
              className="rounded border border-green-300 bg-green-50 p-2 text-xs text-green-800"
              role="status"
            >
              <div className="flex items-center gap-1 font-medium">
                <Check className="h-3.5 w-3.5" /> Relationship queued for review
              </div>
              <div className="mt-1">
                <span className="font-medium">{confirmation.sourceName}</span>{' '}
                <span className="text-green-600">
                  —{labelFor(confirmation.relationshipType)}→
                </span>{' '}
                <span className="font-medium">{confirmation.targetName}</span>
                {confirmation.timeStart !== null && (
                  <span className="text-green-600">
                    {' '}
                    ({confirmation.timeStart}
                    {confirmation.timeEnd !== null ? `–${confirmation.timeEnd}` : ''})
                  </span>
                )}
                <span className="text-green-600"> · {confirmation.confidence}% confidence</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
