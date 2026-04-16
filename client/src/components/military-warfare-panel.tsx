import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Swords, Filter, ChevronRight, ChevronDown, MapPin, Clock, Shield, Skull } from "lucide-react";
import VisualizationRecommendations from "@/components/VisualizationRecommendations";

interface Battle {
  id: string;
  name: string;
  date: string;
  coordinates: [number, number];
  belligerents: Array<{ name: string; civilization_id: string | null }>;
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

interface BattlesResponse {
  battles: Battle[];
  count: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

const WAR_COLORS: Record<string, string> = {
  "Egyptian-Hittite Wars": "#d97706",
  "Greco-Persian Wars": "#2563eb",
  "Peloponnesian War": "#7c3aed",
  "Wars of Alexander the Great": "#16a34a",
  "Punic Wars": "#dc2626",
  "Gallic Wars": "#0891b2",
  "Roman Civil Wars": "#4f46e5",
  "Roman-Parthian Wars": "#db2777",
  "Jewish-Roman Wars": "#65a30d",
  "Gothic Wars": "#c026d3",
  "Arab Conquests": "#ea580c",
  "Crusades": "#0d9488",
  "Mongol Conquests": "#b91c1c",
  "Hundred Years' War": "#1d4ed8",
  "Ottoman Conquests": "#047857",
};

function getWarColor(warName: string): string {
  return WAR_COLORS[warName] || "#6b7280";
}

function getOutcomeStyle(outcome: string): { bg: string; text: string } {
  const lower = outcome.toLowerCase();
  if (lower.includes("decisive") && lower.includes("victory")) {
    return { bg: "bg-green-100", text: "text-green-800" };
  }
  if (lower.includes("victory")) {
    return { bg: "bg-blue-100", text: "text-blue-800" };
  }
  if (lower.includes("stalemate") || lower.includes("inconclusive")) {
    return { bg: "bg-yellow-100", text: "text-yellow-800" };
  }
  if (lower.includes("defeat") || lower.includes("destruction")) {
    return { bg: "bg-red-100", text: "text-red-800" };
  }
  return { bg: "bg-gray-100", text: "text-gray-800" };
}

export default function MilitaryWarfarePanel({ isOpen, onClose, embedded }: Props) {
  const [selectedWar, setSelectedWar] = useState<string>("all");
  const [expandedBattle, setExpandedBattle] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"timeline" | "cards">("timeline");

  const { data: battlesData } = useQuery<BattlesResponse>({
    queryKey: ["/api/battles"],
    enabled: isOpen || !!embedded,
  });

  const battles = battlesData?.battles ?? [];

  const wars = useMemo(() => {
    const warSet = new Set<string>();
    battles.forEach((b) => warSet.add(b.warName));
    return Array.from(warSet).sort();
  }, [battles]);

  const filteredBattles = useMemo(() => {
    if (selectedWar === "all") return battles;
    return battles.filter((b) => b.warName === selectedWar);
  }, [battles, selectedWar]);

  const timelineSorted = useMemo(() => {
    return [...filteredBattles].sort((a, b) => parseInt(a.date) - parseInt(b.date));
  }, [filteredBattles]);

  const timelineRange = useMemo(() => {
    if (timelineSorted.length === 0) return { min: -1500, max: 2000 };
    const dates = timelineSorted.map((b) => parseInt(b.date));
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const padding = Math.max((max - min) * 0.1, 100);
    return { min: min - padding, max: max + padding };
  }, [timelineSorted]);

  if (!isOpen && !embedded) return null;

  const yearToPercent = (year: number) => {
    const range = timelineRange.max - timelineRange.min;
    return ((year - timelineRange.min) / range) * 100;
  };

  const panelContent = (
    <div className={embedded ? "h-full flex flex-col bg-white" : "fixed right-0 top-0 h-full w-[900px] max-w-full bg-white shadow-xl z-50 flex flex-col overflow-hidden"}>
      {/* Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-red-50 to-orange-50 flex-shrink-0">
        <div className="flex justify-between items-start">
          <div className="flex items-center space-x-3">
            <Swords className="h-6 w-6 text-red-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Military &amp; Warfare
              </h2>
              <p className="text-sm text-gray-600">
                Explore battles, wars, and their impact on language and civilization
              </p>
            </div>
          </div>
          {!embedded && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-4 mt-4">
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <select
              className="text-sm border rounded px-2 py-1 bg-white"
              value={selectedWar}
              onChange={(e) => setSelectedWar(e.target.value)}
            >
              <option value="all">All Wars ({battles.length} battles)</option>
              {wars.map((w) => (
                <option key={w} value={w}>
                  {w} ({battles.filter((b) => b.warName === w).length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "timeline" ? "bg-red-100 text-red-800" : "bg-white text-gray-600"}`}
              onClick={() => setViewMode("timeline")}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Timeline</span>
            </button>
            <button
              className={`px-3 py-1 text-sm flex items-center space-x-1 ${viewMode === "cards" ? "bg-red-100 text-red-800" : "bg-white text-gray-600"}`}
              onClick={() => setViewMode("cards")}
            >
              <span>Cards</span>
            </button>
          </div>

          <div className="ml-auto text-sm text-gray-500">
            {filteredBattles.length} battle{filteredBattles.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {viewMode === "timeline" ? (
          <div className="relative">
            {/* Timeline axis */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{formatYear(timelineRange.min)}</span>
                <span>{formatYear(Math.round((timelineRange.min + timelineRange.max) / 2))}</span>
                <span>{formatYear(timelineRange.max)}</span>
              </div>
              <div className="h-1 bg-gray-200 rounded relative">
                {timelineRange.min < 0 && timelineRange.max > 0 && (
                  <div
                    className="absolute h-full bg-gray-400 rounded"
                    style={{ left: `${yearToPercent(0)}%`, width: "1px" }}
                  />
                )}
              </div>
            </div>

            {/* Timeline entries */}
            <div className="space-y-2">
              {timelineSorted.map((battle) => {
                const dateNum = parseInt(battle.date);
                const left = yearToPercent(dateNum);
                const color = getWarColor(battle.warName);
                const isExpanded = expandedBattle === battle.id;

                return (
                  <div key={battle.id} className="relative">
                    <div className="flex items-center space-x-3">
                      <div className="w-44 text-xs text-gray-600 text-right flex-shrink-0 truncate">
                        {battle.name}
                      </div>
                      <div className="flex-1 relative h-6">
                        <div className="absolute inset-0 bg-gray-50 rounded" />
                        <button
                          className="absolute h-full rounded-full hover:opacity-80 transition-opacity cursor-pointer"
                          style={{
                            left: `${left}%`,
                            width: "12px",
                            transform: "translateX(-6px)",
                            backgroundColor: color,
                            opacity: isExpanded ? 1 : 0.7,
                          }}
                          title={`${battle.name} (${formatYear(dateNum)})`}
                          onClick={() => setExpandedBattle(isExpanded ? null : battle.id)}
                        />
                      </div>
                      <div className="w-24 text-xs text-gray-500 flex-shrink-0">
                        {formatYear(dateNum)}
                      </div>
                    </div>

                    {isExpanded && <BattleDetail battle={battle} />}
                  </div>
                );
              })}
            </div>

            {filteredBattles.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                No battles found for this filter.
              </div>
            )}
          </div>
        ) : (
          /* Cards view */
          <div className="space-y-3">
            {filteredBattles.map((battle) => {
              const isExpanded = expandedBattle === battle.id;
              const color = getWarColor(battle.warName);
              const outcomeStyle = getOutcomeStyle(battle.outcome);

              return (
                <Card key={battle.id} className="overflow-hidden">
                  <button
                    className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
                    onClick={() => setExpandedBattle(isExpanded ? null : battle.id)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <h3 className="font-medium text-gray-900">{battle.name}</h3>
                        <Badge
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: color, color }}
                        >
                          {battle.warName}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center space-x-4 text-sm text-gray-500">
                        <span>{formatYear(parseInt(battle.date))}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${outcomeStyle.bg} ${outcomeStyle.text}`}>
                          {battle.outcome}
                        </span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    )}
                  </button>

                  {isExpanded && <BattleDetail battle={battle} />}
                </Card>
              );
            })}

            {filteredBattles.length === 0 && (
              <div className="text-center text-gray-500 py-12">
                No battles found for this filter.
              </div>
            )}
          </div>
        )}

        <VisualizationRecommendations panelType="military-warfare" onClose={onClose} />
      </div>
    </div>
  );

  if (embedded) {
    return panelContent;
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      {panelContent}
    </>
  );
}

function BattleDetail({ battle }: { battle: Battle }) {
  const color = getWarColor(battle.warName);
  const outcomeStyle = getOutcomeStyle(battle.outcome);

  return (
    <div className="px-4 pb-4 border-t bg-gray-50">
      <div className="mt-3 text-sm text-gray-700">{battle.significance}</div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1 flex items-center space-x-1">
            <Shield className="h-3 w-3" />
            <span>Belligerents</span>
          </div>
          <div className="space-y-1">
            {battle.belligerents.map((b, idx) => (
              <div key={idx} className="text-sm font-medium flex items-center space-x-1.5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: idx === 0 ? color : "#9ca3af" }}
                />
                <span>{b.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1 flex items-center space-x-1">
            <Skull className="h-3 w-3" />
            <span>Casualties</span>
          </div>
          <div className="text-sm font-medium">{battle.casualtiesEstimate}</div>
          <div className={`text-xs mt-1 px-1.5 py-0.5 rounded inline-block ${outcomeStyle.bg} ${outcomeStyle.text}`}>
            {battle.outcome}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1 flex items-center space-x-1">
            <MapPin className="h-3 w-3" />
            <span>Location</span>
          </div>
          <div className="text-sm text-gray-700">
            {battle.coordinates[0].toFixed(2)}°N, {battle.coordinates[1].toFixed(2)}°E
          </div>
        </div>
        <div className="p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1 flex items-center space-x-1">
            <Swords className="h-3 w-3" />
            <span>War</span>
          </div>
          <div className="text-sm font-medium" style={{ color }}>
            {battle.warName}
          </div>
        </div>
      </div>

      {battle.associatedLanguageChanges && (
        <div className="mt-3 p-3 bg-white rounded border">
          <div className="text-xs font-medium text-gray-500 mb-1">Language Impact</div>
          <div className="text-sm text-gray-700">{battle.associatedLanguageChanges}</div>
        </div>
      )}
    </div>
  );
}
