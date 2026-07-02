import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Search,
  X,
  Sparkles,
  Database,
  TreePine,
  Moon,
  Filter,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  MapPin,
  Music,
  BookOpen,
  UtensilsCrossed,
  Landmark,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { parseShareableState, useShareableState, generateShareableURL } from "@/hooks/useShareableState";
import { copyToClipboard } from "@/lib/visualization/export-utils";
import { useVisualization } from "@/contexts/VisualizationContext";
import { useDarkMode } from "@/hooks/use-dark-mode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { LanguageFamilyVisualization } from "@/components/LanguageFamilyVisualization";
import { AppSidebar } from "@/components/AppSidebar";
import LanguageDetailPanel from "@/components/language-detail-panel";
import WordComparisonPanel from "@/components/word-comparison";
import LinguisticDistanceAnalyzer from "@/components/linguistic-distance-analyzer";
import PhonologyPanel from "@/components/phonology-panel";
import GrammarPanel from "@/components/grammar-panel";
import WritingSystemsPanel from "@/components/writing-systems-panel";
import VerbParadigmsPanel from "@/components/verb-paradigms-panel";
import CorrelationExplorerPanel from "@/components/correlation-explorer-panel";
import DataOverview from "@/pages/data-overview";
import MesopotamiaCityStatesShowcase from "@/components/mesopotamia-city-states-showcase";
import CultureDiscoveryFeed from "@/components/culture-discovery-feed";
import CultureProfilePanel from "@/components/culture-profile-panel";
import {
  loadRecentlyViewed,
  recordRecentlyViewed,
  saveRecentlyViewed,
} from "@/lib/culture-discovery-utils";
import UnifiedExplorer from "@/components/explorer/UnifiedExplorer";
import { ADAPTERS, getVisualization } from "@/lib/visualization/adapters/registry";
import { compatibleAdapters } from "@/lib/visualization/adapters/compatibility";
import GlobalSearchDialog from "@/components/global-search-dialog";
import ScrapingTriggerButton from "@/components/scraping-trigger-button";
import RealTimeProgress from "@/components/real-time-progress";
import ScrapingStatusBar from "@/components/scraping-status-bar";
import TextAnalyzer from "@/pages/text-analyzer";
import WordEtymology from "@/pages/word-etymology";
import type { ScrapingJob } from "@shared/types";
import type { ViewMode } from "@/lib/visualization/types";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [initialUrlState] = useState(() => parseShareableState());

  const [selectedLanguageId, setSelectedLanguageId] = useState<string | null>(
    initialUrlState.langDetail ?? null
  );

  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [scrapingMenuOpen, setScrapingMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(
    initialUrlState.panel ?? null
  );
  const [etymologyWord, setEtymologyWord] = useState<string>("");
  const [etymologyLanguage, setEtymologyLanguage] = useState<string>("");
  const [selectedCultureId, setSelectedCultureId] = useState<string | null>(null);
  const [recentlyViewedCultures, setRecentlyViewedCultures] = useState<string[]>([]);
  const [exploreInitialAdapterId, setExploreInitialAdapterId] = useState<string | undefined>(undefined);
  const [topLevelAdapterId, setTopLevelAdapterId] = useState<string>("language-families");

  useEffect(() => {
    setRecentlyViewedCultures(loadRecentlyViewed());
  }, []);

  const handleSelectCulture = useCallback((cultureId: string) => {
    setSelectedCultureId(cultureId);
    setRecentlyViewedCultures((prev) => {
      const next = recordRecentlyViewed(cultureId, prev);
      saveRecentlyViewed(next);
      return next;
    });
  }, []);

  const { toast } = useToast();
  const { state: vizState, updateFilters, setView } = useVisualization();
  const { darkMode, toggleDarkMode } = useDarkMode();

  const handleViewChange = useCallback((view: ViewMode) => {
    setActiveSection(null);
    setView(view);
  }, [setView]);

  // Adapters compatible with the current top-level visualization, used to
  // populate the dataset selector and to auto-fallback when the user picks a
  // view incompatible with the currently-selected dataset.
  const topLevelCompatibleAdapters = useMemo(() => {
    const viz = getVisualization(vizState.currentView);
    if (!viz) return ADAPTERS;
    return compatibleAdapters(viz, ADAPTERS);
  }, [vizState.currentView]);

  useEffect(() => {
    if (!topLevelCompatibleAdapters.some((a) => a.id === topLevelAdapterId)) {
      setTopLevelAdapterId("language-families");
    }
  }, [topLevelCompatibleAdapters, topLevelAdapterId]);

  const handleNavigateToEtymology = useCallback((word: string, language: string) => {
    setEtymologyWord(word);
    setEtymologyLanguage(language);
    setActiveSection('word-etymology');
  }, []);

  // Build shareable state and sync to URL
  const shareableState = useMemo(() => ({
    view: vizState.currentView,
    selectedLanguages: Array.from(vizState.selectedLanguageIds),
    selectedFamilies: Array.from(vizState.selectedFamilyIds),
    searchQuery: vizState.filters.searchQuery,
    filterStatus: vizState.filters.status,
    filterRegion: vizState.filters.region,
    year: vizState.temporal.currentYear,
    panel: activeSection ?? undefined,
    langDetail: selectedLanguageId ?? undefined,
  }), [vizState.currentView, vizState.selectedLanguageIds, vizState.selectedFamilyIds, vizState.filters.searchQuery, vizState.filters.status, vizState.filters.region, vizState.temporal.currentYear, activeSection, selectedLanguageId]);

  useShareableState(shareableState);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setGlobalSearchOpen((prev) => !prev);
      }

      if (e.key === "Escape") {
        if (selectedCultureId) { setSelectedCultureId(null); return; }
        if (selectedLanguageId) { setSelectedLanguageId(null); return; }
        if (activeSection) { setActiveSection(null); return; }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedLanguageId, selectedCultureId, activeSection]);

  // Handle navigation from global search results
  const handleSearchNavigate = (entityType: string, id: string, _linkPath: string) => {
    if (entityType === "language") {
      setSelectedLanguageId(id);
    } else if (entityType === "writing-system") {
      setActiveSection('writing');
    } else if (entityType === "art-tradition") {
      setExploreInitialAdapterId('art-traditions');
      setActiveSection('explore');
    } else if (entityType === "trade-good") {
      setExploreInitialAdapterId('trade-goods');
      setActiveSection('explore');
    } else if (entityType === "literary-tradition" || entityType === "literary-work") {
      setExploreInitialAdapterId('literary-traditions');
      setActiveSection('explore');
    } else if (entityType === "archaeological-culture") {
      setExploreInitialAdapterId('archaeological-cultures');
      setActiveSection('explore');
    } else if (entityType === "battle") {
      setExploreInitialAdapterId('battles');
      setActiveSection('explore');
    } else if (entityType === "music-tradition" || entityType === "musical-instrument") {
      toast({ title: `${entityType}: ${id}`, description: `Navigate to ${_linkPath}` });
    } else if (entityType === "language-family") {
      toast({ title: "Language Family", description: id });
    } else {
      toast({ title: entityType.replace(/-/g, " "), description: id });
    }
  };

  // Fetch scraping jobs for progress tracking
  const { data: scrapingJobs = [] } = useQuery<ScrapingJob[]>({
    queryKey: ['/api/scraping-jobs'],
    refetchInterval: 2000,
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

  const handleEnrichment = async (endpoint: string, label: string) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) throw new Error(`Failed to start ${label}`);

      const data = await response.json();
      toast({
        title: `${label} Started`,
        description: `Enrichment job started. ${data.totalLanguages ?? ''} languages queued.`,
      });
      setScrapingMenuOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to start ${label}`,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {/* Skip to content link for keyboard navigation */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      {/* Header — compact, full-width */}
      <header className="bg-blue-600 text-white shadow-sm flex-shrink-0 z-50" role="banner">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className="p-1.5 rounded-md hover:bg-blue-500 transition-colors"
              aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              title={`${sidebarCollapsed ? "Show" : "Hide"} sidebar (⌘B)`}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <h1 className="text-base font-medium" data-testid="text-app-title">
              Linguistic Family Tree
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <button
              onClick={() => setGlobalSearchOpen(true)}
              className="hidden md:flex items-center gap-2 bg-blue-500 hover:bg-blue-400 text-white/90 rounded-md px-3 py-1 text-sm transition-colors w-56 justify-between"
              data-testid="input-search"
              aria-label="Search everything (Cmd+K)"
            >
              <span className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Search...</span>
              </span>
              <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-1 rounded border border-blue-400 bg-blue-600 px-1.5 font-mono text-[10px] font-medium text-white/70">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
            {/* Mobile search */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden p-1.5 text-white hover:bg-blue-500"
              onClick={() => setGlobalSearchOpen(true)}
              aria-label="Search"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>
            {/* Dark mode */}
            <button
              className={`p-1.5 rounded-md hover:bg-blue-500 transition-colors ${darkMode ? 'ring-1 ring-white/50' : ''}`}
              onClick={toggleDarkMode}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              title="Toggle dark mode"
            >
              <Moon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0 z-40">
        <div className="flex items-center gap-3 h-9 px-4 text-sm">
          <button
            type="button"
            onClick={() => setActiveSection((prev) => (prev === 'discover' ? null : 'discover'))}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors ${activeSection === 'discover' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-700'}`}
            data-testid="button-discover-cultures"
            aria-pressed={activeSection === 'discover'}
          >
            <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Discover Cultures</span>
          </button>
          <div className="h-3 w-px bg-gray-300" aria-hidden="true" />

          {/* Dataset selector — filtered to adapters compatible with the current view */}
          <span className="text-[10px] uppercase tracking-wider text-gray-400 flex-shrink-0">Data</span>
          <Select
            value={topLevelAdapterId}
            onValueChange={(value) => setTopLevelAdapterId(value)}
          >
            <SelectTrigger className="w-auto h-6 border border-gray-200 shadow-none hover:bg-gray-50 text-gray-700 gap-1 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {topLevelCompatibleAdapters.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {topLevelAdapterId === "language-families" && (
            <>
          <div className="h-3 w-px bg-gray-300" aria-hidden="true" />
          <Filter className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" aria-hidden="true" />

          {/* Status filter popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-gray-100 text-gray-700 transition-colors text-xs">
                <span>Status</span>
                {vizState.filters.status.length > 0 && (
                  <span className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                    {vizState.filters.status.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3 text-gray-400" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-3" align="start">
              <div className="space-y-2">
                {[
                  { id: "living", label: "Living" },
                  { id: "endangered", label: "Endangered" },
                  { id: "extinct", label: "Extinct" },
                  { id: "proto", label: "Proto-language" },
                  { id: "historical", label: "Historical" },
                ].map((option) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`filter-status-${option.id}`}
                      checked={vizState.filters.status.includes(option.id)}
                      onCheckedChange={(checked) => {
                        const newStatus = checked
                          ? [...vizState.filters.status, option.id]
                          : vizState.filters.status.filter((s: string) => s !== option.id);
                        updateFilters({ status: newStatus });
                      }}
                    />
                    <label htmlFor={`filter-status-${option.id}`} className="text-sm text-gray-700 cursor-pointer">
                      {option.label}
                    </label>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Region filter */}
          <Select
            value={vizState.filters.region || "all-regions"}
            onValueChange={(value) => updateFilters({ region: value === "all-regions" ? "" : value })}
          >
            <SelectTrigger className="w-auto h-6 border-0 shadow-none hover:bg-gray-100 text-gray-700 gap-1 px-2 text-xs">
              <SelectValue placeholder="All Regions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-regions">All Regions</SelectItem>
              {["Europe", "Asia", "Africa", "North America", "South America", "Oceania", "Middle East"].map((region) => (
                <SelectItem key={region} value={region}>{region}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Active filter pills */}
          {(vizState.filters.status.length > 0 || vizState.filters.region) && (
            <>
              <div className="h-3 w-px bg-gray-300" />
              {vizState.filters.status.map((s: string) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded-full"
                >
                  {s}
                  <button
                    onClick={() => updateFilters({ status: vizState.filters.status.filter((x: string) => x !== s) })}
                    className="hover:text-blue-900"
                    aria-label={`Remove ${s} filter`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {vizState.filters.region && (
                <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] px-1.5 py-0.5 rounded-full">
                  {vizState.filters.region}
                  <button
                    onClick={() => updateFilters({ region: "" })}
                    className="hover:text-green-900"
                    aria-label="Remove region filter"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
              <button
                onClick={() => updateFilters({ status: [], region: "" })}
                className="text-[10px] text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
            </>
          )}
            </>
          )}
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <AppSidebar
            activeView={vizState.currentView}
            activeSection={activeSection}
            onViewChange={handleViewChange}
            onSectionChange={setActiveSection}
            onNavigate={navigate}
          />
        )}

        {/* Main content area */}
        <main id="main-content" className="flex-1 flex flex-col min-h-0 min-w-0" role="main">
          {/* Scraping Progress */}
          {activeJobs.length > 0 && (
            <div className="px-4 pt-3 flex-shrink-0">
              <RealTimeProgress activeJobs={activeJobs} />
            </div>
          )}

          {/* Content area — render active section, panel, or visualization */}
          <div className="flex-1 min-h-0">
            {activeSection === 'text-analyzer' ? (
              <TextAnalyzer embedded onNavigateToEtymology={handleNavigateToEtymology} />
            ) : activeSection === 'word-etymology' ? (
              <WordEtymology key={`${etymologyWord}-${etymologyLanguage}`} embedded initialWord={etymologyWord} initialLanguage={etymologyLanguage} />
            ) : activeSection === 'comparison' ? (
              <WordComparisonPanel isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'distance' ? (
              <LinguisticDistanceAnalyzer isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'phonology' ? (
              <PhonologyPanel isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'grammar' ? (
              <GrammarPanel isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'writing' ? (
              <WritingSystemsPanel isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'verbs' ? (
              <VerbParadigmsPanel isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'correlation' ? (
              <CorrelationExplorerPanel isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'mesopotamia' ? (
              <MesopotamiaCityStatesShowcase isOpen={true} onClose={() => setActiveSection(null)} embedded />
            ) : activeSection === 'explore' ? (
              <UnifiedExplorer initialAdapterId={exploreInitialAdapterId} />
            ) : activeSection === 'data-overview' ? (
              <DataOverview />
            ) : activeSection === 'discover' ? (
              <CultureDiscoveryFeed
                onSelectCulture={handleSelectCulture}
                recentlyViewedIds={recentlyViewedCultures}
              />
            ) : topLevelAdapterId === 'language-families' ? (
              <LanguageFamilyVisualization
                selectedLanguageId={selectedLanguageId}
                onLanguageSelect={setSelectedLanguageId}
              />
            ) : (
              <UnifiedExplorer
                key={`${topLevelAdapterId}-${vizState.currentView}`}
                initialAdapterId={topLevelAdapterId}
                initialVizId={vizState.currentView}
                hidePicker
              />
            )}
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

      {/* Culture Profile Panel */}
      {selectedCultureId && (
        <CultureProfilePanel
          cultureId={selectedCultureId}
          onClose={() => setSelectedCultureId(null)}
        />
      )}

      {/* Panels are now rendered inline in the main content area above */}

      {/* Global Search Dialog */}
      <GlobalSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        onNavigate={handleSearchNavigate}
      />

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          onClick={() => setScrapingMenuOpen(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white p-4 rounded-full shadow-lg transition-all duration-200 hover:scale-105"
          data-testid="button-floating-action"
          title="Scrape New Data"
          aria-label="Scrape New Data"
        >
          <Sparkles className="h-6 w-6" aria-hidden="true" />
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

          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Enrich Existing Data</p>
            <div className="space-y-2">
              <Card
                className="p-3 cursor-pointer hover:bg-emerald-50 border hover:border-emerald-300 transition-colors"
                onClick={() => handleEnrichment("/api/enrichment/languages", "Language Coordinates & Dates")}
              >
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 bg-emerald-100 rounded-lg">
                    <MapPin className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">Enrich Coordinates & Temporal Data</h3>
                    <p className="text-xs text-gray-500">Add lat/lng and time origin/end to all languages</p>
                  </div>
                </div>
              </Card>

              <Card
                className="p-3 cursor-pointer hover:bg-orange-50 border hover:border-orange-300 transition-colors"
                onClick={() => handleEnrichment("/api/enrichment/phonology", "Phonological Inventories")}
              >
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 bg-orange-100 rounded-lg">
                    <Music className="h-4 w-4 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">Enrich Phonological Inventories</h3>
                    <p className="text-xs text-gray-500">Add consonant/vowel inventories, syllable structure</p>
                  </div>
                </div>
              </Card>

              <Card
                className="p-3 cursor-pointer hover:bg-indigo-50 border hover:border-indigo-300 transition-colors"
                onClick={() => handleEnrichment("/api/enrichment/grammar", "Grammar Features")}
              >
                <div className="flex items-center space-x-3">
                  <div className="p-1.5 bg-indigo-100 rounded-lg">
                    <BookOpen className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-gray-900">Enrich Grammar Features</h3>
                    <p className="text-xs text-gray-500">Add word order, morphology, case/gender systems</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t">
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

      {/* Word Scraping Dialog */}
      <ScrapingTriggerButton />

      {/* Scraping Status Bar */}
      <ScrapingStatusBar />
    </div>
  );
}
