import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, STALE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ScrapingJob, Language } from "@shared/types";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Play,
  Search,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  Database,
  Globe,
  BarChart3,
  RefreshCw,
} from "lucide-react";

type WordCoverage = {
  languageId: string;
  languageName: string;
  familyId: string;
  wordCount: number;
  totalBaseWords: number;
  coveragePercent: number;
};

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    running: { className: "bg-blue-500 text-white", label: "Running" },
    completed: { className: "bg-green-500 text-white", label: "Completed" },
    failed: { className: "bg-red-500 text-white", label: "Failed" },
    pending: { className: "bg-yellow-500 text-white", label: "Pending" },
  };
  const v = variants[status] ?? { className: "bg-gray-500 text-white", label: status };
  return <Badge className={v.className}>{v.label}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-500" />;
    default:
      return <Activity className="h-4 w-4 text-gray-500" />;
  }
}

function formatDuration(startedAt: string | null | undefined, completedAt: string | null | undefined): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export default function ScraperDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [languageSearch, setLanguageSearch] = useState("");
  const [selectedLanguageId, setSelectedLanguageId] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<"all" | "scraped" | "unscraped">("all");

  // Queries
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<ScrapingJob[]>({
    queryKey: ["/api/scraping-jobs"],
    refetchInterval: 2000,
    staleTime: STALE_TIMES.realtime,
  });

  const { data: coverage = [], isLoading: coverageLoading } = useQuery<WordCoverage[]>({
    queryKey: ["/api/scraping/coverage"],
    staleTime: STALE_TIMES.derived,
  });

  const { data: stats } = useQuery<{
    totalLanguages: number;
    baseWords: number;
    totalFamilies: number;
    totalSubfamilies: number;
  }>({
    queryKey: ["/api/stats"],
    staleTime: STALE_TIMES.static,
  });

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ["/api/languages"],
    staleTime: STALE_TIMES.static,
  });

  // Mutations
  const wordScrapeMutation = useMutation({
    mutationFn: async ({ languageId, languageName }: { languageId: string; languageName: string }) => {
      const res = await apiRequest("POST", "/api/scraping/words", {
        languageId,
        languageName,
        dataSources: ["gemini"],
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraping-jobs"] });
      toast({ title: "Scraping Started", description: "Word list scraping has been queued." });
      setSelectedLanguageId("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start scraping job.", variant: "destructive" });
    },
  });

  const familyScrapeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scraping/families", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scraping-jobs"] });
      toast({ title: "Scraping Started", description: "Language family scraping has been queued." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to start family scraping.", variant: "destructive" });
    },
  });

  // Derived data
  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "pending");
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const failedJobs = jobs.filter((j) => j.status === "failed");

  const availableLanguages = languages.filter((l) => !l.isHistoricalVariant && l.status === "living");

  const filteredLanguages = useMemo(() => {
    if (!languageSearch.trim()) return availableLanguages;
    const q = languageSearch.toLowerCase();
    return availableLanguages.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName?.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q)
    );
  }, [availableLanguages, languageSearch]);

  const filteredCoverage = useMemo(() => {
    let items = coverage;
    if (coverageFilter === "scraped") items = items.filter((c) => c.wordCount > 0);
    if (coverageFilter === "unscraped") items = items.filter((c) => c.wordCount === 0);
    return items;
  }, [coverage, coverageFilter]);

  const coverageSummary = useMemo(() => {
    const scraped = coverage.filter((c) => c.wordCount > 0).length;
    const total = coverage.length;
    return { scraped, total, percent: total > 0 ? Math.round((scraped / total) * 100) : 0 };
  }, [coverage]);

  const handleStartWordScraping = () => {
    if (!selectedLanguageId) return;
    const lang = availableLanguages.find((l) => l.id === selectedLanguageId);
    if (!lang) return;
    wordScrapeMutation.mutate({ languageId: lang.id, languageName: lang.name });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="back-button">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold" data-testid="page-title">Scraper Orchestration</h1>
              <p className="text-sm text-muted-foreground">Manage and monitor data scraping operations</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/scraping-jobs"] });
              queryClient.invalidateQueries({ queryKey: ["/api/scraping/coverage"] });
            }}
            data-testid="refresh-button"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="summary-cards">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Jobs</CardDescription>
              <CardTitle className="text-2xl" data-testid="active-jobs-count">
                {activeJobs.length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-sm text-muted-foreground">
                <Activity className="h-4 w-4 mr-1 text-blue-500" />
                {activeJobs.length > 0 ? "Scraping in progress" : "No active jobs"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Languages Scraped</CardDescription>
              <CardTitle className="text-2xl" data-testid="scraped-count">
                {coverageSummary.scraped} / {coverageSummary.total}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={coverageSummary.percent} className="h-2" />
              <p className="text-sm text-muted-foreground mt-1">{coverageSummary.percent}% coverage</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed Jobs</CardDescription>
              <CardTitle className="text-2xl" data-testid="completed-count">
                {completedJobs.length}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                {failedJobs.length} failed
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Base Words</CardDescription>
              <CardTitle className="text-2xl" data-testid="base-words-count">
                {stats?.baseWords ?? 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-sm text-muted-foreground">
                <Database className="h-4 w-4 mr-1" />
                {stats?.totalFamilies ?? 0} language families
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Active Jobs */}
        {activeJobs.length > 0 && (
          <Card data-testid="active-jobs-section">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                Active Jobs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeJobs.map((job) => {
                const pct =
                  job.completedWords && job.totalWords
                    ? Math.round((job.completedWords / job.totalWords) * 100)
                    : 0;
                return (
                  <div key={job.id} className="border rounded-lg p-4 space-y-3" data-testid={`active-job-${job.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusIcon status={job.status} />
                        <span className="font-medium">{job.languageId}</span>
                        <StatusBadge status={job.status} />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {job.completedWords ?? 0} / {job.totalWords ?? 0} words
                      </span>
                    </div>
                    {job.statusMessage && (
                      <p className="text-sm text-muted-foreground italic">{job.statusMessage}</p>
                    )}
                    <div className="flex items-center gap-3">
                      <Progress value={pct} className="h-2 flex-1" />
                      <span className="text-sm font-medium w-12 text-right">{pct}%</span>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Duration: {formatDuration(job.startedAt, job.completedAt)}</span>
                      {job.dataSource && <span>Source: {job.dataSource}</span>}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="trigger" className="space-y-4">
          <TabsList data-testid="dashboard-tabs">
            <TabsTrigger value="trigger" data-testid="tab-trigger">
              <Play className="h-4 w-4 mr-2" />
              Start Scraping
            </TabsTrigger>
            <TabsTrigger value="coverage" data-testid="tab-coverage">
              <BarChart3 className="h-4 w-4 mr-2" />
              Data Coverage
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <Clock className="h-4 w-4 mr-2" />
              Job History
            </TabsTrigger>
          </TabsList>

          {/* Trigger Tab */}
          <TabsContent value="trigger">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Word Scraping */}
              <Card data-testid="word-scraping-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Scrape Word Lists
                  </CardTitle>
                  <CardDescription>
                    Scrape translations for base vocabulary words using Gemini AI
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Search Languages</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Search by name or code..."
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        className="pl-9"
                        data-testid="language-search"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Select Language</label>
                    <Select value={selectedLanguageId} onValueChange={setSelectedLanguageId}>
                      <SelectTrigger data-testid="language-select">
                        <SelectValue placeholder="Choose a language..." />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredLanguages.map((lang) => (
                          <SelectItem key={lang.id} value={lang.id}>
                            {lang.name} ({lang.id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={handleStartWordScraping}
                    disabled={!selectedLanguageId || wordScrapeMutation.isPending}
                    className="w-full"
                    data-testid="start-word-scraping"
                  >
                    {wordScrapeMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Start Word Scraping
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Family Scraping */}
              <Card data-testid="family-scraping-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Scrape Language Families
                  </CardTitle>
                  <CardDescription>
                    Discover and organize language family hierarchies using Gemini AI
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-amber-50 p-3 rounded-lg text-sm text-amber-800">
                    <p className="font-medium mb-1">What this does:</p>
                    <ul className="text-xs space-y-1">
                      <li>- Discovers language families and their hierarchies</li>
                      <li>- Identifies languages within each family</li>
                      <li>- Adds geographic and speaker data</li>
                    </ul>
                  </div>
                  <Button
                    onClick={() => familyScrapeMutation.mutate()}
                    disabled={familyScrapeMutation.isPending}
                    className="w-full"
                    variant="secondary"
                    data-testid="start-family-scraping"
                  >
                    {familyScrapeMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Start Family Scraping
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Coverage Tab */}
          <TabsContent value="coverage">
            <Card data-testid="coverage-section">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Word Data Coverage</CardTitle>
                    <CardDescription>
                      {coverageSummary.scraped} of {coverageSummary.total} languages have word data
                    </CardDescription>
                  </div>
                  <Select
                    value={coverageFilter}
                    onValueChange={(v) => setCoverageFilter(v as "all" | "scraped" | "unscraped")}
                  >
                    <SelectTrigger className="w-40" data-testid="coverage-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Languages</SelectItem>
                      <SelectItem value="scraped">With Data</SelectItem>
                      <SelectItem value="unscraped">No Data</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {coverageLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Language</TableHead>
                          <TableHead>Family</TableHead>
                          <TableHead className="text-right">Words</TableHead>
                          <TableHead className="text-right">Coverage</TableHead>
                          <TableHead className="w-32">Progress</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCoverage.map((item) => (
                          <TableRow key={item.languageId} data-testid={`coverage-row-${item.languageId}`}>
                            <TableCell className="font-medium">
                              {item.languageName}
                              <span className="text-xs text-muted-foreground ml-1">({item.languageId})</span>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{item.familyId}</TableCell>
                            <TableCell className="text-right">
                              {item.wordCount} / {item.totalBaseWords}
                            </TableCell>
                            <TableCell className="text-right">{item.coveragePercent}%</TableCell>
                            <TableCell>
                              <Progress value={item.coveragePercent} className="h-2" />
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredCoverage.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                              No languages match the current filter
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            <Card data-testid="history-section">
              <CardHeader>
                <CardTitle>Job History</CardTitle>
                <CardDescription>
                  {jobs.length} total jobs ({completedJobs.length} completed, {failedJobs.length} failed)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {jobsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : jobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No scraping jobs yet. Start one from the "Start Scraping" tab.
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Language</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Words</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Started</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.map((job) => (
                          <TableRow key={job.id} data-testid={`job-row-${job.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <StatusIcon status={job.status} />
                                <StatusBadge status={job.status} />
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">{job.languageId}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {job.dataSource ?? "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {job.completedWords ?? 0} / {job.totalWords ?? 0}
                              {(job.failedWords ?? 0) > 0 && (
                                <span className="text-red-500 text-xs ml-1">({job.failedWords} failed)</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {formatDuration(job.startedAt, job.completedAt)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {job.startedAt
                                ? new Date(job.startedAt).toLocaleString()
                                : job.createdAt
                                  ? new Date(job.createdAt).toLocaleString()
                                  : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
