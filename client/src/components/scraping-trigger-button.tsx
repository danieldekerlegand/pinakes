import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Download, Play } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Language } from "@shared/schema";

export default function ScrapingTriggerButton() {
  const [selectedLanguageId, setSelectedLanguageId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
  });

  const scrapingMutation = useMutation({
    mutationFn: async (languageId: string) => {
      const response = await apiRequest('/api/scraping-jobs', {
        method: 'POST',
        body: JSON.stringify({
          languageId,
          status: 'pending',
          totalWords: 5000,
          completedWords: 0,
          failedWords: 0,
        }),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scraping-jobs'] });
      toast({
        title: "Scraping Job Created",
        description: "Word list scraping has been started for the selected language.",
      });
      setIsOpen(false);
      setSelectedLanguageId("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start scraping job. Please try again.",
        variant: "destructive",
      });
    },
  });

  const availableLanguages = languages.filter(lang => 
    !lang.isHistoricalVariant && lang.status === 'living'
  );

  const handleStartScraping = () => {
    if (!selectedLanguageId) return;
    scrapingMutation.mutate(selectedLanguageId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300"
          data-testid="button-trigger-scraping"
        >
          <Download className="h-4 w-4 mr-2" />
          Start Word Scraping
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start Word List Scraping</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Select Language
            </label>
            <Select value={selectedLanguageId} onValueChange={setSelectedLanguageId}>
              <SelectTrigger data-testid="select-language-scraping">
                <SelectValue placeholder="Choose a language to scrape..." />
              </SelectTrigger>
              <SelectContent>
                {availableLanguages.map(language => (
                  <SelectItem key={language.id} value={language.id}>
                    {language.name} ({language.nativeName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800">
            <p className="font-medium mb-1">What this will do:</p>
            <ul className="text-xs space-y-1">
              <li>• Scrape translations for ~5,000 common English words</li>
              <li>• Process through translation APIs</li>
              <li>• Add pronunciation guides where available</li>
              <li>• Handle untranslatable words gracefully</li>
            </ul>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={scrapingMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleStartScraping}
              disabled={!selectedLanguageId || scrapingMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-start-scraping"
            >
              {scrapingMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Scraping
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}