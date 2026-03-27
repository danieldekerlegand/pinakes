import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import TextAnalyzer from "@/pages/text-analyzer";
import WordEtymology from "@/pages/word-etymology";
import StoriesPage from "@/pages/stories";
import EmbedPage from "@/pages/embed";
import QuizPage from "@/pages/quiz";
import ScraperDashboard from "@/pages/scraper-dashboard";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/embed" component={EmbedPage} />
      <Route path="/text-analyzer" component={TextAnalyzer} />
      <Route path="/word-etymology" component={WordEtymology} />
      <Route path="/stories" component={StoriesPage} />
      <Route path="/stories/:id" component={StoriesPage} />
      <Route path="/quiz" component={QuizPage} />
      <Route path="/scraper" component={ScraperDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
