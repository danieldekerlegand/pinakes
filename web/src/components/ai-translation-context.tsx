import { ComingSoon } from "@/components/ui/coming-soon";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface AITranslationContextProps {
  baseWordId: string;
  baseWord: string;
  languageId: string;
  languageName: string;
  translation: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AITranslationContext({
  isOpen,
  onClose
}: AITranslationContextProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <ComingSoon
          title="AI Translation Context"
          description="Explore AI-powered cultural and usage context for word translations"
        />
      </DialogContent>
    </Dialog>
  );
}
