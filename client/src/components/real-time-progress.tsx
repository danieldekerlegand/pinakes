import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Loader2, Activity } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ScrapingProgress {
  jobId: string;
  status: string;
  completed: number;
  total: number;
  currentWord?: string;
  percentage?: number;
  errorMessage?: string;
}

interface ScrapingJob {
  id: string;
  languageId: string;
  status: string;
  totalWords: number | null;
  completedWords: number | null;
  failedWords: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date | null;
}

interface RealTimeProgressProps {
  activeJobs: ScrapingJob[];
  onJobUpdate?: (job: ScrapingJob) => void;
}

export function RealTimeProgress({ activeJobs, onJobUpdate }: RealTimeProgressProps) {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [progress, setProgress] = useState<Map<string, ScrapingProgress>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connectWebSocket = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        console.log('Connected to real-time progress updates');
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        console.log('Disconnected from real-time progress updates');
        
        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            setConnectionStatus('connecting');
            connectWebSocket();
          }
        }, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('disconnected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'scraping_progress') {
            setProgress(prev => {
              const newProgress = new Map(prev);
              newProgress.set(data.jobId, {
                jobId: data.jobId,
                status: data.status,
                completed: data.completed,
                total: data.total,
                currentWord: data.currentWord,
                percentage: data.percentage,
                errorMessage: data.errorMessage
              });
              return newProgress;
            });
          } else if (data.type === 'job_update' && onJobUpdate) {
            onJobUpdate(data.job);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [onJobUpdate]);

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

  if (activeJobs.length === 0 && progress.size === 0) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="real-time-progress">
      {/* Connection Status */}
      <div className="flex items-center gap-2 text-sm">
        <div 
          className={`h-2 w-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' : 
            connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
            'bg-red-500'
          }`}
        />
        <span className="text-muted-foreground">
          Live Progress: {connectionStatus === 'connected' ? 'Connected' : 
                         connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
        </span>
      </div>

      {/* Progress Cards */}
      {activeJobs.map(job => {
        const jobProgress = progress.get(job.id);
        const percentage = jobProgress?.percentage || 
                          (job.completedWords && job.totalWords ? 
                           Math.round((job.completedWords / job.totalWords) * 100) : 0);
        
        return (
          <Card key={job.id} className="w-full" data-testid={`progress-card-${job.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(jobProgress?.status || job.status)}
                  <CardTitle className="text-base">
                    Scraping Progress
                  </CardTitle>
                  <Badge 
                    variant="secondary" 
                    className={`text-white ${getStatusColor(jobProgress?.status || job.status)}`}
                  >
                    {jobProgress?.status || job.status}
                  </Badge>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  {jobProgress?.completed || job.completedWords || 0} / {jobProgress?.total || job.totalWords || 0} words
                </div>
              </div>
              <CardDescription>
                Language ID: {job.languageId}
                {jobProgress?.currentWord && (
                  <span className="ml-2 font-medium">
                    • Currently processing: "{jobProgress.currentWord}"
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
                    {jobProgress?.completed || job.completedWords || 0}
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
              {(jobProgress?.errorMessage || job.errorMessage) && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {jobProgress?.errorMessage || job.errorMessage}
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