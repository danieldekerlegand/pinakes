import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, Database, Layers, TreePine, GitBranch } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function DatabaseNormalizer() {
  const [isNormalizationInProgress, setIsNormalizationInProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStatus, setCurrentStatus] = useState("");
  const { toast } = useToast();

  const startDatabaseNormalization = async () => {
    setIsNormalizationInProgress(true);
    setProgress(0);
    setCurrentStatus("Initializing database normalization...");

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 15;
        });
      }, 800);

      setCurrentStatus("Analyzing current language families and hierarchical structure...");
      
      // Call the database normalization API
      const response = await apiRequest("/api/normalize-database", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      clearInterval(progressInterval);
      setProgress(100);
      setCurrentStatus("Database normalization completed successfully!");

      toast({
        title: "Normalization Complete",
        description: "Successfully normalized the database structure with proper taxonomic hierarchy: Phylum → Family → Subfamily → Branch → Group → Main Language → Historical Variants/Modern Dialects.",
      });

      // Refresh the page after a brief delay to show updated structure
      setTimeout(() => {
        window.location.reload();
      }, 3000);

    } catch (error) {
      setCurrentStatus("Failed to complete database normalization");
      toast({
        title: "Normalization Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred during normalization",
        variant: "destructive",
      });
    } finally {
      setIsNormalizationInProgress(false);
    }
  };

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Database Taxonomic Normalizer
        </CardTitle>
        <CardDescription>
          Transform the current flat language family structure into a properly normalized 
          linguistic taxonomy with clearly defined hierarchical tables for each taxonomic level.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-center gap-2 text-sm">
            <TreePine className="h-4 w-4 text-green-600" />
            <span className="font-medium">Phylum</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-blue-600" />
            <span className="font-medium">Family</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-purple-600" />
            <span className="font-medium">Subfamily</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-orange-600" />
            <span className="font-medium">Branch/Group</span>
          </div>
        </div>

        <div className="bg-blue-50 p-4 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">Normalization Process:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-blue-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span>Create separate tables for each taxonomic level</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span>Migrate existing language families to proper hierarchy</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span>Separate main languages, historical variants, and dialects</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span>Establish proper foreign key relationships</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span>Maintain data integrity and consistency</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                <span>Validate normalized structure</span>
              </div>
            </div>
          </div>
        </div>

        {isNormalizationInProgress && (
          <div className="space-y-3">
            <div className="text-sm font-medium">{currentStatus}</div>
            <Progress value={progress} className="w-full" />
            <div className="text-xs text-muted-foreground">
              Transforming database structure to align with linguistic taxonomic hierarchy...
            </div>
          </div>
        )}

        <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2">
          <h4 className="font-medium">Expected Results:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-muted-foreground">
            <ul className="space-y-1">
              <li>• Separate tables: phylums, families, subfamilies, branches, groups</li>
              <li>• Distinct tables: main_languages, historical_variants, modern_dialects</li>
              <li>• Proper hierarchical relationships with foreign keys</li>
            </ul>
            <ul className="space-y-1">
              <li>• Better data organization and query performance</li>
              <li>• Cleaner API endpoints for each taxonomic level</li>
              <li>• Improved UI with proper taxonomic navigation</li>
            </ul>
          </div>
        </div>

        <Button 
          onClick={startDatabaseNormalization}
          disabled={isNormalizationInProgress}
          className="w-full"
          data-testid="button-start-normalization"
        >
          {isNormalizationInProgress ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Normalizing Database Structure...
            </>
          ) : (
            <>
              <Database className="mr-2 h-4 w-4" />
              Start Database Normalization
            </>
          )}
        </Button>

        <div className="text-xs text-muted-foreground text-center">
          This process will restructure the database to properly separate taxonomic levels 
          while preserving all existing data and relationships.
        </div>
      </CardContent>
    </Card>
  );
}