import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, TreePine, FileText, Database } from "lucide-react";

interface Stats {
  totalLanguages: number;
  wordListsScraped: number;
  totalFamilies: number;
  phylums: number;
  families: number;
  subfamilies: number;
  branches: number;
  groups: number;
  complexes: number;
  scrapingQueue: number;
}

export default function StatsOverview() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
  });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
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

  const languageStats = [
    {
      title: "Total Languages",
      value: stats.totalLanguages,
      icon: Globe,
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Phylums",
      value: stats.phylums,
      icon: TreePine,
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Families", 
      value: stats.families,
      icon: TreePine,
      color: "text-emerald-600",
      bgColor: "bg-emerald-100",
    },
    {
      title: "Subfamilies",
      value: stats.subfamilies,
      icon: TreePine,
      color: "text-teal-600", 
      bgColor: "bg-teal-100",
    },
    {
      title: "Branches",
      value: stats.branches,
      icon: TreePine,
      color: "text-cyan-600",
      bgColor: "bg-cyan-100",
    },
    {
      title: "Groups",
      value: stats.groups,
      icon: TreePine,
      color: "text-sky-600",
      bgColor: "bg-sky-100",
    },
  ];

  const scrapingStats = [
    {
      title: "Word Lists Scraped",
      value: stats.wordListsScraped,
      icon: FileText,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      title: "Scraping Queue",
      value: stats.scrapingQueue,
      icon: Database,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
  ];

  return (
    <div className="space-y-6 mb-6">
      {/* Language Statistics */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-3" data-testid="text-language-stats-title">
          Language Statistics
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {languageStats.map((stat, index) => (
            <Card
              key={index}
              className="p-4 bg-gradient-to-br from-blue-50 to-white border-0 shadow-material-1 hover:shadow-material-2 transition-shadow duration-200"
              data-testid={`stat-card-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-600">{stat.title}</p>
                  <p className="text-xl font-semibold text-gray-900 mt-1" data-testid={`stat-value-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    {stat.value.toLocaleString()}
                  </p>
                </div>
                <div className={`${stat.bgColor} ${stat.color} p-2 rounded-lg`}>
                  <stat.icon className="h-4 w-4" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Scraping Statistics */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-3" data-testid="text-scraping-stats-title">
          Scraping Statistics
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scrapingStats.map((stat, index) => (
            <Card
              key={index}
              className="p-6 bg-gradient-to-br from-purple-50 to-white border-0 shadow-material-1 hover:shadow-material-2 transition-shadow duration-200"
              data-testid={`stat-card-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1" data-testid={`stat-value-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    {stat.value.toLocaleString()}
                  </p>
                </div>
                <div className={`${stat.bgColor} ${stat.color} p-3 rounded-lg`}>
                  <stat.icon className="h-6 w-6" />
                </div>
              </div>
              {stat.title === "Scraping Queue" && stat.value > 0 && (
                <Badge className="mt-3 bg-orange-100 text-orange-800">
                  In Progress
                </Badge>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}