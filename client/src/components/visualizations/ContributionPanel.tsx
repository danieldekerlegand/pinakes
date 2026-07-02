import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Flag, Edit3, Loader2, Check, X,
  Clock, Send, AlertCircle, CheckCircle2, XCircle,
  Download, ArrowRight,
} from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

// ============================================================================
// Types
// ============================================================================

type ContributionStatus = 'pending' | 'approved' | 'rejected';
type ContributionAction = 'add' | 'edit' | 'flag';

interface ContributionSource {
  title: string;
  url?: string;
  author?: string;
  year?: number;
}

interface Contribution {
  id: string;
  entityType: string;
  action: ContributionAction;
  status: ContributionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
  contributorName?: string;
  entityId?: string;
  entityData: Record<string, unknown>;
  sources: ContributionSource[];
  confidence: number;
  notes?: string;
  fieldName?: string;
  currentValue?: string;
  suggestedValue?: string;
}

interface ContributionStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  byEntityType: Record<string, number>;
}

const ENTITY_TYPES = [
  { value: 'language', label: 'Language' },
  { value: 'cuisine', label: 'Cuisine' },
  { value: 'music-tradition', label: 'Music Tradition' },
  { value: 'musical-instrument', label: 'Musical Instrument' },
  { value: 'religion', label: 'Religion' },
  { value: 'archaeological-site', label: 'Archaeological Site' },
  { value: 'civilization', label: 'Civilization' },
  { value: 'boundary', label: 'Boundary' },
];

const STATUS_COLORS: Record<ContributionStatus, string> = {
  pending: '#f59e0b',
  approved: '#16a34a',
  rejected: '#dc2626',
};

const STATUS_ICONS: Record<ContributionStatus, React.ReactNode> = {
  pending: <Clock className="h-3.5 w-3.5" />,
  approved: <CheckCircle2 className="h-3.5 w-3.5" />,
  rejected: <XCircle className="h-3.5 w-3.5" />,
};

const ACTION_ICONS: Record<ContributionAction, React.ReactNode> = {
  add: <Plus className="h-3.5 w-3.5" />,
  edit: <Edit3 className="h-3.5 w-3.5" />,
  flag: <Flag className="h-3.5 w-3.5" />,
};

// ============================================================================
// Contribution Form (with per-field editing)
// ============================================================================

