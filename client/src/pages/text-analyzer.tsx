import { useState, useEffect, useRef } from "react";
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
import {
  TooltipProvider,
  Tooltip as UITooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
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

interface WordChainEntry {
  word: string;
  language: string;
  languageName: string;
}

interface WordDetail {
  word: string;
  origin: string | null;
  chain: WordChainEntry[];
}

interface AnalysisResult {
  totalWords: number;
  analyzedWords: number;
  unknownWords: number;
  origins: OriginEntry[];
  wordDetails: WordDetail[];
}

interface ComparisonDifference {
  language: string;
  percentA: number;
  percentB: number;
  diff: number;
}

interface CompareResult {
  analysisA: AnalysisResult;
  analysisB: AnalysisResult;
  comparison: {
    sharedOrigins: string[];
    uniqueToA: string[];
    uniqueToB: string[];
    differences: ComparisonDifference[];
  };
}

/**
 * Build a synchronized color map for comparison mode.
 * Both analyses use the same color for the same origin language.
 */
function buildSyncedColorMap(originsA: OriginEntry[], originsB: OriginEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  let colorIdx = 0;
  const allLanguages: string[] = [];
  originsA.forEach((o) => {
    if (!allLanguages.includes(o.language)) allLanguages.push(o.language);
  });
  originsB.forEach((o) => {
    if (!allLanguages.includes(o.language)) allLanguages.push(o.language);
  });
  allLanguages.forEach((lang) => {
    map[lang] = ORIGIN_COLORS[colorIdx % ORIGIN_COLORS.length];
    colorIdx++;
  });
  return map;
}

/**
 * Build a map from origin language code to its color from the chart.
 */
function buildOriginColorMap(origins: OriginEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  origins.forEach((origin, index) => {
    map[origin.language] = ORIGIN_COLORS[index % ORIGIN_COLORS.length];
  });
  return map;
}

/**
 * Split text into tokens preserving whitespace and punctuation as separate entries.
 * Returns array of { text, isWord } where isWord tokens can be matched against wordDetails.
 */
function splitTextTokens(text: string): Array<{ text: string; isWord: boolean }> {
  const tokens: Array<{ text: string; isWord: boolean }> = [];
  // Match sequences of word characters (including Unicode) or sequences of non-word characters
  const regex = /([a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3000-\u9FFF\uAC00-\uD7AF'-]+)|([^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3000-\u9FFF\uAC00-\uD7AF'-]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      // Strip leading/trailing apostrophes/hyphens to match tokenizer behavior
      const cleaned = match[1].replace(/^['-]+|['-]+$/g, "");
      tokens.push({ text: match[0], isWord: cleaned.length > 0 });
    } else {
      tokens.push({ text: match[0], isWord: false });
    }
  }
  return tokens;
}

