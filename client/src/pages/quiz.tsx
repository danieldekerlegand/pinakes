import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  XCircle,
  GripVertical,
  MapPin,
  Trophy,
  RotateCcw,
  ChevronRight,
  Lightbulb,
} from "lucide-react";

type Difficulty = "easy" | "medium" | "hard";
type QuizCategory = "languages" | "families" | "grammar" | "writing_systems" | "geography" | "mixed";

interface QuizQuestion {
  id: string;
  type: "multiple_choice" | "drag_sort" | "map_click";
  category: string;
  difficulty: Difficulty;
  question: string;
  options?: string[];
  answer: number | string[] | { lat: number; lng: number };
  hint?: string;
  explanation?: string;
}

interface QuizSession {
  questions: QuizQuestion[];
  category: string;
  difficulty: Difficulty;
}

interface AnswerResult {
  correct: boolean;
  selectedAnswer: unknown;
}

// --- Sub-components ---

function MultipleChoiceQuestion({
  question,
  onAnswer,
}: {
  question: QuizQuestion;
  onAnswer: (correct: boolean, selected: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const handleSelect = (index: number) => {
    if (showResult) return;
    setSelected(index);
  };

  const handleSubmit = () => {
    if (selected === null) return;
    setShowResult(true);
    const correct = selected === (question.answer as number);
    setTimeout(() => onAnswer(correct, selected), 1200);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {question.options?.map((option, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i)}
            className={`w-full text-left p-4 rounded-lg border transition-all ${
              showResult && i === (question.answer as number)
                ? "border-green-500 bg-green-500/10 text-green-300"
                : showResult && i === selected && i !== (question.answer as number)
                  ? "border-red-500 bg-red-500/10 text-red-300"
                  : selected === i
                    ? "border-blue-500 bg-blue-500/10 text-blue-300"
                    : "border-gray-700 hover:border-gray-500 text-gray-300"
            }`}
            disabled={showResult}
          >
            <span className="font-mono text-sm mr-3 opacity-60">{String.fromCharCode(65 + i)}</span>
            {option}
            {showResult && i === (question.answer as number) && (
              <CheckCircle2 className="inline w-4 h-4 ml-2 text-green-400" />
            )}
            {showResult && i === selected && i !== (question.answer as number) && (
              <XCircle className="inline w-4 h-4 ml-2 text-red-400" />
            )}
          </button>
        ))}
      </div>

      {!showResult && question.hint && (
        <button
          onClick={() => setShowHint(true)}
          className="text-sm text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
        >
          <Lightbulb className="w-3 h-3" />
          {showHint ? question.hint : "Show hint"}
        </button>
      )}

      {showResult && question.explanation && (
        <p className="text-sm text-gray-400 italic">{question.explanation}</p>
      )}

      {!showResult && (
        <Button onClick={handleSubmit} disabled={selected === null} className="w-full">
          Submit Answer
        </Button>
      )}
    </div>
  );
}

