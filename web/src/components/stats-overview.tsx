import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Globe, TreePine, FileText, MapPin, Layers } from "lucide-react";

interface Stats {
  totalLanguages: number;
  historicalVariants: number;
  dialects: number;
  wordListsScraped: number;
  baseWords: number;
  scrapingQueue: number;
  totalFamilies?: number;
  totalSubfamilies?: number;
  languagesWithCoordinates?: number;
}

export default function StatsOverview() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
  });

  if (!stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
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
      title: "Languages",
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
      title: "Subfamilies",
      value: stats.totalSubfamilies,
      icon: Layers,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      title: "With Coordinates",
      value: stats.languagesWithCoordinates,
      icon: MapPin,
      color: "text-rose-600",
      bgColor: "bg-rose-100",
    },
  ];

  const vocabularyStats = [
    {
      title: "Base Words",
      value: stats.baseWords,
      icon: FileText,
      color: "text-indigo-600",
      bgColor: "bg-indigo-100",
    },
  ];

  return (
    <div className="space-y-6 mb-6">
      {/* Language & Classification Statistics */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-3" data-testid="text-language-stats-title">
          Language & Classification Statistics
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {languageStats.map((stat, index) => (
            <Card
              key={index}
              className="p-4 bg-gradient-to-br from-blue-50 to-white border-0 shadow-material-1 hover:shadow-material-2 transition-shadow duration-200"
              data-testid={`stat-card-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-600">{stat.title}</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-1" data-testid={`stat-value-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    {(stat.value || 0).toLocaleString()}
                  </p>
                </div>
                <div className={`${stat.bgColor} ${stat.color} p-2 rounded-lg`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Vocabulary Statistics */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-3" data-testid="text-vocabulary-stats-title">
          Vocabulary Data
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vocabularyStats.map((stat, index) => (
            <Card
              key={index}
              className="p-6 bg-gradient-to-br from-purple-50 to-white border-0 shadow-material-1 hover:shadow-material-2 transition-shadow duration-200"
              data-testid={`stat-card-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                  <p className="text-3xl font-semibold text-gray-900 mt-1" data-testid={`stat-value-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                    {(stat.value || 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Core vocabulary concepts from NorthEuraLex</p>
                </div>
                <div className={`${stat.bgColor} ${stat.color} p-3 rounded-lg`}>
                  <stat.icon className="h-6 w-6" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
