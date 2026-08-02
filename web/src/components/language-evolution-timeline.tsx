import { ComingSoon } from "@/components/ui/coming-soon";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface LanguageEvolutionTimelineProps {
  languageId: string;
  languageName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function LanguageEvolutionTimeline({
  isOpen,
  onClose
}: LanguageEvolutionTimelineProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <ComingSoon
          title="Language Evolution Timeline"
          description="Track historical linguistic development and evolution events over time"
        />
      </DialogContent>
    </Dialog>
  );
}
