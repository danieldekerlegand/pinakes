import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Download, Play, Search } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Language } from "@shared/types";

export default function ScrapingTriggerButton() {
  const [selectedLanguageId, setSelectedLanguageId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
  });

  const scrapingMutation = useMutation({
    mutationFn: async ({ languageId, languageName }: { languageId: string; languageName: string }) => {
      const response = await apiRequest('POST', '/api/scraping/words', {
        languageId,
        languageName,
        dataSources: ['gemini'],
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scraping-jobs'] });
      toast({
        title: "Scraping Started",
        description: "Word list scraping has been started. Check the progress panel for updates.",
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

  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return availableLanguages;
    const query = searchQuery.toLowerCase();
    return availableLanguages.filter(lang =>
      lang.name.toLowerCase().includes(query) ||
      lang.nativeName?.toLowerCase().includes(query) ||
      lang.id.toLowerCase().includes(query)
    );
  }, [availableLanguages, searchQuery]);

  const handleStartScraping = () => {
    if (!selectedLanguageId) return;
    const selectedLang = availableLanguages.find(lang => lang.id === selectedLanguageId);
    if (!selectedLang) return;
    scrapingMutation.mutate({
      languageId: selectedLanguageId,
      languageName: selectedLang.name,
    });
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
              Search Languages
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Select Language
            </label>
            <Select value={selectedLanguageId} onValueChange={setSelectedLanguageId}>
              <SelectTrigger data-testid="select-language-scraping">
                <SelectValue placeholder="Choose a language to scrape..." />
              </SelectTrigger>
              <SelectContent>
                {filteredLanguages.length > 0 ? (
                  filteredLanguages.map(language => (
                    <SelectItem key={language.id} value={language.id}>
                      {language.name} ({language.nativeName || language.name})
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-6 text-center text-sm text-gray-500">
                    No languages found matching "{searchQuery}"
                  </div>
                )}
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