import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, TreePine, FileText, Database } from "lucide-react";

interface Stats {
  totalLanguages: number;
  wordListsScraped: number;
  totalFamilies: number;
  activeScrapingJobs: number;
}

export default function StatsOverview() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
  });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-6 bg-gradient-to-br from-blue-50 to-white border-0 shadow-material-1">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-8 bg-gray-200 rounded w-1/2"></div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Languages",
      value: stats.totalLanguages,
      icon: Globe,
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Language Families",
      value: stats.totalFamilies,
      icon: TreePine,
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Word Lists Scraped",
      value: stats.wordListsScraped,
      icon: FileText,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      title: "Active Scraping Jobs",
      value: stats.activeScrapingJobs,
      icon: Database,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      {statCards.map((stat, index) => (
        <Card
          key={index}
          className="p-6 bg-gradient-to-br from-blue-50 to-white border-0 shadow-material-1 hover:shadow-material-2 transition-shadow duration-200"
          data-testid={`stat-card-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">
                {stat.title}
              </p>
              <p className="text-2xl font-bold text-gray-900" data-testid={`stat-value-${index}`}>
                {(stat.value || 0).toLocaleString()}
              </p>
            </div>
            <div className={`${stat.bgColor} ${stat.color} p-3 rounded-lg`}>
              <stat.icon className="h-6 w-6" />
            </div>
          </div>
          {stat.title === "Active Scraping Jobs" && stat.value > 0 && (
            <Badge className="mt-3 bg-orange-100 text-orange-800">
              In Progress
            </Badge>
          )}
        </Card>
      ))}
    </div>
  );
}