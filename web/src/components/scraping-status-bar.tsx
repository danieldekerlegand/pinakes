import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Pause } from "lucide-react";
import type { ScrapingJob } from "@contracts/types";

export default function ScrapingStatusBar() {
  const { data: jobs = [] } = useQuery<ScrapingJob[]>({
    queryKey: ['/api/scraping-jobs'],
    refetchInterval: 2000, // Poll every 2 seconds
  });

  const activeJob = jobs.find(job => job.status === 'running');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (activeJob && (activeJob.totalWords || 0) > 0) {
      setProgress(((activeJob.completedWords || 0) / (activeJob.totalWords || 1)) * 100);
    }
  }, [activeJob]);

  if (!activeJob) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-material-2 z-30">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-gray-600" data-testid="text-scraping-status">
              Scraping in progress...
            </span>
          </div>
          <div className="text-sm text-gray-500" data-testid="text-current-job">
            {activeJob.statusMessage || `Processing: ${activeJob.languageId} - ${activeJob.completedWords} / ${activeJob.totalWords} words`}
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="w-32">
            <Progress value={progress} className="h-2" />
          </div>
          <span className="text-sm text-gray-600" data-testid="text-progress-percentage">
            {Math.round(progress)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary-dark"
            data-testid="button-pause-scraping"
          >
            <Pause className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
