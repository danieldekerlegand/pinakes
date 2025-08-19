import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, Database, Globe, TreePine } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function LanguageFamilyScraper() {
  const [isScrapingInProgress, setIsScrapingInProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStatus, setCurrentStatus] = useState("");
  const { toast } = useToast();

  const startLanguageFamilyTreeScraping = async () => {
    setIsScrapingInProgress(true);
    setProgress(0);
    setCurrentStatus("Initializing language family tree scraping...");

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 10;
        });
      }, 500);

      setCurrentStatus("Scraping comprehensive language families from multiple sources...");
      
      const response = await apiRequest("/api/scrape-language-families", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      clearInterval(progressInterval);
      setProgress(100);
      setCurrentStatus("Language family tree scraping completed successfully!");

      toast({
        title: "Scraping Complete",
        description: "Successfully scraped and updated the language family tree database with comprehensive linguistic data.",
      });

      // Refresh the page after a brief delay to show updated data
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (error) {
      setCurrentStatus("Failed to complete language family tree scraping");
      toast({
        title: "Scraping Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred during scraping",
        variant: "destructive",
      });
    } finally {
      setIsScrapingInProgress(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TreePine className="h-5 w-5" />
          Language Family Tree Scraper
        </CardTitle>
        <CardDescription>
          Programmatically build a comprehensive database of world language families by scraping 
          linguistic data from multiple authoritative sources including Ethnologue, Glottolog, and Wikipedia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" />
            <span>Ethnologue Data</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="h-4 w-4" />
            <span>Glottolog Classification</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TreePine className="h-4 w-4" />
            <span>Wikipedia Families</span>
          </div>
        </div>

        {isScrapingInProgress && (
          <div className="space-y-3">
            <div className="text-sm font-medium">{currentStatus}</div>
            <Progress value={progress} className="w-full" />
            <div className="text-xs text-muted-foreground">
              Building comprehensive language family taxonomy from multiple linguistic sources...
            </div>
          </div>
        )}

        <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2">
          <h4 className="font-medium">What this scraper will do:</h4>
          <ul className="space-y-1 text-muted-foreground">
            <li>• Scrape major language families from Ethnologue, Glottolog, and Wikipedia</li>
            <li>• Build hierarchical taxonomic structure (phylum → family → subfamily → branch)</li>
            <li>• Include all 7,111+ world languages organized by genetic relationships</li>
            <li>• Add geographic distribution and speaker statistics</li>
            <li>• Focus on preserving endangered and Native American languages</li>
          </ul>
        </div>

        <Button 
          onClick={startLanguageFamilyTreeScraping}
          disabled={isScrapingInProgress}
          className="w-full"
          data-testid="button-start-scraping"
        >
          {isScrapingInProgress ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Scraping Language Families...
            </>
          ) : (
            <>
              <TreePine className="mr-2 h-4 w-4" />
              Start Language Family Tree Scraping
            </>
          )}
        </Button>

        <div className="text-xs text-muted-foreground text-center">
          This process will discover and organize thousands of world languages into their proper linguistic families.
          The resulting database will support comprehensive comparative linguistic research.
        </div>
      </CardContent>
    </Card>
  );
}