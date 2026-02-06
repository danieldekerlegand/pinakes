import { ComingSoon } from "@/components/ui/coming-soon";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface LanguageMapProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LanguageMap({ isOpen, onClose }: LanguageMapProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl">
        <ComingSoon
          title="Geographic Language Map"
          description="Interactive map showing language distribution and geographic relationships"
        />
      </DialogContent>
    </Dialog>
  );
}