function HighlightedText({
  text,
  wordDetails,
  originColorMap,
  onWordClick,
}: {
  text: string;
  wordDetails: WordDetail[];
  originColorMap: Record<string, string>;
  onWordClick?: (word: string, language: string) => void;
}) {
  const tokens = splitTextTokens(text);
  let wordIndex = 0;

  return (
    <div className="space-y-3">
      <h4 className="font-semibold">Etymology Highlighting</h4>
      <p className="text-sm text-muted-foreground">
        Hover over words to see their etymology chain. Click any word to view its full etymology tree. Colors match the chart above.
      </p>
      <TooltipProvider delayDuration={200}>
        <div className="p-4 bg-muted/30 rounded-lg leading-relaxed text-base whitespace-pre-wrap">
          {tokens.map((token, i) => {
            if (!token.isWord) {
              return <span key={i}>{token.text}</span>;
            }
            const detail = wordIndex < wordDetails.length ? wordDetails[wordIndex] : null;
            wordIndex++;
            if (!detail) {
              return <span key={i}>{token.text}</span>;
            }

            const color = detail.origin ? originColorMap[detail.origin] ?? "#94a3b8" : "#94a3b8";
            const chainText =
              detail.chain.length > 0
                ? detail.chain
                    .map((entry) => `${entry.word} (${entry.languageName})`)
                    .join(" → ")
                : "Unknown origin";

            return (
              <UITooltip key={i}>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer rounded px-0.5 transition-colors hover:opacity-80"
                    style={{
                      borderBottom: `2px solid ${color}`,
                      color: detail.origin ? undefined : "#94a3b8",
                    }}
                    onClick={() => {
                      if (onWordClick) {
                        const lang = detail.chain.length > 0 ? detail.chain[0].language : "";
                        onWordClick(detail.word, lang);
                      }
                    }}
                  >
                    {token.text}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-xs"
                >
                  <div className="text-xs">
                    {detail.origin ? (
                      <div className="space-y-1">
                        <div className="font-medium">{chainText}</div>
                        <div className="text-blue-500">Click to see etymology tree</div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Unknown origin</span>
                    )}
                  </div>
                </TooltipContent>
              </UITooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}

function DonutChart({
  origins,
  colorMap,
  expandedOrigin,
  setExpandedOrigin,
}: {
  origins: OriginEntry[];
  colorMap: Record<string, string>;
  expandedOrigin: string | null;
  setExpandedOrigin: (lang: string | null) => void;
}) {
  return (
    <div>
      <div className="flex flex-col items-center">
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={origins}
              dataKey="count"
              nameKey="languageName"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={100}
              paddingAngle={1}
              onClick={(entry) => {
                const lang = entry.language as string;
                setExpandedOrigin(expandedOrigin === lang ? null : lang);
              }}
              style={{ cursor: "pointer" }}
            >
              {origins.map((origin) => (
                <Cell
                  key={origin.language}
                  fill={colorMap[origin.language] ?? "#94a3b8"}
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

      <div className="space-y-1">
        {origins.map((origin) => (
          <div key={origin.language}>
            <button
              className="w-full flex items-center justify-between p-2 bg-muted/50 rounded-md hover:bg-muted/80 transition-colors text-sm"
              onClick={() =>
                setExpandedOrigin(
                  expandedOrigin === origin.language ? null : origin.language
                )
              }
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: colorMap[origin.language] ?? "#94a3b8" }}
                />
                <span className="font-medium">{origin.languageName}</span>
                <span className="text-muted-foreground">
                  ({origin.count})
                </span>
              </div>
              <span className="font-mono">
                {origin.percentage.toFixed(1)}%
              </span>
            </button>
            {expandedOrigin === origin.language && (
              <div className="ml-5 mt-1 mb-2 p-2 bg-muted/30 rounded-md">
                <div className="flex flex-wrap gap-1">
                  {origin.words.map((word, wi) => (
                    <span
                      key={wi}
                      className="text-xs px-1.5 py-0.5 rounded-full border bg-background"
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
  );
}

function getLanguageName(differences: ComparisonDifference[], languageCode: string, analysisA: AnalysisResult, analysisB: AnalysisResult): string {
  const fromA = analysisA.origins.find((o) => o.language === languageCode);
  if (fromA) return fromA.languageName;
  const fromB = analysisB.origins.find((o) => o.language === languageCode);
  if (fromB) return fromB.languageName;
  return languageCode;
}

interface TextAnalyzerProps {
  embedded?: boolean;
  onNavigateToEtymology?: (word: string, language: string) => void;
}

export default function TextAnalyzer(props: TextAnalyzerProps & Record<string, any> = {}) {
  const { embedded, onNavigateToEtymology } = props;
  const [, navigate] = useLocation();
  const autoAnalyzed = useRef(false);

  // Read URL params for pre-filled state
  const searchParams = new URLSearchParams(window.location.search);
  const initialText = searchParams.get("text") ?? "";
  const initialLanguage = searchParams.get("language") ?? "eng";

  const [mode, setMode] = useState<"analyze" | "compare">("analyze");
  const [text, setText] = useState(initialText);
  const [language, setLanguage] = useState(initialLanguage);
  const [expandedOrigin, setExpandedOrigin] = useState<string | null>(null);

  // Compare mode state
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [languageA, setLanguageA] = useState("eng");
  const [languageB, setLanguageB] = useState("eng");
  const [expandedOriginA, setExpandedOriginA] = useState<string | null>(null);
  const [expandedOriginB, setExpandedOriginB] = useState<string | null>(null);

  const { data: languagesData } = useQuery<{ items: Language[]; count: number }>({
    queryKey: ["/api/languages"],
  });

  const analysisMutation = useMutation<AnalysisResult, Error, { text: string; language: string }>({
    mutationFn: async (params) => {
      const res = await apiRequest("POST", "/api/text-analysis/origins", params);
      return res.json();
    },
  });

  const compareMutation = useMutation<CompareResult, Error, { textA: string; textB: string; languageA: string; languageB: string }>({
    mutationFn: async (params) => {
      const res = await apiRequest("POST", "/api/text-analysis/compare", params);
      return res.json();
    },
  });

  // Auto-analyze when pre-filled via URL params
  useEffect(() => {
    if (initialText && !autoAnalyzed.current) {
      autoAnalyzed.current = true;
      analysisMutation.mutate({ text: initialText, language: initialLanguage });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = () => {
    if (!text.trim()) return;
    setExpandedOrigin(null);
    analysisMutation.mutate({ text, language });
  };

  const handleCompare = () => {
    if (!textA.trim() || !textB.trim()) return;
    setExpandedOriginA(null);
    setExpandedOriginB(null);
    compareMutation.mutate({ textA, textB, languageA, languageB });
  };

  const languages = languagesData?.items ?? [];
  const sortedLanguages = [...languages].sort((a, b) => a.name.localeCompare(b.name));

  const LanguageSelector = ({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "w-64"}>
        <SelectValue placeholder="Select language" />
      </SelectTrigger>
      <SelectContent>
        {sortedLanguages.map((lang) => (
          <SelectItem key={lang.id} value={lang.id}>
            {lang.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const content = (
    <div className={embedded ? "h-full overflow-y-auto p-4" : `mx-auto px-4 sm:px-6 lg:px-8 py-8 ${mode === "compare" ? "max-w-6xl" : "max-w-4xl"}`}>
      <Card className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-2">Analyze Text Etymology</h2>
            <p className="text-sm text-muted-foreground">
              {mode === "analyze"
                ? "Paste text below to analyze its etymological composition — discover what percentage of words originate from each language."
                : "Compare the etymological composition of two texts side-by-side."}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === "analyze" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("analyze")}
            >
              Analyze
            </Button>
            <Button
              variant={mode === "compare" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("compare")}
            >
              Compare
            </Button>
          </div>

          {mode === "analyze" ? (
            <>
              {/* Single analysis mode */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Source Language</label>
                <LanguageSelector value={language} onChange={setLanguage} />
              </div>

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

              {analysisMutation.isError && (
                <div className="text-sm text-red-600">
                  Analysis failed: {analysisMutation.error.message}
                </div>
              )}

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

                  {/* Highlighted text with etymology tooltips */}
                  <HighlightedText
                    text={text}
                    wordDetails={analysisMutation.data.wordDetails}
                    originColorMap={buildOriginColorMap(analysisMutation.data.origins)}
                    onWordClick={(w, lang) => {
                      if (onNavigateToEtymology) {
                        onNavigateToEtymology(w, lang);
                      } else {
                        const params = new URLSearchParams();
                        params.set("word", w);
                        if (lang) params.set("language", lang);
                        navigate("/word-etymology?" + params.toString());
                      }
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              {/* Compare mode */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Text A */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Text A</h3>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Source Language</label>
                    <LanguageSelector value={languageA} onChange={setLanguageA} className="w-full" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Text</label>
                    <Textarea
                      placeholder="Paste first text here..."
                      value={textA}
                      onChange={(e) => setTextA(e.target.value)}
                      rows={6}
                      className="resize-y"
                    />
                  </div>
                </div>

                {/* Text B */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Text B</h3>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Source Language</label>
                    <LanguageSelector value={languageB} onChange={setLanguageB} className="w-full" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Text</label>
                    <Textarea
                      placeholder="Paste second text here..."
                      value={textB}
                      onChange={(e) => setTextB(e.target.value)}
                      rows={6}
                      className="resize-y"
                    />
                  </div>
                </div>
              </div>

              <Button
                onClick={handleCompare}
                disabled={!textA.trim() || !textB.trim() || compareMutation.isPending}
                className="w-full sm:w-auto"
              >
                {compareMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Comparing...
                  </>
                ) : (
                  "Compare"
                )}
              </Button>

              {compareMutation.isError && (
                <div className="text-sm text-red-600">
                  Comparison failed: {compareMutation.error.message}
                </div>
              )}

              {compareMutation.data && (() => {
                const { analysisA: resA, analysisB: resB, comparison } = compareMutation.data;
                const syncedColors = buildSyncedColorMap(resA.origins, resB.origins);

                return (
                  <div className="space-y-6 pt-4 border-t">
                    {/* Side-by-side donut charts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <h3 className="font-semibold">Text A Results</h3>
                        <p className="text-sm text-muted-foreground">
                          {resA.analyzedWords} of {resA.totalWords} words analyzed, {resA.unknownWords} unknown
                        </p>
                        <DonutChart
                          origins={resA.origins}
                          colorMap={syncedColors}
                          expandedOrigin={expandedOriginA}
                          setExpandedOrigin={setExpandedOriginA}
                        />
                      </div>
                      <div className="space-y-3">
                        <h3 className="font-semibold">Text B Results</h3>
                        <p className="text-sm text-muted-foreground">
                          {resB.analyzedWords} of {resB.totalWords} words analyzed, {resB.unknownWords} unknown
                        </p>
                        <DonutChart
                          origins={resB.origins}
                          colorMap={syncedColors}
                          expandedOrigin={expandedOriginB}
                          setExpandedOrigin={setExpandedOriginB}
                        />
                      </div>
                    </div>

                    {/* Difference summary */}
                    <div className="space-y-4">
                      <h3 className="font-semibold">Comparison Summary</h3>

                      {/* Top differences as readable sentences */}
                      {comparison.differences.length > 0 && (
                        <div className="space-y-2">
                          {comparison.differences.slice(0, 5).map((d) => {
                            const name = getLanguageName(comparison.differences, d.language, resA, resB);
                            if (d.diff === 0) return null;
                            const absDiff = Math.abs(d.diff).toFixed(1);
                            const moreIn = d.diff > 0 ? "A" : "B";
                            return (
                              <p key={d.language} className="text-sm">
                                Text {moreIn} has{" "}
                                <span className="font-semibold">{absDiff}% more</span>{" "}
                                <span style={{ color: syncedColors[d.language] }} className="font-semibold">
                                  {name}
                                </span>
                                -origin words than Text {moreIn === "A" ? "B" : "A"}
                              </p>
                            );
                          })}
                        </div>
                      )}

                      {/* Shared vs unique origins table */}
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="text-left p-3 font-medium">Origin Language</th>
                              <th className="text-right p-3 font-medium">Text A</th>
                              <th className="text-right p-3 font-medium">Text B</th>
                              <th className="text-right p-3 font-medium">Difference</th>
                              <th className="text-center p-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparison.differences.map((d) => {
                              const name = getLanguageName(comparison.differences, d.language, resA, resB);
                              const isShared = comparison.sharedOrigins.includes(d.language);
                              const isUniqueA = comparison.uniqueToA.includes(d.language);
                              const isUniqueB = comparison.uniqueToB.includes(d.language);
                              return (
                                <tr key={d.language} className="border-t">
                                  <td className="p-3">
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="w-3 h-3 rounded-sm shrink-0"
                                        style={{ backgroundColor: syncedColors[d.language] ?? "#94a3b8" }}
                                      />
                                      {name}
                                    </div>
                                  </td>
                                  <td className="text-right p-3 font-mono">
                                    {d.percentA > 0 ? `${d.percentA.toFixed(1)}%` : "-"}
                                  </td>
                                  <td className="text-right p-3 font-mono">
                                    {d.percentB > 0 ? `${d.percentB.toFixed(1)}%` : "-"}
                                  </td>
                                  <td className="text-right p-3 font-mono">
                                    {d.diff > 0 ? (
                                      <span className="text-blue-600">+{d.diff.toFixed(1)}%</span>
                                    ) : d.diff < 0 ? (
                                      <span className="text-orange-600">{d.diff.toFixed(1)}%</span>
                                    ) : (
                                      <span className="text-muted-foreground">0%</span>
                                    )}
                                  </td>
                                  <td className="text-center p-3">
                                    {isShared && (
                                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                        Shared
                                      </span>
                                    )}
                                    {isUniqueA && (
                                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                        Only in A
                                      </span>
                                    )}
                                    {isUniqueB && (
                                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                                        Only in B
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </Card>
      </div>
  );

  if (embedded) return content;

  return (
    <div className="min-h-screen bg-surface">
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
      {content}
    </div>
  );
}
