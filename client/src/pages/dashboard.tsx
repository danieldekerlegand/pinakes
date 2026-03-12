import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Settings,
  Menu,
  TreePine,
  GitCompare,
  Sparkles,
  Database,
  Plus,
  X,
  Network,
  FileText,
  BookOpen
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import StatsOverview from "@/components/stats-overview";
import FiltersSidebar from "@/components/filters-sidebar";
// import LanguageTree from "@/components/language-tree"; // Old tree component
import { LanguageFamilyVisualization } from "@/components/LanguageFamilyVisualization";
import LanguageDetailPanel from "@/components/language-detail-panel";
import WordComparisonPanel from "@/components/word-comparison";
import LinguisticDistanceAnalyzer from "@/components/linguistic-distance-analyzer";
import ScrapingTriggerButton from "@/components/scraping-trigger-button";
import RealTimeProgress from "@/components/real-time-progress";
import ScrapingStatusBar from "@/components/scraping-status-bar";
import type { ScrapingJob } from "@shared/types";


export default function Dashboard() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguageId, setSelectedLanguageId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [distanceAnalyzerOpen, setDistanceAnalyzerOpen] = useState(false);
  const [scrapingMenuOpen, setScrapingMenuOpen] = useState(false);
  const [wordScrapingOpen, setWordScrapingOpen] = useState(false);
  const [expandAll, setExpandAll] = useState<number>(0);
  const [collapseAll, setCollapseAll] = useState<number>(0);
  const [filters, setFilters] = useState({
    status: ["living", "endangered"] as string[],
    region: "all-regions",
    speakers: "any",
  });
  const { toast } = useToast();

  // Fetch scraping jobs for progress tracking
  const { data: scrapingJobs = [] } = useQuery<ScrapingJob[]>({
    queryKey: ['/api/scraping-jobs'],
    refetchInterval: 2000, // Poll every 2 seconds
  });

  const activeJobs = scrapingJobs.filter(job => job.status === 'running' || job.status === 'pending');

  const handleScrapeFamilies = async () => {
    try {
      const response = await fetch("/api/scraping/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearExisting: false }),
      });

      if (!response.ok) {
        throw new Error("Failed to start scraping");
      }

      toast({
        title: "Scraping Started",
        description: "Language family scraping has been started using Gemini AI. Check the console for progress.",
      });

      setScrapingMenuOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to start language family scraping",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="bg-blue-600 text-white shadow-material-2 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden p-2 text-white hover:bg-blue-700"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-medium" data-testid="text-app-title">
                Linguistic Family Tree
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative hidden md:block">
                <Input
                  type="text"
                  placeholder="Search languages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white text-gray-900 placeholder-gray-500 border border-gray-300 w-64 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  data-testid="input-search"
                />
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                onClick={() => setComparisonOpen(true)}
                data-testid="button-compare-languages"
                title="Word Comparison"
              >
                <GitCompare className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                onClick={() => navigate("/text-analyzer")}
                data-testid="button-text-analyzer"
                title="Text Analyzer"
              >
                <FileText className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                onClick={() => navigate("/word-etymology")}
                data-testid="button-word-etymology"
                title="Word Etymology"
              >
                <BookOpen className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                onClick={() => setDistanceAnalyzerOpen(true)}
                data-testid="button-distance-analyzer"
                title="Linguistic Distance Analyzer"
              >
                <Network className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                data-testid="button-settings"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className={`max-w-7xl mx-auto flex ${selectedLanguageId ? 'mr-96' : ''}`}>
        {/* Sidebar */}
        <FiltersSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          filters={filters}
          onFiltersChange={setFilters}
        />

        {/* Main Content */}
        <main className="flex-1 p-6">
          <StatsOverview />

          {/* Scraping Progress */}
          {activeJobs.length > 0 && (
            <div className="mt-6">
              <RealTimeProgress activeJobs={activeJobs} />
            </div>
          )}

          <div className="bg-white rounded-lg shadow-material-1 mt-8">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-medium text-gray-900" data-testid="text-tree-title">
                  Language Family Tree
                </h2>
                <div className="flex space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:bg-blue-50"
                    data-testid="button-expand-all"
                    onClick={() => {
                      const timestamp = Date.now();
                      setCollapseAll(0);
                      setExpandAll(timestamp);
                    }}
                  >
                    Expand All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-primary hover:bg-blue-50"
                    data-testid="button-collapse-all"
                    onClick={() => {
                      const timestamp = Date.now();
                      setExpandAll(0);
                      setCollapseAll(timestamp);
                    }}
                  >
                    Collapse All
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-6">
              <LanguageFamilyVisualization
                selectedLanguageId={selectedLanguageId}
                onLanguageSelect={setSelectedLanguageId}
              />
              {/* Old tree component (commented out - can be restored if needed)
              <LanguageTree
                searchQuery={searchQuery}
                filters={filters}
                selectedLanguageId={selectedLanguageId}
                onLanguageSelect={setSelectedLanguageId}
                onRefresh={() => {
                  // Refresh the language tree data
                  window.location.reload();
                }}
                expandAll={expandAll}
                collapseAll={collapseAll}
              />
              */}
            </div>
          </div>
        </main>
      </div>

      {/* Language Detail Panel */}
      {selectedLanguageId && (
        <LanguageDetailPanel
          languageId={selectedLanguageId}
          onClose={() => setSelectedLanguageId(null)}
        />
      )}

      {/* Word Comparison Panel */}
      <WordComparisonPanel
        isOpen={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
      />

      {/* Linguistic Distance Analyzer */}
      <LinguisticDistanceAnalyzer
        isOpen={distanceAnalyzerOpen}
        onClose={() => setDistanceAnalyzerOpen(false)}
      />

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          onClick={() => setScrapingMenuOpen(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white p-4 rounded-full shadow-material-3 transition-all duration-200 hover:scale-105"
          data-testid="button-floating-action"
          title="Scrape New Data"
        >
          <Sparkles className="h-6 w-6" />
        </Button>
      </div>

      {/* Scraping Menu Dialog */}
      <Dialog open={scrapingMenuOpen} onOpenChange={setScrapingMenuOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <span>Scrape New Data</span>
            </DialogTitle>
            <DialogDescription>
              Use AI or linguistic databases to expand your language database
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            <Card
              className="p-4 cursor-pointer hover:bg-purple-50 border-2 hover:border-purple-300 transition-colors"
              onClick={handleScrapeFamilies}
            >
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <TreePine className="h-5 w-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">Scrape Language Families</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Use Gemini AI to generate comprehensive language family trees
                  </p>
                  <div className="flex items-center space-x-2 mt-2">
                    <Sparkles className="h-3 w-3 text-purple-600" />
                    <span className="text-xs text-purple-600 font-medium">Powered by Gemini AI</span>
                  </div>
                </div>
              </div>
            </Card>

            <Card
              className="p-4 cursor-pointer hover:bg-blue-50 border-2 hover:border-blue-300 transition-colors"
              onClick={() => {
                setScrapingMenuOpen(false);
                // Open the scraping modal directly by triggering the button click
                setTimeout(() => {
                  const scrapingButton = document.querySelector('[data-testid="button-trigger-scraping"]') as HTMLButtonElement;
                  scrapingButton?.click();
                }, 100);
              }}
            >
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Database className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">Scrape Word Lists</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Select a language to scrape word translations from linguistic APIs
                  </p>
                  <div className="flex items-center space-x-2 mt-2">
                    <Sparkles className="h-3 w-3 text-blue-600" />
                    <span className="text-xs text-blue-600 font-medium">Powered by Gemini AI</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="mt-4 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setScrapingMenuOpen(false)}
              className="w-full"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Word Scraping Dialog - now opens directly */}
      <ScrapingTriggerButton />

      {/* Scraping Status Bar */}
      <ScrapingStatusBar />
    </div>
  );
}
