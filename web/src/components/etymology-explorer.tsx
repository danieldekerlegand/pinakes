import { ComingSoon } from "@/components/ui/coming-soon";

interface EtymologyExplorerProps {
  baseWordId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function EtymologyExplorer({ isOpen, onClose }: EtymologyExplorerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-2xl w-full p-6">
        <div className="flex justify-end mb-4">
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        <ComingSoon
          title="Contextual Etymology Explorer"
          description="Trace historical word migration and etymological connections across language families"
        />
      </div>
    </div>
  );
}