function ContributionForm({ onSuccess }: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState('cuisine');
  const [action, setAction] = useState<ContributionAction>('add');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [description, setDescription] = useState('');
  const [entityId, setEntityId] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [confidence, setConfidence] = useState(70);
  const [contributorName, setContributorName] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  // Per-field editing state
  const [fieldName, setFieldName] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [suggestedValue, setSuggestedValue] = useState('');

  const submitMutation = useMutation({
    mutationFn: async (data: unknown) => {
      const res = await fetch('/api/contributions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw json;
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contributions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contributions/stats'] });
      setName('');
      setRegion('');
      setDescription('');
      setEntityId('');
      setSourceTitle('');
      setSourceUrl('');
      setNotes('');
      setFieldName('');
      setCurrentValue('');
      setSuggestedValue('');
      setErrors([]);
      onSuccess?.();
    },
    onError: (error: any) => {
      setErrors(error.errors || [error.message || 'Submission failed']);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const entityData: Record<string, unknown> = {};
    if (action === 'flag') {
      entityData.issue = description;
    } else if (action === 'edit' && fieldName) {
      // Per-field edit
      entityData[fieldName] = suggestedValue;
      entityData.name = entityId;
    } else {
      if (name) entityData.name = name;
      if (region) entityData.region = region;
      if (description) entityData.description = description;
    }

    submitMutation.mutate({
      entityType,
      action,
      entityId: action !== 'add' ? entityId : undefined,
      entityData,
      sources: sourceTitle ? [{ title: sourceTitle, url: sourceUrl || undefined }] : [],
      confidence,
      contributorName: contributorName || undefined,
      notes: notes || undefined,
      ...(action === 'edit' && fieldName ? {
        fieldName,
        currentValue,
        suggestedValue,
      } : {}),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Action selector */}
      <div className="flex gap-2">
        {(['add', 'edit', 'flag'] as const).map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={action === a ? 'default' : 'outline'}
            onClick={() => setAction(a)}
            className="flex items-center gap-1.5"
          >
            {ACTION_ICONS[a]}
            {a === 'add' ? 'Add New' : a === 'edit' ? 'Suggest Edit' : 'Flag Issue'}
          </Button>
        ))}
      </div>

      {/* Entity type */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">Entity Type</label>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm"
        >
          {ENTITY_TYPES.map((et) => (
            <option key={et.value} value={et.value}>{et.label}</option>
          ))}
        </select>
      </div>

      {/* Entity ID for edits/flags */}
      {action !== 'add' && (
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            Existing Entity ID
          </label>
          <Input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="e.g., indian-classical, hinduism"
            required
          />
        </div>
      )}

      {/* Per-field editing (for edits only) */}
      {action === 'edit' && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 space-y-3">
          <p className="text-xs font-medium text-blue-700">Per-Field Edit</p>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Field Name
            </label>
            <Input
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="e.g., region, status, name"
            />
          </div>
          {fieldName && (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Current Value
                </label>
                <Input
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  placeholder="What's the current value?"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Suggested Value <span className="text-red-500">*</span>
                </label>
                <Input
                  value={suggestedValue}
                  onChange={(e) => setSuggestedValue(e.target.value)}
                  placeholder="What should it be?"
                  required
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Entity data (whole-entity for add, or when no field specified for edit) */}
      {action === 'add' && (
        <>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Entity name"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Region</label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g., East Africa, South Asia"
            />
          </div>
        </>
      )}

      {(action !== 'edit' || !fieldName) && (
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            {action === 'flag' ? 'Issue Description' : 'Description'}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm min-h-[60px]"
            placeholder={action === 'flag' ? 'Describe the issue...' : 'Brief description'}
          />
        </div>
      )}

      {/* Source citation */}
      <div className="border-t pt-3">
        <label className="text-sm font-medium text-gray-700 block mb-1">
          Source Citation {action !== 'flag' && <span className="text-red-500">*</span>}
        </label>
        <div className="flex gap-2">
          <Input
            value={sourceTitle}
            onChange={(e) => setSourceTitle(e.target.value)}
            placeholder="Source title"
            className="flex-1"
            required={action !== 'flag'}
          />
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="URL (optional)"
            className="flex-1"
          />
        </div>
      </div>

      {/* Confidence */}
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1">
          Confidence: {confidence}%
        </label>
        <input
          type="range"
          min={1}
          max={100}
          value={confidence}
          onChange={(e) => setConfidence(parseInt(e.target.value, 10))}
          className="w-full"
        />
      </div>

      {/* Optional fields */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Your Name (optional)</label>
          <Input
            value={contributorName}
            onChange={(e) => setContributorName(e.target.value)}
            placeholder="Name"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Notes (optional)</label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes"
          />
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          {errors.map((err, i) => (
            <p key={i} className="text-sm text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
            </p>
          ))}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitMutation.isPending}>
        {submitMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Send className="h-4 w-4 mr-2" />
        )}
        Submit Contribution
      </Button>
    </form>
  );
}

// ============================================================================
// Review Queue (enhanced with per-field edit display)
// ============================================================================

function ReviewQueue() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  const { data, isLoading } = useQuery<{ contributions: Contribution[]; total: number }>({
    queryKey: ['/api/contributions', { status: statusFilter }],
    staleTime: 10 * 1000,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: string; note?: string }) => {
      const res = await fetch(`/api/contributions/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contributions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contributions/stats'] });
    },
  });

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected', 'all'].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => setStatusFilter(s === 'all' ? '' : s)}
            className="text-xs"
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : !data?.contributions.length ? (
        <p className="text-center text-gray-500 py-8">No contributions found</p>
      ) : (
        <div className="space-y-2">
          {data.contributions.map((contrib) => (
            <div
              key={contrib.id}
              className="border rounded-lg p-3 bg-white"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-xs">
                    {ACTION_ICONS[contrib.action]}
                  </span>
                  <span className="font-medium text-sm">
                    {(contrib.entityData.name as string) || contrib.entityId || '—'}
                  </span>
                  <Badge variant="outline" className="text-xs">{contrib.entityType}</Badge>
                  <Badge
                    className="text-xs"
                    style={{
                      backgroundColor: STATUS_COLORS[contrib.status],
                      color: 'white',
                    }}
                  >
                    {STATUS_ICONS[contrib.status]}
                    <span className="ml-1">{contrib.status}</span>
                  </Badge>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(contrib.submittedAt).toLocaleDateString()}
                </span>
              </div>

              {/* Per-field edit display */}
              {contrib.fieldName && (
                <div className="bg-blue-50 border border-blue-100 rounded-md p-2 mb-2">
                  <p className="text-xs font-medium text-blue-700 mb-1">
                    Field: {contrib.fieldName}
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500 bg-white px-2 py-0.5 rounded border">
                      {contrib.currentValue || <span className="italic">empty</span>}
                    </span>
                    <ArrowRight className="h-3 w-3 text-blue-500 shrink-0" />
                    <span className="text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 font-medium">
                      {contrib.suggestedValue}
                    </span>
                  </div>
                </div>
              )}

              {typeof contrib.entityData.description === 'string' && (
                <p className="text-xs text-gray-600 mb-2">
                  {contrib.entityData.description}
                </p>
              )}
              {typeof contrib.entityData.issue === 'string' && (
                <p className="text-xs text-red-600 mb-2">
                  Issue: {contrib.entityData.issue}
                </p>
              )}

              <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                {contrib.contributorName && (
                  <span>By: {contrib.contributorName}</span>
                )}
                <span>Confidence: {contrib.confidence}%</span>
                {contrib.sources.length > 0 && (
                  <span>Sources: {contrib.sources.map((s) => s.title).join(', ')}</span>
                )}
              </div>

              {contrib.reviewNote && (
                <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 mb-2">
                  Review: {contrib.reviewNote}
                </p>
              )}

              {/* Review actions */}
              {contrib.status === 'pending' && (
                <div className="flex gap-2 mt-2 pt-2 border-t">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 border-green-200 hover:bg-green-50"
                    onClick={() => reviewMutation.mutate({
                      id: contrib.id,
                      decision: 'approved',
                      note: 'Approved via review queue',
                    })}
                    disabled={reviewMutation.isPending}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => reviewMutation.mutate({
                      id: contrib.id,
                      decision: 'rejected',
                      note: 'Rejected via review queue',
                    })}
                    disabled={reviewMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main ContributionPanel
// ============================================================================

export function ContributionPanel() {
  const [activeTab, setActiveTab] = useState('submit');

  const { data: stats } = useQuery<ContributionStats>({
    queryKey: ['/api/contributions/stats'],
    staleTime: 15 * 1000,
  });

  const handleExportCsv = () => {
    const link = document.createElement('a');
    link.href = '/api/contributions/export';
    link.download = 'contributions.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Stats bar */}
      {stats && stats.total > 0 && (
        <div className="flex items-center gap-4 px-4 py-3 bg-gradient-to-r from-green-50 to-blue-50 border-b text-sm">
          <span className="font-semibold text-gray-700">
            {stats.total} contributions
          </span>
          <Badge style={{ backgroundColor: STATUS_COLORS.pending, color: 'white' }} className="text-xs">
            {stats.pending} pending
          </Badge>
          <Badge style={{ backgroundColor: STATUS_COLORS.approved, color: 'white' }} className="text-xs">
            {stats.approved} approved
          </Badge>
          <Badge style={{ backgroundColor: STATUS_COLORS.rejected, color: 'white' }} className="text-xs">
            {stats.rejected} rejected
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-xs text-gray-600 hover:text-gray-900"
            onClick={handleExportCsv}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export CSV
          </Button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-2 mx-4 mt-4" style={{ maxWidth: '300px' }}>
          <TabsTrigger value="submit" className="flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Contribute
          </TabsTrigger>
          <TabsTrigger value="review" className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            Review
            {stats && stats.pending > 0 && (
              <Badge variant="destructive" className="text-xs ml-1 h-5 min-w-[20px] flex items-center justify-center">
                {stats.pending}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0">
          <TabsContent value="submit" className="mt-0 h-full">
            <ScrollArea className="h-full">
              <div className="p-4 max-w-lg">
                <h3 className="font-semibold text-lg mb-1">Contribute Data</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Submit new cultural entities, suggest per-field edits, or flag inaccuracies.
                  Use the "Suggest Edit" buttons on data displays for quick per-field corrections.
                </p>
                <ContributionForm
                  onSuccess={() => setActiveTab('review')}
                />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="review" className="mt-0 h-full">
            <ScrollArea className="h-full">
              <div className="p-4">
                <h3 className="font-semibold text-lg mb-1">Review Dashboard</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Review pending contributions. Per-field edits show the specific change proposed.
                </p>
                <ReviewQueue />
              </div>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default ContributionPanel;