function DragSortQuestion({
  question,
  onAnswer,
}: {
  question: QuizQuestion;
  onAnswer: (correct: boolean, order: string[]) => void;
}) {
  const [items, setItems] = useState<string[]>(question.options || []);
  const [showResult, setShowResult] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newItems = [...items];
    const [removed] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, removed);
    setItems(newItems);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const moveItem = (from: number, to: number) => {
    if (showResult || to < 0 || to >= items.length) return;
    const newItems = [...items];
    const [removed] = newItems.splice(from, 1);
    newItems.splice(to, 0, removed);
    setItems(newItems);
  };

  const handleSubmit = () => {
    setShowResult(true);
    const correctOrder = question.answer as string[];
    const correct = items.every((item, i) => item === correctOrder[i]);
    setTimeout(() => onAnswer(correct, items), 1200);
  };

  const correctOrder = question.answer as string[];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {items.map((item, i) => {
          const isCorrectPosition = showResult && item === correctOrder[i];
          const isWrongPosition = showResult && item !== correctOrder[i];
          return (
            <div
              key={item}
              draggable={!showResult}
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                isCorrectPosition
                  ? "border-green-500 bg-green-500/10"
                  : isWrongPosition
                    ? "border-red-500 bg-red-500/10"
                    : draggedIndex === i
                      ? "border-blue-500 bg-blue-500/10 opacity-70"
                      : "border-gray-700 hover:border-gray-500"
              } ${showResult ? "" : "cursor-grab active:cursor-grabbing"}`}
            >
              <GripVertical className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <span className="font-mono text-sm text-gray-500 w-6">{i + 1}.</span>
              <span className="text-gray-200 flex-1">{item}</span>
              {!showResult && (
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveItem(i, i - 1)}
                    className="text-gray-500 hover:text-white text-xs px-1"
                    disabled={i === 0}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveItem(i, i + 1)}
                    className="text-gray-500 hover:text-white text-xs px-1"
                    disabled={i === items.length - 1}
                  >
                    ▼
                  </button>
                </div>
              )}
              {isCorrectPosition && <CheckCircle2 className="w-4 h-4 text-green-400" />}
              {isWrongPosition && <XCircle className="w-4 h-4 text-red-400" />}
            </div>
          );
        })}
      </div>

      {!showResult && question.hint && (
        <button
          onClick={() => setShowHint(true)}
          className="text-sm text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
        >
          <Lightbulb className="w-3 h-3" />
          {showHint ? question.hint : "Show hint"}
        </button>
      )}

      {showResult && question.explanation && (
        <p className="text-sm text-gray-400 italic">{question.explanation}</p>
      )}

      {!showResult && (
        <Button onClick={handleSubmit} className="w-full">
          Submit Order
        </Button>
      )}
    </div>
  );
}

function MapClickQuestion({
  question,
  onAnswer,
}: {
  question: QuizQuestion;
  onAnswer: (correct: boolean, guess: { lat: number; lng: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [guess, setGuess] = useState<{ lat: number; lng: number } | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const answer = question.answer as { lat: number; lng: number };

  // Simple equirectangular map projection
  const lngToX = (lng: number, width: number) => ((lng + 180) / 360) * width;
  const latToY = (lat: number, height: number) => ((90 - lat) / 180) * height;
  const xToLng = (x: number, width: number) => (x / width) * 360 - 180;
  const yToLat = (y: number, height: number) => 90 - (y / height) * 180;

  const drawMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Background (ocean)
    ctx.fillStyle = "#1a2332";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "#2a3a4a";
    ctx.lineWidth = 0.5;
    for (let lng = -180; lng <= 180; lng += 30) {
      const x = lngToX(lng, w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let lat = -90; lat <= 90; lat += 30) {
      const y = latToY(lat, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Simplified continent outlines (rough rectangles for major landmasses)
    ctx.fillStyle = "#2d4a3e";
    const continents = [
      // North America
      { x1: -170, y1: 72, x2: -50, y2: 15 },
      // South America
      { x1: -82, y1: 13, x2: -34, y2: -56 },
      // Europe
      { x1: -10, y1: 71, x2: 40, y2: 36 },
      // Africa
      { x1: -18, y1: 37, x2: 52, y2: -35 },
      // Asia
      { x1: 40, y1: 75, x2: 180, y2: 5 },
      // Australia
      { x1: 113, y1: -10, x2: 155, y2: -40 },
    ];

    for (const c of continents) {
      const x = lngToX(c.x1, w);
      const y = latToY(c.y1, h);
      const cw = lngToX(c.x2, w) - x;
      const ch = latToY(c.y2, h) - y;
      ctx.fillRect(x, y, cw, ch);
    }

    // Equator label
    ctx.fillStyle = "#4a5a6a";
    ctx.font = "10px sans-serif";
    ctx.fillText("Equator", 5, latToY(0, h) - 3);

    // Draw guess marker
    if (guess) {
      const gx = lngToX(guess.lng, w);
      const gy = latToY(guess.lat, h);
      ctx.beginPath();
      ctx.arc(gx, gy, 8, 0, Math.PI * 2);
      ctx.fillStyle = showResult ? "#ef4444" : "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw answer marker (after reveal)
    if (showResult) {
      const ax = lngToX(answer.lng, w);
      const ay = latToY(answer.lat, h);
      ctx.beginPath();
      ctx.arc(ax, ay, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw line between guess and answer
      if (guess) {
        const gx = lngToX(guess.lng, w);
        const gy = latToY(guess.lat, h);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(ax, ay);
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [guess, showResult, answer]);

  useEffect(() => {
    drawMap();
  }, [drawMap]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (showResult) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setGuess({ lat: yToLat(y, canvas.height), lng: xToLng(x, canvas.width) });
  };

  const handleSubmit = async () => {
    if (!guess) return;
    setShowResult(true);

    try {
      const res = await fetch("/api/quiz/score-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, guess, difficulty: question.difficulty }),
      });
      const result = await res.json();
      setTimeout(() => onAnswer(result.correct, guess), 1500);
    } catch {
      // Fallback: simple distance check
      const dist = Math.sqrt((guess.lat - answer.lat) ** 2 + (guess.lng - answer.lng) ** 2);
      const threshold = question.difficulty === "easy" ? 15 : question.difficulty === "medium" ? 8 : 4;
      setTimeout(() => onAnswer(dist <= threshold, guess), 1500);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={720}
          height={400}
          onClick={handleCanvasClick}
          className="w-full rounded-lg border border-gray-700 cursor-crosshair"
          style={{ maxHeight: "400px" }}
        />
        {!guess && !showResult && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-500 bg-gray-900/80 px-3 py-1 rounded text-sm">
              <MapPin className="inline w-4 h-4 mr-1" />
              Click to place your guess
            </span>
          </div>
        )}
      </div>

      {!showResult && question.hint && (
        <button
          onClick={() => setShowHint(true)}
          className="text-sm text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
        >
          <Lightbulb className="w-3 h-3" />
          {showHint ? question.hint : "Show hint"}
        </button>
      )}

      {showResult && question.explanation && (
        <p className="text-sm text-gray-400 italic">
          <span className="text-green-400">●</span> Correct location &nbsp;
          <span className="text-red-400">●</span> Your guess &nbsp;— {question.explanation}
        </p>
      )}

      {!showResult && (
        <Button onClick={handleSubmit} disabled={!guess} className="w-full">
          Submit Location
        </Button>
      )}
    </div>
  );
}

// --- Results screen ---

function QuizResults({
  results,
  questions,
  onRestart,
}: {
  results: AnswerResult[];
  questions: QuizQuestion[];
  onRestart: () => void;
}) {
  const correct = results.filter(r => r.correct).length;
  const total = results.length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const getMessage = () => {
    if (pct === 100) return "Perfect score! You're a linguistics expert!";
    if (pct >= 80) return "Excellent! You really know your languages.";
    if (pct >= 60) return "Good job! Keep learning.";
    if (pct >= 40) return "Not bad! There's more to discover.";
    return "Keep practicing — the world of languages awaits!";
  };

  return (
    <Card className="bg-gray-900 border-gray-700 p-8 text-center space-y-6">
      <Trophy className={`w-16 h-16 mx-auto ${pct >= 80 ? "text-yellow-400" : pct >= 50 ? "text-blue-400" : "text-gray-400"}`} />
      <div>
        <h2 className="text-3xl font-bold text-white">{correct} / {total}</h2>
        <p className="text-gray-400 mt-1">{getMessage()}</p>
      </div>
      <Progress value={pct} className="h-3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left max-w-md mx-auto">
        {questions.map((q, i) => (
          <div
            key={q.id}
            className={`flex items-center gap-2 text-sm p-2 rounded ${
              results[i]?.correct ? "text-green-400" : "text-red-400"
            }`}
          >
            {results[i]?.correct ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="truncate">{q.question}</span>
          </div>
        ))}
      </div>
      <Button onClick={onRestart} size="lg" className="gap-2">
        <RotateCcw className="w-4 h-4" />
        Try Again
      </Button>
    </Card>
  );
}

// --- Main page ---

export default function QuizPage() {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [category, setCategory] = useState<QuizCategory>("mixed");
  const [questionCount, setQuestionCount] = useState(10);
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<AnswerResult[]>([]);
  const [finished, setFinished] = useState(false);

  const { data: session, isLoading, refetch } = useQuery<QuizSession>({
    queryKey: ["/api/quiz", { count: questionCount, category, difficulty }],
    queryFn: async () => {
      const params = new URLSearchParams({
        count: questionCount.toString(),
        category,
        difficulty,
      });
      const res = await fetch(`/api/quiz?${params}`);
      if (!res.ok) throw new Error("Failed to load quiz");
      return res.json();
    },
    enabled: started,
  });

  const questions = session?.questions || [];
  const currentQuestion = questions[currentIndex];

  const handleAnswer = (correct: boolean, selected: unknown) => {
    const newResults = [...results, { correct, selectedAnswer: selected }];
    setResults(newResults);

    if (currentIndex + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleRestart = () => {
    setStarted(false);
    setCurrentIndex(0);
    setResults([]);
    setFinished(false);
  };

  const handleStart = () => {
    setStarted(true);
    setCurrentIndex(0);
    setResults([]);
    setFinished(false);
    refetch();
  };

  // Setup screen
  if (!started) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <div className="max-w-2xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Dashboard
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold">Quiz & Learning Mode</h1>
          </div>
          <p className="text-gray-400 mb-10 max-w-xl">
            Test your knowledge of languages, writing systems, grammar, and geography.
            Questions are dynamically generated from the LinguaScrape database.
          </p>

          <Card className="bg-gray-900 border-gray-700 p-6 space-y-6">
            <div>
              <label className="text-sm text-gray-400 mb-2 block">Category</label>
              <Select value={category} onValueChange={(v) => setCategory(v as QuizCategory)}>
                <SelectTrigger className="bg-gray-800 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixed">Mixed (All Categories)</SelectItem>
                  <SelectItem value="families">Language Families</SelectItem>
                  <SelectItem value="languages">Languages</SelectItem>
                  <SelectItem value="grammar">Grammar</SelectItem>
                  <SelectItem value="writing_systems">Writing Systems</SelectItem>
                  <SelectItem value="geography">Geography</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-2 block">Difficulty</label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                <SelectTrigger className="bg-gray-800 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-gray-400 mb-2 block">Number of Questions</label>
              <Select value={questionCount.toString()} onValueChange={(v) => setQuestionCount(parseInt(v))}>
                <SelectTrigger className="bg-gray-800 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 Questions</SelectItem>
                  <SelectItem value="10">10 Questions</SelectItem>
                  <SelectItem value="15">15 Questions</SelectItem>
                  <SelectItem value="20">20 Questions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleStart} size="lg" className="w-full gap-2">
              <Brain className="w-5 h-5" />
              Start Quiz
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto" />
          <p className="text-gray-400">Generating questions...</p>
        </div>
      </div>
    );
  }

  // No questions generated
  if (started && !isLoading && questions.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <Card className="bg-gray-900 border-gray-700 p-8 text-center space-y-4 max-w-md">
          <p className="text-gray-400">No questions could be generated for this category. Try a different category or difficulty.</p>
          <Button onClick={handleRestart} variant="outline">
            Go Back
          </Button>
        </Card>
      </div>
    );
  }

  // Results screen
  if (finished) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <div className="max-w-2xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-6">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Dashboard
              </Button>
            </Link>
          </div>
          <QuizResults results={results} questions={questions} onRestart={handleRestart} />
        </div>
      </div>
    );
  }

  // Active question
  const progressPct = ((currentIndex) / questions.length) * 100;
  const categoryLabel: Record<string, string> = {
    languages: "Languages",
    families: "Language Families",
    grammar: "Grammar",
    writing_systems: "Writing Systems",
    geography: "Geography",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" size="sm" onClick={handleRestart} className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Quit
          </Button>
          <span className="text-sm text-gray-400">
            Question {currentIndex + 1} of {questions.length}
          </span>
        </div>

        {/* Progress bar */}
        <Progress value={progressPct} className="h-2 mb-8" />

        {/* Question card */}
        {currentQuestion && (
          <Card className="bg-gray-900 border-gray-700 p-6 space-y-6">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="px-2 py-0.5 rounded bg-gray-800">
                {categoryLabel[currentQuestion.category] || currentQuestion.category}
              </span>
              <span className="px-2 py-0.5 rounded bg-gray-800 capitalize">
                {currentQuestion.difficulty}
              </span>
              <span className="px-2 py-0.5 rounded bg-gray-800 capitalize">
                {currentQuestion.type.replace("_", " ")}
              </span>
            </div>

            <h2 className="text-xl font-semibold text-white">{currentQuestion.question}</h2>

            {currentQuestion.type === "multiple_choice" && (
              <MultipleChoiceQuestion
                key={currentQuestion.id}
                question={currentQuestion}
                onAnswer={handleAnswer}
              />
            )}
            {currentQuestion.type === "drag_sort" && (
              <DragSortQuestion
                key={currentQuestion.id}
                question={currentQuestion}
                onAnswer={handleAnswer}
              />
            )}
            {currentQuestion.type === "map_click" && (
              <MapClickQuestion
                key={currentQuestion.id}
                question={currentQuestion}
                onAnswer={handleAnswer}
              />
            )}
          </Card>
        )}

        {/* Score tracker */}
        <div className="flex justify-center gap-2 mt-6">
          {results.map((r, i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full ${r.correct ? "bg-green-500" : "bg-red-500"}`}
            />
          ))}
          {Array.from({ length: questions.length - results.length }).map((_, i) => (
            <div key={`pending-${i}`} className="w-3 h-3 rounded-full bg-gray-700" />
          ))}
        </div>
      </div>
    </div>
  );
}
