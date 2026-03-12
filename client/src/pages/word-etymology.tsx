import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { EtymologyTreeVisualization } from "@/components/visualizations/EtymologyTreeVisualization";
import type { EtymologyNode } from "@/components/visualizations/EtymologyTreeVisualization";
import type { Language } from "@shared/types";

export default function WordEtymology() {
  const [, navigate] = useLocation();
  const autoTraced = useRef(false);

  // Read URL params for pre-filled state
  const searchParams = new URLSearchParams(window.location.search);
  const initialWord = searchParams.get("word") ?? "";
  const initialLanguage = searchParams.get("language") ?? "";

  const [word, setWord] = useState(initialWord);
  const [language, setLanguage] = useState(initialLanguage);
  const [tracedWord, setTracedWord] = useState("");
  const [tracedLanguage, setTracedLanguage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [treeData, setTreeData] = useState<EtymologyNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: languagesData } = useQuery<{ items: Language[]; count: number }>({
    queryKey: ["/api/languages"],
  });

  const languages = languagesData?.items ?? [];

  async function traceWord(w: string, lang: string) {
    if (!w.trim()) return;
    setIsLoading(true);
    setError(null);
    setTreeData(null);
    setTracedWord(w.trim());
    setTracedLanguage(lang);
    try {
      const params = new URLSearchParams();
      if (lang) params.set("language", lang);
      const res = await fetch(
        "/api/etymology-relations/trace/" + encodeURIComponent(w.trim()) +
        (params.toString() ? "?" + params.toString() : "")
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = await res.json();
      setTreeData(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to trace etymology");
    } finally {
      setIsLoading(false);
    }
  }

  // Auto-trace when pre-filled via URL params
  useEffect(function() {
    if (initialWord && !autoTraced.current) {
      autoTraced.current = true;
      traceWord(initialWord, initialLanguage);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch() {
    traceWord(word, language);
  }

  function handleNodeClick(nodeWord: string, nodeLanguage: string) {
    setWord(nodeWord);
    setLanguage(nodeLanguage);
    traceWord(nodeWord, nodeLanguage);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

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
                className="p-2 text-white hover:bg-blue-700"
                onClick={function() { navigate("/"); }}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-medium">Word Etymology</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Controls */}
        <Card className="p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Word</label>
              <Input
                placeholder="Enter a word to trace..."
                value={word}
                onChange={function(e) { setWord(e.target.value); }}
                onKeyDown={handleKeyDown}
              />
            </div>
            <div className="w-48 space-y-1">
              <label className="text-sm font-medium">Language (optional)</label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue placeholder="Any language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any language</SelectItem>
                  {languages
                    .sort(function(a, b) { return a.name.localeCompare(b.name); })
                    .map(function(lang) {
                      return (
                        <SelectItem key={lang.id} value={lang.id}>
                          {lang.name}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleSearch}
              disabled={!word.trim() || isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Trace
            </Button>
          </div>
        </Card>

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 mb-4">
            Failed to trace: {error}
          </div>
        )}

        {/* Tree Visualization */}
        {treeData && (
          <Card className="overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">
                Etymology of "{tracedWord}"
                {tracedLanguage && <span className="text-muted-foreground font-normal"> ({tracedLanguage})</span>}
              </h2>
              {treeData.children.length === 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  No etymology relations found for this word. Try a different spelling or language.
                </p>
              )}
            </div>
            <div style={{ height: Math.max(400, Math.min(700, 100 + countTreeNodes(treeData) * 50)) }}>
              <EtymologyTreeVisualization
                treeData={treeData}
                onNodeClick={handleNodeClick}
              />
            </div>
          </Card>
        )}

        {/* Empty state */}
        {!treeData && !isLoading && !error && (
          <div className="text-center text-muted-foreground py-20">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">Enter a word above to trace its etymology</p>
            <p className="text-sm mt-2">
              See how words have traveled across languages over time
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function countTreeNodes(node: EtymologyNode): number {
  let count = 1;
  node.children.forEach(function(child) {
    count += countTreeNodes(child);
  });
  return count;
}
