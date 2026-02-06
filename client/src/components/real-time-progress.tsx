import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Loader2, Activity } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ScrapingJob } from "@shared/types";

interface RealTimeProgressProps {
  activeJobs: ScrapingJob[];
}

export function RealTimeProgress({ activeJobs }: RealTimeProgressProps) {

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'pending':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  if (activeJobs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="real-time-progress">
      {/* Progress Cards */}
      {activeJobs.map(job => {
        const percentage = job.completedWords && job.totalWords ?
                          Math.round((job.completedWords / job.totalWords) * 100) : 0;

        return (
          <Card key={job.id} className="w-full" data-testid={`progress-card-${job.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(job.status)}
                  <CardTitle className="text-base">
                    Scraping Progress
                  </CardTitle>
                  <Badge
                    variant="secondary"
                    className={`text-white ${getStatusColor(job.status)}`}
                  >
                    {job.status}
                  </Badge>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  {job.completedWords || 0} / {job.totalWords || 0} words
                </div>
              </div>
              <CardDescription>
                Language ID: {job.languageId}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Status Message */}
              {job.statusMessage && (
                <div className="text-sm text-muted-foreground italic">
                  {job.statusMessage}
                </div>
              )}

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span className="font-medium">{percentage}%</span>
                </div>
                <Progress
                  value={percentage}
                  className="h-2"
                  data-testid={`progress-bar-${job.id}`}
                />
              </div>

              {/* Statistics */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Completed:</span>
                  <span className="ml-2 font-medium text-green-600">
                    {job.completedWords || 0}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Failed:</span>
                  <span className="ml-2 font-medium text-red-600">
                    {job.failedWords || 0}
                  </span>
                </div>
              </div>

              {/* Timestamps */}
              {job.startedAt && (
                <div className="text-xs text-muted-foreground">
                  Started: {new Date(job.startedAt).toLocaleTimeString()}
                  {job.completedAt && (
                    <span className="ml-4">
                      Completed: {new Date(job.completedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              )}

              {/* Error Message */}
              {job.errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {job.errorMessage}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default RealTimeProgress;