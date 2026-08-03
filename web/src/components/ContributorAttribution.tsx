import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';

interface ContributionInfo {
  id: string;
  contributorName?: string;
  fieldName?: string;
  suggestedValue?: string;
  submittedAt: string;
  status: string;
}

interface ContributorAttributionProps {
  entityType: string;
  entityId: string;
}

export function ContributorAttribution({ entityType, entityId }: ContributorAttributionProps) {
  const { data } = useQuery<{ contributions: ContributionInfo[] }>({
    queryKey: ['/api/contributions/entity', entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/contributions/entity/${entityType}/${entityId}`);
      if (!res.ok) return { contributions: [] };
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const contributions = data?.contributions || [];
  if (contributions.length === 0) return null;

  const contributors = Array.from(
    new Set(contributions.map((c) => c.contributorName).filter(Boolean))
  );

  return (
    <div className="border-t pt-3 mt-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
        <Users className="h-3 w-3" />
        <span className="font-medium">Community contributions</span>
      </div>
      <div className="space-y-1">
        {contributions.slice(0, 5).map((c) => (
          <div key={c.id} className="text-xs text-gray-500 flex items-center gap-1">
            <span className="text-gray-400">
              {c.fieldName ? `${c.fieldName}:` : 'edit'}
            </span>
            {c.contributorName && (
              <span className="font-medium text-gray-600">{c.contributorName}</span>
            )}
            <span className="text-gray-400">
              {new Date(c.submittedAt).toLocaleDateString()}
            </span>
          </div>
        ))}
        {contributors.length > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            Contributors: {contributors.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
