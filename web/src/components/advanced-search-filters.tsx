import { ComingSoon } from "@/components/ui/coming-soon";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface AdvancedSearchFiltersProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: any) => void;
}

export default function AdvancedSearchFilters({ isOpen, onClose }: AdvancedSearchFiltersProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <ComingSoon
          title="Advanced Search Filters"
          description="Powerful filtering and search capabilities for linguistic data"
        />
      </DialogContent>
    </Dialog>
  );
}
