import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Filter,
  ChevronRight,
  ChevronDown,
  Hammer,
  Palette,
  Music,
  Footprints,
  Clock,
  MapPin,
} from "lucide-react";
import {
  formatYear,
  getCategoryColor,
  filterByCategory,
  filterByFamily,
  getUniqueCategories,
  getUniqueFamilies,
} from "./material-culture-arts-utils";

// --- Data interfaces ---

interface MaterialCulture {
  id: string;
  name: string;
  category: string;
  originDate: number;
  originCoordinates: [number, number];
  spreadData: { date: number; coordinates: [number, number]; associatedCivilization: string }[];
  description: string;
  associatedLanguages: string[];
  significance: string;
}

interface ArtTradition {
  id: string;
  name: string;
  category: string;
  stylePeriod: string;
  originDate: number;
  endDate: number;
  originCoordinates: { lat: number; lng: number };
  description: string;
  associatedCivilizations: string;
  associatedLanguages: string[];
  keyFeatures: string[];
  notableExamples: string[];
}

interface MusicTradition {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  instruments: string[];
  scales: string[];
  rhythmicPatterns: string[];
  relatedTraditions: string[];
  description: string;
}

interface DanceTradition {
  id: string;
  name: string;
  nativeName: string;
  region: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  danceType: string;
  associatedMusicTraditionIds: string[];
  costumes: string[];
  keyMovements: string[];
  culturalSignificance: string;
  description: string;
}

interface MusicalInstrument {
  id: string;
  name: string;
  nativeName: string;
  instrumentFamily: string;
  originRegion: string;
  coordinates: { lat: number; lng: number };
  timeOrigin: number | null;
  constructionMaterials: string[];
  playingTechnique: string;
  associatedTraditionIds: string[];
  associatedLanguageIds: string[];
  description: string;
}

// --- Props ---

interface Props {
  cultureId?: string;
  languageIds?: string[];
}

// --- Helpers ---

type SubTab = "material" | "art" | "music" | "dance" | "instruments";

const SUB_TABS: { key: SubTab; label: string; icon: typeof Hammer }[] = [
  { key: "material", label: "Material Culture", icon: Hammer },
  { key: "art", label: "Art Traditions", icon: Palette },
  { key: "music", label: "Music", icon: Music },
  { key: "dance", label: "Dance", icon: Footprints },
  { key: "instruments", label: "Instruments", icon: Music },
];

// --- Component ---

