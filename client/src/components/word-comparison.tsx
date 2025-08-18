import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { X } from "lucide-react";

interface WordComparisonPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WordComparisonPanel({ isOpen, onClose }: WordComparisonPanelProps) {
  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-96">
        <SheetHeader>
          <SheetTitle>Word Comparison</SheetTitle>
          <SheetDescription>
            Compare words across different languages
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <p className="text-sm text-gray-500">Word comparison feature coming soon...</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}