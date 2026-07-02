import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Edit3, Send, Loader2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';

interface SuggestEditButtonProps {
  entityType: string;
  entityId: string;
  fieldName: string;
  fieldLabel: string;
  currentValue: string;
}

export function SuggestEditButton({
  entityType,
  entityId,
  fieldName,
  fieldLabel,
  currentValue,
}: SuggestEditButtonProps) {
  const [open, setOpen] = useState(false);
  const [suggestedValue, setSuggestedValue] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [contributorName, setContributorName] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const queryClient = useQueryClient();

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
      setSuggestedValue('');
      setSourceTitle('');
      setNotes('');
      setErrors([]);
      setOpen(false);
    },
    onError: (error: any) => {
      setErrors(error.errors || [error.message || 'Submission failed']);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestedValue.trim()) {
      setErrors(['Suggested value is required']);
      return;
    }

    submitMutation.mutate({
      entityType,
      action: 'edit',
      entityId,
      fieldName,
      currentValue,
      suggestedValue: suggestedValue.trim(),
      entityData: { [fieldName]: suggestedValue.trim(), name: entityId },
      sources: sourceTitle ? [{ title: sourceTitle }] : [],
      confidence: 70,
      contributorName: contributorName || undefined,
      notes: notes || undefined,
    });
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setSuggestedValue(currentValue);
          setOpen(true);
        }}
        className="inline-flex items-center text-gray-400 hover:text-blue-600 transition-colors p-0.5 rounded"
        title={`Suggest edit for ${fieldLabel}`}
      >
        <Edit3 className="h-3 w-3" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              Suggest Edit: {fieldLabel}
            </DialogTitle>
            <DialogDescription>
              Propose a correction for this field. Your suggestion will be reviewed before being applied.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Current Value
              </label>
              <div className="text-sm text-gray-500 bg-gray-50 rounded-md px-3 py-2 border">
                {currentValue || <span className="italic">Empty</span>}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Suggested Value <span className="text-red-500">*</span>
              </label>
              <Input
                value={suggestedValue}
                onChange={(e) => setSuggestedValue(e.target.value)}
                placeholder="Enter corrected value"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Source Citation
              </label>
              <Input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="Source title or reference"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Your Name
                </label>
                <Input
                  value={contributorName}
                  onChange={(e) => setContributorName(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Notes
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                {errors.map((err, i) => (
                  <p key={i} className="text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
                  </p>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitMutation.isPending}>
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Submit Edit
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
