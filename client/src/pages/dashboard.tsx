import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Settings, Menu, GitCompare } from "lucide-react";
import StatsOverview from "@/components/stats-overview";
import FiltersSidebar from "@/components/filters-sidebar";
import LanguageTree from "@/components/language-tree";
import LanguageDetailPanel from "@/components/language-detail-panel";
import ScrapingStatusBar from "@/components/scraping-status-bar";
import WordComparisonPanel from "@/components/word-comparison";
import ScrapingTriggerButton from "@/components/scraping-trigger-button";
import LanguageMap from "@/components/language-map";
import RealTimeProgress from "@/components/real-time-progress";
import type { ScrapingJob } from "@shared/schema";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguageId, setSelectedLanguageId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [filters, setFilters] = useState({
    status: ["living", "endangered"] as string[],
    region: "",
    speakers: "",
  });

  // Fetch scraping jobs for real-time progress tracking
  const { data: scrapingJobs = [], refetch: refetchJobs } = useQuery<ScrapingJob[]>({
    queryKey: ['/api/scraping-jobs'],
    refetchInterval: 1000, // Poll every 1 second for active jobs
  });

  // Filter for active jobs
  const activeJobs = scrapingJobs.filter(job => 
    job.status === 'running' || job.status === 'pending'
  );

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
              <ScrapingTriggerButton />
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                onClick={() => setMapOpen(true)}
                data-testid="button-open-map"
              >
                <Search className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-blue-700"
                onClick={() => setComparisonOpen(true)}
                data-testid="button-compare-words"
              >
                <GitCompare className="h-5 w-5" />
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

      <div className="max-w-7xl mx-auto flex">
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
                  >
                    Expand All
                  </Button>
                  <Button
                    variant="ghost" 
                    size="sm"
                    className="text-primary hover:bg-blue-50"
                    data-testid="button-collapse-all"
                  >
                    Collapse All
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-6">
              <LanguageTree
                searchQuery={searchQuery}
                filters={filters}
                selectedLanguageId={selectedLanguageId}
                onLanguageSelect={setSelectedLanguageId}
              />
            </div>
          </div>
        </main>

        {/* Language Detail Panel */}
        {selectedLanguageId && (
          <LanguageDetailPanel
            languageId={selectedLanguageId}
            onClose={() => setSelectedLanguageId(null)}
          />
        )}
      </div>

      {/* Scraping Status Bar with Real-Time Progress */}
      <ScrapingStatusBar />
      
      {/* Real-Time Progress Display */}
      {activeJobs.length > 0 && (
        <div className="fixed bottom-24 right-6 z-40 max-w-md">
          <RealTimeProgress 
            activeJobs={activeJobs}
            onJobUpdate={(job) => {
              // Trigger refetch of jobs when an update comes through WebSocket
              refetchJobs();
            }}
          />
        </div>
      )}
      
      {/* Word Comparison Panel */}
      <WordComparisonPanel
        isOpen={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
      />

      {/* Language Map */}
      <LanguageMap
        isOpen={mapOpen}
        onClose={() => setMapOpen(false)}
      />
      
      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          className="bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-material-3 transition-all duration-200 hover:scale-105"
          data-testid="button-floating-action"
        >
          <span className="text-xl">+</span>
        </Button>
      </div>
    </div>
  );
}
