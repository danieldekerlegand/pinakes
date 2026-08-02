import { useRoute, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Brain, Trophy, ArrowLeft } from "lucide-react";
import { scorePct } from "@/lib/quiz-progress";
import { decodeQuizResult, resultMessage } from "@/lib/quiz-share";

const CATEGORY_LABELS: Record<string, string> = {
  languages: "Languages",
  families: "Language Families",
  grammar: "Grammar",
  writing_systems: "Writing Systems",
  geography: "Geography",
  cuisine: "Cuisine & Dishes",
  civilizations: "Civilizations (Chronology)",
  mixed: "Mixed (All Categories)",
};

/**
 * Read-only summary of a quiz result shared via `/shared/quiz/:token`. The whole
 * result is embedded in the token (no server lookup); an invalid token renders a
 * graceful "not found" message.
 */
export default function SharedQuizResultPage() {
  const [, params] = useRoute("/shared/quiz/:token");
  const result = decodeQuizResult(params?.token);

  if (!result) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <Card className="bg-gray-900 border-gray-700 p-8 text-center space-y-4 max-w-md">
          <p className="text-gray-400">This shared quiz result could not be read.</p>
          <Link href="/quiz">
            <Button variant="outline" className="gap-2">
              <Brain className="w-4 h-4" />
              Take the quiz
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const pct = scorePct(result);
  const label = CATEGORY_LABELS[result.category] || result.category;

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

        <Card className="bg-gray-900 border-gray-700 p-8 text-center space-y-6">
          <div className="flex items-center justify-center gap-2 text-sm text-purple-300">
            <Brain className="w-4 h-4" />
            Shared quiz result
          </div>
          <Trophy
            className={`w-16 h-16 mx-auto ${
              pct >= 80 ? "text-yellow-400" : pct >= 50 ? "text-blue-400" : "text-gray-400"
            }`}
          />
          <div>
            <h1 className="text-3xl font-bold text-white">
              {result.correct} / {result.total}
            </h1>
            <p className="text-gray-400 mt-1">{resultMessage(pct)}</p>
          </div>
          <Progress value={pct} className="h-3" />
          <div className="flex items-center justify-center gap-3 text-sm text-gray-400">
            <span className="px-2 py-0.5 rounded bg-gray-800">{label}</span>
            <span className="px-2 py-0.5 rounded bg-gray-800 capitalize">
              {result.difficulty}
            </span>
            <span className="px-2 py-0.5 rounded bg-gray-800">{pct}%</span>
          </div>
          <Link href="/quiz">
            <Button size="lg" className="gap-2">
              <Brain className="w-5 h-5" />
              Try the quiz yourself
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}
