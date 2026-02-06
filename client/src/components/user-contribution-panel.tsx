import { ComingSoon } from "@/components/ui/coming-soon";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface UserContributionPanelProps {
  baseWordId: string;
  baseWord: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function UserContributionPanel({
  isOpen,
  onClose
}: UserContributionPanelProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <ComingSoon
          title="User Contributions"
          description="Community-contributed translations and linguistic insights"
        />
      </DialogContent>
    </Dialog>
  );
}
