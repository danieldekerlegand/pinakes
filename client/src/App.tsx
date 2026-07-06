import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VisualizationProvider } from "@/contexts/VisualizationContext";
import { I18nProvider } from "@/contexts/I18nContext";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TextAnalyzer from "@/pages/text-analyzer";
import WordEtymology from "@/pages/word-etymology";
import StoriesPage from "@/pages/stories";
import EmbedPage from "@/pages/embed";
import QuizPage from "@/pages/quiz";
import SharedQuizResultPage from "@/pages/shared-quiz-result";
import ScraperDashboard from "@/pages/scraper-dashboard";
import DataExplorer from "@/pages/data-explorer";
import CivilizationTimeline from "@/pages/civilization-timeline";
import MesopotamiaShowcasePage from "@/pages/mesopotamia-showcase";
import CultureProfileReportPage from "@/pages/culture-profile-report";
import EntityPage from "@/pages/entity";
// Advanced/experimental graph research console — intentionally NOT linked from the
// primary navigation; reachable only via its direct route (US-011).
import AdvancedToolsPage from "@/pages/advanced-tools";
import CollectionsPage, { SharedCollectionPage } from "@/pages/collections";
import AiReviewPage from "@/pages/ai-review";
import AncestryPage from "@/pages/ancestry";
import HypothesesPage from "@/pages/hypotheses";
import { OfflineIndicator } from "@/components/OfflineIndicator";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/explore" component={DataExplorer} />
      <Route path="/embed" component={EmbedPage} />
      <Route path="/text-analyzer" component={TextAnalyzer} />
      <Route path="/word-etymology" component={WordEtymology} />
      <Route path="/stories" component={StoriesPage} />
      <Route path="/stories/:id" component={StoriesPage} />
      <Route path="/quiz" component={QuizPage} />
      {/* Read-only shared quiz result (US-007) — score summary embedded in the token. */}
      <Route path="/shared/quiz/:token" component={SharedQuizResultPage} />
      <Route path="/scraper" component={ScraperDashboard} />
      <Route path="/civilization-timeline" component={CivilizationTimeline} />
      <Route path="/mesopotamia" component={MesopotamiaShowcasePage} />
      <Route path="/culture-profile/:id/report" component={CultureProfileReportPage} />
      {/* Canonical, citable per-entity URLs (US-009) — one permanent route for every
          major entity type; resolves via /api/entity/:domain/:id, 404s gracefully. */}
      <Route path="/entity/:domain/:id" component={EntityPage} />
      <Route path="/advanced-tools" component={AdvancedToolsPage} />
      {/* Collaborative collections (US-007) — list/detail + read-only share view. */}
      <Route path="/collections" component={CollectionsPage} />
      <Route path="/collections/:id" component={CollectionsPage} />
      <Route path="/shared/collection/:token" component={SharedCollectionPage} />
      {/* AI-extraction review queue (US-009) — accept/edit/reject AI drafts. */}
      <Route path="/ai-review" component={AiReviewPage} />
      {/* DNA-to-culture ancestry mapper (US-001) — in-browser raw-DNA parsing +
          haplogroup inference; only haplogroup ids are sent to /api/ancestry/map. */}
      <Route path="/ancestry" component={AncestryPage} />
      {/* Automated hypothesis & site-location generation (US-007) — generated,
          speculative leads: shared-ancestry clusters + predicted undiscovered-site
          regions rendered as map overlays with uncertainty. */}
      <Route path="/hypotheses" component={HypothesesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TooltipProvider>
          <VisualizationProvider>
            <Toaster />
            <OfflineIndicator />
            <Router />
          </VisualizationProvider>
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export default App;