export default function MaterialCultureArtsSection({ languageIds }: Props) {
  const [activeTab, setActiveTab] = useState<SubTab>("material");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const { data: materialData } = useQuery<{ items: MaterialCulture[]; count: number }>({
    queryKey: ["/api/material-culture"],
  });

  const { data: artData } = useQuery<{ traditions: ArtTradition[]; count: number }>({
    queryKey: ["/api/art-traditions"],
  });

  const { data: musicData } = useQuery<{ traditions: MusicTradition[]; count: number }>({
    queryKey: ["/api/music-traditions"],
  });

  const { data: danceData } = useQuery<{ traditions: DanceTradition[]; count: number }>({
    queryKey: ["/api/dance-traditions"],
  });

  const { data: instrumentData } = useQuery<{ instruments: MusicalInstrument[]; count: number }>({
    queryKey: ["/api/musical-instruments"],
  });

  // Filter data by associated languages when languageIds are provided
  const materialItems = useMemo(() => {
    const all = materialData?.items ?? [];
    if (!languageIds?.length) return all;
    return all.filter((item) =>
      item.associatedLanguages.some((lang) =>
        languageIds.some((id) => lang.toLowerCase().includes(id.toLowerCase()))
      )
    );
  }, [materialData, languageIds]);

  const artTraditions = useMemo(() => {
    const all = artData?.traditions ?? [];
    if (!languageIds?.length) return all;
    return all.filter((t) =>
      t.associatedLanguages.some((lang) => languageIds.includes(lang))
    );
  }, [artData, languageIds]);

  const musicTraditions = useMemo(() => {
    const all = musicData?.traditions ?? [];
    if (!languageIds?.length) return all;
    return all.filter((t) =>
      t.associatedLanguageIds.some((id) => languageIds.includes(id))
    );
  }, [musicData, languageIds]);

  const danceTraditions = useMemo(() => {
    const all = danceData?.traditions ?? [];
    if (!languageIds?.length) return all;
    return all.filter((t) =>
      t.associatedLanguageIds.some((id) => languageIds.includes(id))
    );
  }, [danceData, languageIds]);

  const instruments = useMemo(() => {
    const all = instrumentData?.instruments ?? [];
    if (!languageIds?.length) return all;
    return all.filter((i) =>
      i.associatedLanguageIds.some((id) => languageIds.includes(id))
    );
  }, [instrumentData, languageIds]);

  // Reset category filter when switching tabs
  const handleTabChange = (tab: SubTab) => {
    setActiveTab(tab);
    setSelectedCategory("all");
    setExpandedItem(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedItem(expandedItem === id ? null : id);
  };

  // Filtered items for current tab
  const filteredMaterial = useMemo(
    () => filterByCategory(materialItems, selectedCategory),
    [materialItems, selectedCategory]
  );

  const filteredArt = useMemo(
    () => filterByCategory(artTraditions, selectedCategory),
    [artTraditions, selectedCategory]
  );

  const filteredInstruments = useMemo(
    () => filterByFamily(instruments, selectedCategory),
    [instruments, selectedCategory]
  );

  // Category options for current tab
  const categoryOptions = useMemo(() => {
    switch (activeTab) {
      case "material":
        return getUniqueCategories(materialItems);
      case "art":
        return getUniqueCategories(artTraditions);
      case "instruments":
        return getUniqueFamilies(instruments);
      default:
        return [];
    }
  }, [activeTab, materialItems, artTraditions, instruments]);

  const showFilter = activeTab === "material" || activeTab === "art" || activeTab === "instruments";

  return (
    <div className="space-y-4">
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap gap-1 border-b pb-2">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-t transition-colors ${
              activeTab === key
                ? "bg-amber-100 text-amber-800 border-b-2 border-amber-600"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
            onClick={() => handleTabChange(key)}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      {showFilter && categoryOptions.length > 0 && (
        <div className="flex items-center space-x-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <select
            className="text-sm border rounded px-2 py-1 bg-white"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">
              All {activeTab === "instruments" ? "Families" : "Categories"}
            </option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      <div className="space-y-2">
        {activeTab === "material" && (
          <MaterialCultureList
            items={filteredMaterial}
            expandedItem={expandedItem}
            onToggle={toggleExpand}
          />
        )}
        {activeTab === "art" && (
          <ArtTraditionsList
            traditions={filteredArt}
            expandedItem={expandedItem}
            onToggle={toggleExpand}
          />
        )}
        {activeTab === "music" && (
          <MusicTraditionsList
            traditions={musicTraditions}
            expandedItem={expandedItem}
            onToggle={toggleExpand}
          />
        )}
        {activeTab === "dance" && (
          <DanceTraditionsList
            traditions={danceTraditions}
            expandedItem={expandedItem}
            onToggle={toggleExpand}
          />
        )}
        {activeTab === "instruments" && (
          <InstrumentsList
            instruments={filteredInstruments}
            expandedItem={expandedItem}
            onToggle={toggleExpand}
          />
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center text-gray-500 py-8 text-sm">
      No {label} found.
    </div>
  );
}

function MaterialCultureList({
  items,
  expandedItem,
  onToggle,
}: {
  items: MaterialCulture[];
  expandedItem: string | null;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return <EmptyState label="material culture items" />;

  return (
    <>
      {items.map((item) => {
        const color = getCategoryColor(item.category);
        const isExpanded = expandedItem === item.id;

        return (
          <Card key={item.id} className="overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
              onClick={() => onToggle(item.id)}
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <h4 className="font-medium text-gray-900 text-sm">{item.name}</h4>
                  <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }}>
                    {item.category}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center space-x-3 text-xs text-gray-500 ml-4.5">
                  <span className="flex items-center space-x-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatYear(item.originDate)}</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <MapPin className="h-3 w-3" />
                    <span>{item.spreadData.length} spread events</span>
                  </span>
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              )}
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t bg-gray-50">
                <p className="mt-3 text-sm text-gray-700">{item.description}</p>

                <div className="mt-3 p-3 bg-white rounded border">
                  <div className="text-xs font-medium text-gray-500 mb-1">Significance</div>
                  <p className="text-sm text-gray-700">{item.significance}</p>
                </div>

                {item.associatedLanguages.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Associated Languages</div>
                    <div className="flex flex-wrap gap-1">
                      {item.associatedLanguages.map((lang, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {lang}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {item.spreadData.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-2">Spread Timeline</div>
                    <div className="space-y-1.5">
                      {item.spreadData.map((event, idx) => (
                        <div key={idx} className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500 w-20 text-right flex-shrink-0">
                            {formatYear(event.date)}
                          </span>
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                          <span className="text-gray-700">{event.associatedCivilization}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

function ArtTraditionsList({
  traditions,
  expandedItem,
  onToggle,
}: {
  traditions: ArtTradition[];
  expandedItem: string | null;
  onToggle: (id: string) => void;
}) {
  if (traditions.length === 0) return <EmptyState label="art traditions" />;

  return (
    <>
      {traditions.map((tradition) => {
        const color = getCategoryColor(tradition.category);
        const isExpanded = expandedItem === tradition.id;

        return (
          <Card key={tradition.id} className="overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
              onClick={() => onToggle(tradition.id)}
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h4 className="font-medium text-gray-900 text-sm">{tradition.name}</h4>
                  <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }}>
                    {tradition.category}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {tradition.stylePeriod} &middot; {formatYear(tradition.originDate)} – {formatYear(tradition.endDate)}
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              )}
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t bg-gray-50">
                <p className="mt-3 text-sm text-gray-700">{tradition.description}</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="p-3 bg-white rounded border">
                    <div className="text-xs font-medium text-gray-500 mb-1">Period</div>
                    <div className="text-sm font-medium">{tradition.stylePeriod}</div>
                    <div className="text-xs text-gray-500">
                      {formatYear(tradition.originDate)} – {formatYear(tradition.endDate)}
                    </div>
                  </div>
                  <div className="p-3 bg-white rounded border">
                    <div className="text-xs font-medium text-gray-500 mb-1">Civilization</div>
                    <div className="text-sm font-medium">{tradition.associatedCivilizations}</div>
                  </div>
                </div>

                {tradition.keyFeatures.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-2">Key Features</div>
                    <div className="flex flex-wrap gap-1.5">
                      {tradition.keyFeatures.map((f, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-1 rounded-full border"
                          style={{ borderColor: color, color }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {tradition.notableExamples.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-2">Notable Examples</div>
                    <div className="grid grid-cols-2 gap-1">
                      {tradition.notableExamples.map((ex, idx) => (
                        <div key={idx} className="text-sm text-gray-700 flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <span>{ex}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

function MusicTraditionsList({
  traditions,
  expandedItem,
  onToggle,
}: {
  traditions: MusicTradition[];
  expandedItem: string | null;
  onToggle: (id: string) => void;
}) {
  if (traditions.length === 0) return <EmptyState label="music traditions" />;

  return (
    <>
      {traditions.map((t) => {
        const isExpanded = expandedItem === t.id;

        return (
          <Card key={t.id} className="overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
              onClick={() => onToggle(t.id)}
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <Music className="h-4 w-4 text-purple-500 flex-shrink-0" />
                  <h4 className="font-medium text-gray-900 text-sm">{t.name}</h4>
                  {t.nativeName !== t.name && (
                    <span className="text-xs text-gray-400">{t.nativeName}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 ml-6">
                  {t.region} &middot; {formatYear(t.timeOrigin)} – {formatYear(t.timeEnd)}
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              )}
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t bg-gray-50">
                <p className="mt-3 text-sm text-gray-700">{t.description}</p>

                {t.instruments.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Instruments</div>
                    <div className="flex flex-wrap gap-1">
                      {t.instruments.map((inst, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs text-purple-700 border-purple-300">
                          {inst}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {t.scales.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Scales / Modes</div>
                    <div className="flex flex-wrap gap-1">
                      {t.scales.map((s, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs text-indigo-700 border-indigo-300">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {t.rhythmicPatterns.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Rhythmic Patterns</div>
                    <div className="flex flex-wrap gap-1">
                      {t.rhythmicPatterns.map((r, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs text-amber-700 border-amber-300">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

function DanceTraditionsList({
  traditions,
  expandedItem,
  onToggle,
}: {
  traditions: DanceTradition[];
  expandedItem: string | null;
  onToggle: (id: string) => void;
}) {
  if (traditions.length === 0) return <EmptyState label="dance traditions" />;

  return (
    <>
      {traditions.map((t) => {
        const isExpanded = expandedItem === t.id;

        return (
          <Card key={t.id} className="overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
              onClick={() => onToggle(t.id)}
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <Footprints className="h-4 w-4 text-orange-500 flex-shrink-0" />
                  <h4 className="font-medium text-gray-900 text-sm">{t.name}</h4>
                  {t.nativeName !== t.name && (
                    <span className="text-xs text-gray-400">{t.nativeName}</span>
                  )}
                  <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">
                    {t.danceType}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-gray-500 ml-6">
                  {t.region} &middot; {formatYear(t.timeOrigin)} – {formatYear(t.timeEnd)}
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              )}
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t bg-gray-50">
                <p className="mt-3 text-sm text-gray-700">{t.description}</p>

                <div className="mt-3 p-3 bg-white rounded border">
                  <div className="text-xs font-medium text-gray-500 mb-1">Cultural Significance</div>
                  <p className="text-sm text-gray-700">{t.culturalSignificance}</p>
                </div>

                {t.costumes.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Costumes & Attire</div>
                    <div className="flex flex-wrap gap-1">
                      {t.costumes.map((c, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {t.keyMovements.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-500 mb-1">Key Movements</div>
                    <div className="flex flex-wrap gap-1">
                      {t.keyMovements.map((m, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-1 rounded-full border border-orange-300 text-orange-700"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

function InstrumentsList({
  instruments,
  expandedItem,
  onToggle,
}: {
  instruments: MusicalInstrument[];
  expandedItem: string | null;
  onToggle: (id: string) => void;
}) {
  if (instruments.length === 0) return <EmptyState label="instruments" />;

  return (
    <>
      {instruments.map((inst) => {
        const color = getCategoryColor(inst.instrumentFamily);
        const isExpanded = expandedItem === inst.id;

        return (
          <Card key={inst.id} className="overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-start justify-between text-left hover:bg-gray-50"
              onClick={() => onToggle(inst.id)}
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h4 className="font-medium text-gray-900 text-sm">{inst.name}</h4>
                  {inst.nativeName !== inst.name && (
                    <span className="text-xs text-gray-400">{inst.nativeName}</span>
                  )}
                  <Badge variant="outline" className="text-xs" style={{ borderColor: color, color }}>
                    {inst.instrumentFamily}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {inst.originRegion}
                  {inst.timeOrigin !== null && <> &middot; {formatYear(inst.timeOrigin)}</>}
                </div>
              </div>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-1" />
              )}
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t bg-gray-50">
                <p className="mt-3 text-sm text-gray-700">{inst.description}</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="p-3 bg-white rounded border">
                    <div className="text-xs font-medium text-gray-500 mb-1">Playing Technique</div>
                    <div className="text-sm font-medium">{inst.playingTechnique}</div>
                  </div>
                  <div className="p-3 bg-white rounded border">
                    <div className="text-xs font-medium text-gray-500 mb-1">Materials</div>
                    <div className="flex flex-wrap gap-1">
                      {inst.constructionMaterials.map((m, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
