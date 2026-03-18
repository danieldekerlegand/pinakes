import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Link } from "wouter";
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
  Music,
  BookOpen,
  Type,
  Languages,
  ArrowLeftRight,
  Zap,
  Combine,
  Palette,
  Package,
  Compass,
  Share2,
  Check,
  Link2,
  MoreVertical,
  Eye,
  Moon,
  Pause,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { parseShareableState, useShareableState, generateShareableURL } from "@/hooks/useShareableState";
import { copyToClipboard } from "@/lib/visualization/export-utils";
import { useVisualization } from "@/contexts/VisualizationContext";
import { useHighContrast } from "@/hooks/use-high-contrast";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import StatsOverview from "@/components/stats-overview";
import FiltersSidebar from "@/components/filters-sidebar";
// import LanguageTree from "@/components/language-tree"; // Old tree component
import { LanguageFamilyVisualization } from "@/components/LanguageFamilyVisualization";
import LanguageDetailPanel from "@/components/language-detail-panel";
import WordComparisonPanel from "@/components/word-comparison";
import LinguisticDistanceAnalyzer from "@/components/linguistic-distance-analyzer";
import PhonologyPanel from "@/components/phonology-panel";
import GrammarPanel from "@/components/grammar-panel";
import WritingSystemsPanel from "@/components/writing-systems-panel";
import VerbParadigmsPanel from "@/components/verb-paradigms-panel";
import LanguageContactsPanel from "@/components/language-contacts-panel";
import SoundChangesPanel from "@/components/sound-changes-panel";
import CorrelationExplorerPanel from "@/components/correlation-explorer-panel";
import ArtTraditionsPanel from "@/components/art-traditions-panel";
import TradeGoodsPanel from "@/components/trade-goods-panel";
import GlobalSearchDialog from "@/components/global-search-dialog";
import ScrapingTriggerButton from "@/components/scraping-trigger-button";
import RealTimeProgress from "@/components/real-time-progress";
import ScrapingStatusBar from "@/components/scraping-status-bar";
import type { ScrapingJob } from "@shared/types";


// Panel name mapping for URL state
const PANEL_MAP: Record<string, string> = {
  comparison: 'comparison',
  distance: 'distance',
  phonology: 'phonology',
  grammar: 'grammar',
  writing: 'writing',
  verbs: 'verbs',
  contacts: 'contacts',
  sounds: 'sounds',
  correlation: 'correlation',
  art: 'art',
  trade: 'trade',
};

