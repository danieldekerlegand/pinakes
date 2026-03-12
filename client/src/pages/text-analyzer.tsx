import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Language } from "@shared/types";

const ORIGIN_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#6366f1",
  "#14b8a6", "#e11d48", "#a855f7", "#0ea5e9", "#d946ef",
  "#64748b", "#78716c", "#059669", "#dc2626", "#7c3aed",
];

interface OriginEntry {
  language: string;
  languageName: string;
  count: number;
  percentage: number;
  words: string[];
}

interface AnalysisResult {
  totalWords: number;
  analyzedWords: number;
  unknownWords: number;
  origins: OriginEntry[];
}

export default function TextAnalyzer() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("eng");
  const [expandedOrigin, setExpandedOrigin] = useState<string | null>(null);

  const { data: languagesData } = useQuery<{ items: Language[]; count: number }>({
    queryKey: ["/api/languages"],
  });

  const analysisMutation = useMutation<AnalysisResult, Error, { text: string; language: string }>({
    mutationFn: async (params) => {
      const res = await apiRequest("POST", "/api/text-analysis/origins", params);
      return res.json();
    },
  });

  const handleAnalyze = () => {
    if (!text.trim()) return;
    setExpandedOrigin(null);
    analysisMutation.mutate({ text, language });
  };

  const languages = languagesData?.items ?? [];

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
                onClick={() => navigate("/")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-xl font-medium">Text Analyzer</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-2">Analyze Text Etymology</h2>
            <p className="text-sm text-muted-foreground">
              Paste text below to analyze its etymological composition — discover what percentage of words originate from each language.
            </p>
          </div>

          {/* Language selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Source Language</label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {languages
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((lang) => (
                    <SelectItem key={lang.id} value={lang.id}>
                      {lang.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Text input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Text to Analyze</label>
            <Textarea
              placeholder="Paste your text here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="resize-y"
            />
          </div>

          {/* Analyze button */}
          <Button
            onClick={handleAnalyze}
            disabled={!text.trim() || analysisMutation.isPending}
            className="w-full sm:w-auto"
          >
            {analysisMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Analyze"
            )}
          </Button>

          {/* Error state */}
          {analysisMutation.isError && (
            <div className="text-sm text-red-600">
              Analysis failed: {analysisMutation.error.message}
            </div>
          )}

          {/* Results */}
          {analysisMutation.data && (
            <div className="space-y-6 pt-4 border-t">
              <h3 className="font-semibold">Results</h3>
              <p className="text-sm text-muted-foreground">
                {analysisMutation.data.analyzedWords} of {analysisMutation.data.totalWords} words analyzed,{" "}
                {analysisMutation.data.unknownWords} unknown
              </p>

              {/* Donut Chart */}
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={analysisMutation.data.origins}
                      dataKey="count"
                      nameKey="languageName"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={120}
                      paddingAngle={1}
                      onClick={(entry) => {
                        const lang = entry.language as string;
                        setExpandedOrigin(expandedOrigin === lang ? null : lang);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {analysisMutation.data.origins.map((_, index) => (
                        <Cell
                          key={index}
                          fill={ORIGIN_COLORS[index % ORIGIN_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0].payload as OriginEntry;
                        return (
                          <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
                            <div className="font-medium">{data.languageName}</div>
                            <div className="text-muted-foreground">
                              {data.count} words ({data.percentage.toFixed(1)}%)
                            </div>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend with expandable word lists */}
              <div className="space-y-1">
                {analysisMutation.data.origins.map((origin, index) => (
                  <div key={origin.language}>
                    <button
                      className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-md hover:bg-muted/80 transition-colors"
                      onClick={() =>
                        setExpandedOrigin(
                          expandedOrigin === origin.language ? null : origin.language
                        )
                      }
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: ORIGIN_COLORS[index % ORIGIN_COLORS.length] }}
                        />
                        <span className="font-medium">{origin.languageName}</span>
                        <span className="text-sm text-muted-foreground">
                          ({origin.count} words)
                        </span>
                      </div>
                      <span className="font-mono text-sm">
                        {origin.percentage.toFixed(1)}%
                      </span>
                    </button>
                    {expandedOrigin === origin.language && (
                      <div className="ml-5 mt-1 mb-2 p-3 bg-muted/30 rounded-md">
                        <p className="text-sm text-muted-foreground mb-2">
                          Words from {origin.languageName}:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {origin.words.map((word, wi) => (
                            <span
                              key={wi}
                              className="text-xs px-2 py-0.5 rounded-full border bg-background"
                            >
                              {word}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
