import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VisualizationProvider } from "@/contexts/VisualizationContext";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TextAnalyzer from "@/pages/text-analyzer";
import WordEtymology from "@/pages/word-etymology";
import StoriesPage from "@/pages/stories";
import EmbedPage from "@/pages/embed";
import QuizPage from "@/pages/quiz";
import ScraperDashboard from "@/pages/scraper-dashboard";
import DataExplorer from "@/pages/data-explorer";
import CivilizationTimeline from "@/pages/civilization-timeline";
import MesopotamiaShowcasePage from "@/pages/mesopotamia-showcase";
import CultureProfileReportPage from "@/pages/culture-profile-report";
// Advanced/experimental graph research console — intentionally NOT linked from the
// primary navigation; reachable only via its direct route (US-011).
import AdvancedToolsPage from "@/pages/advanced-tools";

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
      <Route path="/scraper" component={ScraperDashboard} />
      <Route path="/civilization-timeline" component={CivilizationTimeline} />
      <Route path="/mesopotamia" component={MesopotamiaShowcasePage} />
      <Route path="/culture-profile/:id/report" component={CultureProfileReportPage} />
      <Route path="/advanced-tools" component={AdvancedToolsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VisualizationProvider>
          <Toaster />
          <Router />
        </VisualizationProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
