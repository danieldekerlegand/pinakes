import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Languages, CheckCircle, List, FolderSync } from "lucide-react";

interface Stats {
  totalLanguages: number;
  wordListsScraped: number;
  baseWords: number;
  scrapingQueue: number;
}

export default function StatsOverview() {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['/api/stats'],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="p-6 animate-pulse">
            <div className="flex items-center">
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-8 bg-gray-200 rounded"></div>
              </div>
              <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const statItems = [
    {
      label: "Total Languages",
      value: stats.totalLanguages.toLocaleString(),
      icon: Languages,
      bgColor: "bg-primary",
      testId: "stat-total-languages"
    },
    {
      label: "Word Lists Scraped", 
      value: stats.wordListsScraped.toLocaleString(),
      icon: CheckCircle,
      bgColor: "bg-secondary",
      testId: "stat-word-lists-scraped"
    },
    {
      label: "Base Words",
      value: stats.baseWords.toLocaleString(),
      icon: List,
      bgColor: "bg-warning",
      testId: "stat-base-words"
    },
    {
      label: "Scraping Queue",
      value: stats.scrapingQueue.toLocaleString(),
      icon: FolderSync,
      bgColor: "bg-blue-500",
      testId: "stat-scraping-queue"
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {statItems.map((item, index) => (
        <Card key={index} className="bg-white rounded-lg shadow-material-1 p-6">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm text-gray-600" data-testid={`${item.testId}-label`}>
                {item.label}
              </p>
              <p className="text-2xl font-medium text-gray-900" data-testid={`${item.testId}-value`}>
                {item.value}
              </p>
            </div>
            <div className={`${item.bgColor} rounded-full p-3`}>
              <item.icon className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