export default function Dashboard() {
  const [, navigate] = useLocation();
  // Parse URL state once on mount for panel/filter initialization
  const [initialUrlState] = useState(() => parseShareableState());

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguageId, setSelectedLanguageId] = useState<string | null>(
    initialUrlState.langDetail ?? null
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(initialUrlState.panel === 'comparison');
  const [distanceAnalyzerOpen, setDistanceAnalyzerOpen] = useState(initialUrlState.panel === 'distance');
  const [phonologyOpen, setPhonologyOpen] = useState(initialUrlState.panel === 'phonology');
  const [grammarOpen, setGrammarOpen] = useState(initialUrlState.panel === 'grammar');
  const [writingSystemsOpen, setWritingSystemsOpen] = useState(initialUrlState.panel === 'writing');
  const [verbParadigmsOpen, setVerbParadigmsOpen] = useState(initialUrlState.panel === 'verbs');
  const [languageContactsOpen, setLanguageContactsOpen] = useState(initialUrlState.panel === 'contacts');
  const [soundChangesOpen, setSoundChangesOpen] = useState(initialUrlState.panel === 'sounds');
  const [correlationExplorerOpen, setCorrelationExplorerOpen] = useState(initialUrlState.panel === 'correlation');
  const [artTraditionsOpen, setArtTraditionsOpen] = useState(initialUrlState.panel === 'art');
  const [tradeGoodsOpen, setTradeGoodsOpen] = useState(initialUrlState.panel === 'trade');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [scrapingMenuOpen, setScrapingMenuOpen] = useState(false);
  const [wordScrapingOpen, setWordScrapingOpen] = useState(false);
  const [expandAll, setExpandAll] = useState<number>(0);
  const [collapseAll, setCollapseAll] = useState<number>(0);
  const [filters, setFilters] = useState({
    status: initialUrlState.filterStatus ?? ["living", "endangered"] as string[],
    region: initialUrlState.filterRegion ?? "all-regions",
    speakers: "any",
  });
  const [linkCopied, setLinkCopied] = useState(false);
  const { toast } = useToast();
  const { state: vizState } = useVisualization();
  const { highContrast, toggleHighContrast } = useHighContrast();
  const { darkMode, toggleDarkMode } = useDarkMode();
  const { reducedMotion, toggleReducedMotion } = useReducedMotion();

  // Determine which panel is currently open (for URL state)
  const activePanel = useMemo(() => {
    if (comparisonOpen) return 'comparison';
    if (distanceAnalyzerOpen) return 'distance';
    if (phonologyOpen) return 'phonology';
    if (grammarOpen) return 'grammar';
    if (writingSystemsOpen) return 'writing';
    if (verbParadigmsOpen) return 'verbs';
    if (languageContactsOpen) return 'contacts';
    if (soundChangesOpen) return 'sounds';
    if (correlationExplorerOpen) return 'correlation';
    if (artTraditionsOpen) return 'art';
    if (tradeGoodsOpen) return 'trade';
    return undefined;
  }, [comparisonOpen, distanceAnalyzerOpen, phonologyOpen, grammarOpen, writingSystemsOpen, verbParadigmsOpen, languageContactsOpen, soundChangesOpen, correlationExplorerOpen, artTraditionsOpen, tradeGoodsOpen]);

  // Build shareable state and sync to URL
  const shareableState = useMemo(() => ({
    view: vizState.currentView,
    selectedLanguages: Array.from(vizState.selectedLanguageIds),
    selectedFamilies: Array.from(vizState.selectedFamilyIds),
    searchQuery: vizState.filters.searchQuery,
    filterStatus: filters.status,
    filterRegion: filters.region,
    year: vizState.temporal.currentYear,
    panel: activePanel,
    langDetail: selectedLanguageId ?? undefined,
  }), [vizState.currentView, vizState.selectedLanguageIds, vizState.selectedFamilyIds, vizState.filters.searchQuery, filters.status, filters.region, vizState.temporal.currentYear, activePanel, selectedLanguageId]);

  useShareableState(shareableState);

  // Copy link handler
  const handleCopyLink = async () => {
    const url = generateShareableURL(shareableState);
    const success = await copyToClipboard(url);
    if (success) {
      setLinkCopied(true);
      toast({ title: "Link copied!", description: "Shareable URL copied to clipboard" });
      setTimeout(() => setLinkCopied(false), 2000);
    } else {
      toast({ title: "Failed to copy", description: "Could not copy link to clipboard", variant: "destructive" });
    }
  };

  // Keyboard shortcuts: Cmd/Ctrl+K for search, Escape to close panels
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setGlobalSearchOpen((prev) => !prev);
      }

      // Escape closes any open panel or detail view
      if (e.key === "Escape") {
        if (selectedLanguageId) { setSelectedLanguageId(null); return; }
        if (comparisonOpen) { setComparisonOpen(false); return; }
        if (distanceAnalyzerOpen) { setDistanceAnalyzerOpen(false); return; }
        if (phonologyOpen) { setPhonologyOpen(false); return; }
        if (grammarOpen) { setGrammarOpen(false); return; }
        if (writingSystemsOpen) { setWritingSystemsOpen(false); return; }
        if (verbParadigmsOpen) { setVerbParadigmsOpen(false); return; }
        if (languageContactsOpen) { setLanguageContactsOpen(false); return; }
        if (soundChangesOpen) { setSoundChangesOpen(false); return; }
        if (correlationExplorerOpen) { setCorrelationExplorerOpen(false); return; }
        if (artTraditionsOpen) { setArtTraditionsOpen(false); return; }
        if (tradeGoodsOpen) { setTradeGoodsOpen(false); return; }
        if (sidebarOpen) { setSidebarOpen(false); return; }
      }

      // ? key shows keyboard shortcut help
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toast({
          title: "Keyboard Shortcuts",
          description: "⌘K: Search | Esc: Close panel | ?: This help",
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedLanguageId, comparisonOpen, distanceAnalyzerOpen, phonologyOpen, grammarOpen, writingSystemsOpen, verbParadigmsOpen, languageContactsOpen, soundChangesOpen, correlationExplorerOpen, artTraditionsOpen, tradeGoodsOpen, sidebarOpen]);

  // Handle navigation from global search results
  const handleSearchNavigate = (entityType: string, id: string, _linkPath: string) => {
    if (entityType === "language") {
      setSelectedLanguageId(id);
    } else if (entityType === "writing-system") {
      setWritingSystemsOpen(true);
    } else if (entityType === "art-tradition") {
      setArtTraditionsOpen(true);
    } else if (entityType === "trade-good") {
      setTradeGoodsOpen(true);
    } else if (entityType === "music-tradition" || entityType === "musical-instrument") {
      // No dedicated panel for these yet - show toast with info
      toast({ title: `${entityType}: ${id}`, description: `Navigate to ${_linkPath}` });
    } else if (entityType === "language-family") {
      // Could scroll to/highlight in tree - for now toast
      toast({ title: "Language Family", description: id });
    } else {
      toast({ title: entityType.replace(/-/g, " "), description: id });
    }
  };

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
      {/* Skip to content link for keyboard navigation */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      {/* Header */}
      <header className="bg-blue-600 text-white shadow-material-2 sticky top-0 z-50" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden p-2 text-white hover:bg-blue-700"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                data-testid="button-mobile-menu"
                aria-label={sidebarOpen ? "Close filters menu" : "Open filters menu"}
                aria-expanded={sidebarOpen}
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
              <h1 className="text-xl font-medium" data-testid="text-app-title">
                Linguistic Family Tree
              </h1>
            </div>
            <nav className="flex items-center space-x-1 md:space-x-2" aria-label="Main tools">
              <button
                onClick={() => setGlobalSearchOpen(true)}
                className="hidden md:flex items-center space-x-2 bg-blue-500 hover:bg-blue-400 text-white/90 rounded-md px-3 py-1.5 text-sm transition-colors w-64 justify-between"
                data-testid="input-search"
                aria-label="Search everything (Cmd+K)"
              >
                <span className="flex items-center space-x-2">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span>Search everything...</span>
                </span>
                <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-1 rounded border border-blue-400 bg-blue-600 px-1.5 font-mono text-[10px] font-medium text-white/70">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </button>
              {/* Mobile search button */}
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden p-2 text-white hover:bg-blue-700"
                onClick={() => setGlobalSearchOpen(true)}
                aria-label="Search"
              >
                <Search className="h-5 w-5" aria-hidden="true" />
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

              {/* Always visible: key tools */}
              <Button variant="ghost" size="sm" className="hidden lg:inline-flex p-2 text-white hover:bg-blue-700" onClick={() => setComparisonOpen(true)} aria-label="Word Comparison" title="Word Comparison"><GitCompare className="h-5 w-5" aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className="hidden lg:inline-flex p-2 text-white hover:bg-blue-700" onClick={() => setPhonologyOpen(true)} aria-label="Phonological Inventory" title="Phonology"><Music className="h-5 w-5" aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className="hidden lg:inline-flex p-2 text-white hover:bg-blue-700" onClick={() => setGrammarOpen(true)} aria-label="Grammar Comparison" title="Grammar"><BookOpen className="h-5 w-5" aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className="hidden xl:inline-flex p-2 text-white hover:bg-blue-700" onClick={() => setWritingSystemsOpen(true)} aria-label="Writing Systems" title="Writing Systems"><Type className="h-5 w-5" aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className="hidden xl:inline-flex p-2 text-white hover:bg-blue-700" onClick={() => setVerbParadigmsOpen(true)} aria-label="Verb Conjugations" title="Verb Conjugations"><Languages className="h-5 w-5" aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className="hidden xl:inline-flex p-2 text-white hover:bg-blue-700" onClick={() => setDistanceAnalyzerOpen(true)} aria-label="Linguistic Distance Analyzer" title="Distance Analyzer"><Network className="h-5 w-5" aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className={`p-2 text-white hover:bg-blue-700 ${darkMode ? 'ring-2 ring-white' : ''}`} onClick={toggleDarkMode} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={darkMode} title="Toggle dark mode">
                <Moon className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" className={`p-2 text-white hover:bg-blue-700 ${highContrast ? 'ring-2 ring-white' : ''}`} onClick={toggleHighContrast} aria-label={highContrast ? "Disable high contrast mode" : "Enable high contrast mode"} aria-pressed={highContrast} title="Toggle high contrast mode">
                <Eye className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" className={`p-2 text-white hover:bg-blue-700 ${reducedMotion ? 'ring-2 ring-white' : ''}`} onClick={toggleReducedMotion} aria-label={reducedMotion ? "Enable animations" : "Reduce animations"} aria-pressed={reducedMotion} title="Toggle reduced motion">
                <Pause className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="sm" className="p-2 text-white hover:bg-blue-700" onClick={handleCopyLink} aria-label={linkCopied ? "Link copied" : "Copy shareable link"} title="Copy shareable link">
                {linkCopied ? <Check className="h-5 w-5" aria-hidden="true" /> : <Link2 className="h-5 w-5" aria-hidden="true" />}
              </Button>

              {/* Overflow dropdown for remaining tools */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-2 text-white hover:bg-blue-700" aria-label="More tools">
                    <MoreVertical className="h-5 w-5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem className="lg:hidden" onClick={() => setComparisonOpen(true)}>
                    <GitCompare className="h-4 w-4 mr-2" aria-hidden="true" /> Word Comparison
                  </DropdownMenuItem>
                  <DropdownMenuItem className="lg:hidden" onClick={() => setPhonologyOpen(true)}>
                    <Music className="h-4 w-4 mr-2" aria-hidden="true" /> Phonology
                  </DropdownMenuItem>
                  <DropdownMenuItem className="lg:hidden" onClick={() => setGrammarOpen(true)}>
                    <BookOpen className="h-4 w-4 mr-2" aria-hidden="true" /> Grammar
                  </DropdownMenuItem>
                  <DropdownMenuItem className="xl:hidden" onClick={() => setWritingSystemsOpen(true)}>
                    <Type className="h-4 w-4 mr-2" aria-hidden="true" /> Writing Systems
                  </DropdownMenuItem>
                  <DropdownMenuItem className="xl:hidden" onClick={() => setVerbParadigmsOpen(true)}>
                    <Languages className="h-4 w-4 mr-2" aria-hidden="true" /> Verb Conjugations
                  </DropdownMenuItem>
                  <DropdownMenuItem className="xl:hidden" onClick={() => setDistanceAnalyzerOpen(true)}>
                    <Network className="h-4 w-4 mr-2" aria-hidden="true" /> Distance Analyzer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLanguageContactsOpen(true)}>
                    <ArrowLeftRight className="h-4 w-4 mr-2" aria-hidden="true" /> Language Contacts
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSoundChangesOpen(true)}>
                    <Zap className="h-4 w-4 mr-2" aria-hidden="true" /> Sound Changes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setArtTraditionsOpen(true)}>
                    <Palette className="h-4 w-4 mr-2" aria-hidden="true" /> Art Traditions
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTradeGoodsOpen(true)}>
                    <Package className="h-4 w-4 mr-2" aria-hidden="true" /> Trade Goods
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCorrelationExplorerOpen(true)}>
                    <Combine className="h-4 w-4 mr-2" aria-hidden="true" /> Correlation Explorer
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/stories" className="flex items-center">
                      <Compass className="h-4 w-4 mr-2" aria-hidden="true" /> Guided Stories
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings className="h-4 w-4 mr-2" aria-hidden="true" /> Settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          </div>
        </div>
      </header>

      <div className={`max-w-7xl mx-auto flex ${selectedLanguageId ? 'lg:mr-96' : ''}`}>
        {/* Sidebar */}
        <FiltersSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          filters={filters}
          onFiltersChange={setFilters}
        />

        {/* Main Content */}
        <main id="main-content" className="flex-1 p-3 md:p-6" role="main">
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

      {/* Phonological Inventory Comparison */}
      <PhonologyPanel
        isOpen={phonologyOpen}
        onClose={() => setPhonologyOpen(false)}
      />

      {/* Grammar Comparison Matrix */}
      <GrammarPanel
        isOpen={grammarOpen}
        onClose={() => setGrammarOpen(false)}
      />

      {/* Writing Systems Explorer */}
      <WritingSystemsPanel
        isOpen={writingSystemsOpen}
        onClose={() => setWritingSystemsOpen(false)}
      />

      {/* Verb Conjugation Comparison */}
      <VerbParadigmsPanel
        isOpen={verbParadigmsOpen}
        onClose={() => setVerbParadigmsOpen(false)}
      />

      {/* Language Contact Network */}
      <LanguageContactsPanel
        isOpen={languageContactsOpen}
        onClose={() => setLanguageContactsOpen(false)}
      />

      {/* Sound Changes Explorer */}
      <SoundChangesPanel
        isOpen={soundChangesOpen}
        onClose={() => setSoundChangesOpen(false)}
      />

      {/* Art Traditions Explorer */}
      <ArtTraditionsPanel
        isOpen={artTraditionsOpen}
        onClose={() => setArtTraditionsOpen(false)}
      />

      {/* Trade Goods Explorer */}
      <TradeGoodsPanel
        isOpen={tradeGoodsOpen}
        onClose={() => setTradeGoodsOpen(false)}
      />

      {/* Correlation Explorer */}
      <CorrelationExplorerPanel
        isOpen={correlationExplorerOpen}
        onClose={() => setCorrelationExplorerOpen(false)}
      />

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
          className="bg-purple-600 hover:bg-purple-700 text-white p-4 rounded-full shadow-material-3 transition-all duration-200 hover:scale-105"
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
