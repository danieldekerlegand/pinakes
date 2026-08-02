import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Search, X, Music } from "lucide-react";
import type { Language } from "@contracts/types";
import { PhonemeHeatmapGrid, type PhonemeHeatmapCell } from "./HeatmapGrid";
import { ComparisonTable, type ComparisonColumn, type ComparisonRow } from "./ComparisonTable";

interface PhonologicalInventory {
  id: string;
  languageId: string;
  consonants: string[];
  vowels: string[];
  tones: string[] | null;
  phonotacticPatterns: Record<string, unknown>;
  syllableStructure: string;
  stressSystem: string;
}

const PLACES = [
  "Bilabial", "Labiodental", "Dental", "Alveolar", "Postalveolar",
  "Retroflex", "Palatal", "Velar", "Uvular", "Pharyngeal", "Glottal",
] as const;

const MANNERS = [
  "Plosive", "Nasal", "Trill", "Tap/Flap", "Fricative",
  "Lateral fricative", "Approximant", "Lateral approximant",
] as const;

const IPA_CONSONANT_MAP: Record<string, { place: string; manner: string; voiced: boolean }> = {
  "p": { place: "Bilabial", manner: "Plosive", voiced: false },
  "b": { place: "Bilabial", manner: "Plosive", voiced: true },
  "t": { place: "Alveolar", manner: "Plosive", voiced: false },
  "d": { place: "Alveolar", manner: "Plosive", voiced: true },
  "ʈ": { place: "Retroflex", manner: "Plosive", voiced: false },
  "ɖ": { place: "Retroflex", manner: "Plosive", voiced: true },
  "c": { place: "Palatal", manner: "Plosive", voiced: false },
  "ɟ": { place: "Palatal", manner: "Plosive", voiced: true },
  "k": { place: "Velar", manner: "Plosive", voiced: false },
  "ɡ": { place: "Velar", manner: "Plosive", voiced: true },
  "g": { place: "Velar", manner: "Plosive", voiced: true },
  "q": { place: "Uvular", manner: "Plosive", voiced: false },
  "ɢ": { place: "Uvular", manner: "Plosive", voiced: true },
  "ʔ": { place: "Glottal", manner: "Plosive", voiced: false },
  "m": { place: "Bilabial", manner: "Nasal", voiced: true },
  "ɱ": { place: "Labiodental", manner: "Nasal", voiced: true },
  "n": { place: "Alveolar", manner: "Nasal", voiced: true },
  "ɳ": { place: "Retroflex", manner: "Nasal", voiced: true },
  "ɲ": { place: "Palatal", manner: "Nasal", voiced: true },
  "ŋ": { place: "Velar", manner: "Nasal", voiced: true },
  "ɴ": { place: "Uvular", manner: "Nasal", voiced: true },
  "ʙ": { place: "Bilabial", manner: "Trill", voiced: true },
  "r": { place: "Alveolar", manner: "Trill", voiced: true },
  "ʀ": { place: "Uvular", manner: "Trill", voiced: true },
  "ⱱ": { place: "Labiodental", manner: "Tap/Flap", voiced: true },
  "ɾ": { place: "Alveolar", manner: "Tap/Flap", voiced: true },
  "ɽ": { place: "Retroflex", manner: "Tap/Flap", voiced: true },
  "ɸ": { place: "Bilabial", manner: "Fricative", voiced: false },
  "β": { place: "Bilabial", manner: "Fricative", voiced: true },
  "f": { place: "Labiodental", manner: "Fricative", voiced: false },
  "v": { place: "Labiodental", manner: "Fricative", voiced: true },
  "θ": { place: "Dental", manner: "Fricative", voiced: false },
  "ð": { place: "Dental", manner: "Fricative", voiced: true },
  "s": { place: "Alveolar", manner: "Fricative", voiced: false },
  "z": { place: "Alveolar", manner: "Fricative", voiced: true },
  "ʃ": { place: "Postalveolar", manner: "Fricative", voiced: false },
  "ʒ": { place: "Postalveolar", manner: "Fricative", voiced: true },
  "ʂ": { place: "Retroflex", manner: "Fricative", voiced: false },
  "ʐ": { place: "Retroflex", manner: "Fricative", voiced: true },
  "ç": { place: "Palatal", manner: "Fricative", voiced: false },
  "ʝ": { place: "Palatal", manner: "Fricative", voiced: true },
  "x": { place: "Velar", manner: "Fricative", voiced: false },
  "ɣ": { place: "Velar", manner: "Fricative", voiced: true },
  "χ": { place: "Uvular", manner: "Fricative", voiced: false },
  "ʁ": { place: "Uvular", manner: "Fricative", voiced: true },
  "ħ": { place: "Pharyngeal", manner: "Fricative", voiced: false },
  "ʕ": { place: "Pharyngeal", manner: "Fricative", voiced: true },
  "h": { place: "Glottal", manner: "Fricative", voiced: false },
  "ɦ": { place: "Glottal", manner: "Fricative", voiced: true },
  "ɬ": { place: "Alveolar", manner: "Lateral fricative", voiced: false },
  "ɮ": { place: "Alveolar", manner: "Lateral fricative", voiced: true },
  "ʋ": { place: "Labiodental", manner: "Approximant", voiced: true },
  "ɹ": { place: "Alveolar", manner: "Approximant", voiced: true },
  "ɻ": { place: "Retroflex", manner: "Approximant", voiced: true },
  "j": { place: "Palatal", manner: "Approximant", voiced: true },
  "ɰ": { place: "Velar", manner: "Approximant", voiced: true },
  "l": { place: "Alveolar", manner: "Lateral approximant", voiced: true },
  "ɭ": { place: "Retroflex", manner: "Lateral approximant", voiced: true },
  "ʎ": { place: "Palatal", manner: "Lateral approximant", voiced: true },
  "ʟ": { place: "Velar", manner: "Lateral approximant", voiced: true },
  "w": { place: "Velar", manner: "Approximant", voiced: true },
  "ʍ": { place: "Velar", manner: "Fricative", voiced: false },
};

const LANG_COLORS = [
  { bg: "bg-blue-500", text: "text-blue-700", fill: "#3b82f6", light: "bg-blue-100" },
  { bg: "bg-red-500", text: "text-red-700", fill: "#ef4444", light: "bg-red-100" },
  { bg: "bg-green-500", text: "text-green-700", fill: "#22c55e", light: "bg-green-100" },
  { bg: "bg-amber-500", text: "text-amber-700", fill: "#f59e0b", light: "bg-amber-100" },
];

const MAX_LANGUAGES = 4;

export function PhonemeComparisonView() {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ["/api/languages"],
  });

  const { data: inventories = [] } = useQuery<PhonologicalInventory[]>({
    queryKey: ["/api/phonological-inventories"],
  });

  const languagesWithData = useMemo(() => {
    const idsWithData = new Set(inventories.map((inv) => inv.languageId));
    return languages.filter((lang) => idsWithData.has(lang.id));
  }, [languages, inventories]);

  const filteredLanguages = useMemo(() => {
    return languagesWithData.filter(
      (lang) =>
        lang.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lang.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [languagesWithData, searchTerm]);

  const selectedInventories = useMemo(() => {
    return selectedLanguages
      .map((langId) => inventories.find((inv) => inv.languageId === langId))
      .filter((inv): inv is PhonologicalInventory => inv !== undefined);
  }, [selectedLanguages, inventories]);

  const toggleLanguage = (languageId: string) => {
    setSelectedLanguages((prev) => {
      if (prev.includes(languageId)) {
        return prev.filter((id) => id !== languageId);
      }
      if (prev.length >= MAX_LANGUAGES) return prev;
      return [...prev, languageId];
    });
  };

  const getLangName = (langId: string) =>
    languages.find((l) => l.id === langId)?.name || langId;

  // Overlap analysis
  const overlapAnalysis = useMemo(() => {
    if (selectedInventories.length < 2) return null;
    const consonantSets = selectedInventories.map((inv) => new Set(inv.consonants));
    const vowelSets = selectedInventories.map((inv) => new Set(inv.vowels));
    const sharedConsonants = new Set(
      Array.from(consonantSets[0]).filter((p) => consonantSets.every((s) => s.has(p)))
    );
    const sharedVowels = new Set(
      Array.from(vowelSets[0]).filter((p) => vowelSets.every((s) => s.has(p)))
    );
    return { sharedConsonants, sharedVowels };
  }, [selectedInventories]);

  // Build HeatmapGrid data from consonant chart
  const heatmapData = useMemo(() => {
    const data: Record<string, Record<string, PhonemeHeatmapCell>> = {};
    for (const manner of MANNERS) {
      data[manner] = {};
      for (const place of PLACES) {
        data[manner][place] = { value: 0, label: "", items: [] };
      }
    }
    selectedInventories.forEach((inv, langIndex) => {
      for (const phoneme of inv.consonants) {
        const info = IPA_CONSONANT_MAP[phoneme];
        if (info && data[info.manner]?.[info.place]) {
          const cell = data[info.manner][info.place];
          cell.items.push({ text: phoneme, colorIndex: langIndex });
          cell.value = cell.items.length;
        }
      }
    });
    return data;
  }, [selectedInventories]);

  // Highlighted cells (shared phonemes)
  const highlightedCells = useMemo(() => {
    if (!overlapAnalysis) return undefined;
    const cells = new Set<string>();
    for (const manner of MANNERS) {
      for (const place of PLACES) {
        const cell = heatmapData[manner]?.[place];
        if (cell && cell.items.some((item) => overlapAnalysis.sharedConsonants.has(item.text))) {
          cells.add(`${manner}|${place}`);
        }
      }
    }
    return cells;
  }, [heatmapData, overlapAnalysis]);

  // Build ComparisonTable data
  const comparisonColumns: ComparisonColumn[] = useMemo(
    () =>
      selectedInventories.map((inv, idx) => ({
        id: inv.languageId,
        label: getLangName(inv.languageId),
        colorClass: LANG_COLORS[idx].text,
      })),
    [selectedInventories, languages]
  );

  const comparisonRows: ComparisonRow[] = useMemo(
    () => [
      {
        label: "Total Consonants",
        values: Object.fromEntries(
          selectedInventories.map((inv) => [inv.languageId, inv.consonants.length])
        ),
      },
      {
        label: "Total Vowels",
        values: Object.fromEntries(
          selectedInventories.map((inv) => [inv.languageId, inv.vowels.length])
        ),
      },
      {
        label: "Has Tones",
        values: Object.fromEntries(
          selectedInventories.map((inv) => [
            inv.languageId,
            inv.tones ? `Yes (${inv.tones.length})` : "No",
          ])
        ),
      },
      {
        label: "Syllable Structure",
        values: Object.fromEntries(
          selectedInventories.map((inv) => [inv.languageId, inv.syllableStructure])
        ),
        mono: true,
      },
      {
        label: "Stress System",
        values: Object.fromEntries(
          selectedInventories.map((inv) => [inv.languageId, inv.stressSystem])
        ),
      },
    ],
    [selectedInventories]
  );

  const comparisonFooter = overlapAnalysis
    ? `Shared phonemes: ${overlapAnalysis.sharedConsonants.size} consonants, ${overlapAnalysis.sharedVowels.size} vowels in common across all selected languages`
    : undefined;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center">
          <Music className="h-5 w-5 mr-2" />
          Phoneme Comparison
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          Compare phonological inventories across languages using heatmap and comparison views
        </p>
      </div>

      {/* Language Selection */}
      <div>
        <Label className="text-sm font-medium mb-3 block">
          Select Languages to Compare (2-{MAX_LANGUAGES})
        </Label>
        {selectedLanguages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {selectedLanguages.map((langId, idx) => (
              <Badge
                key={langId}
                className={`${LANG_COLORS[idx].bg} text-white cursor-pointer`}
                onClick={() => toggleLanguage(langId)}
              >
                {getLangName(langId)} <X className="h-3 w-3 ml-1" />
              </Badge>
            ))}
          </div>
        )}
        <div className="relative mb-3">
          <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
          <Input
            placeholder="Search languages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="h-48 border rounded-lg overflow-hidden">
          <ScrollArea className="h-full p-3">
            <div className="grid grid-cols-3 gap-1">
              {filteredLanguages.map((language) => {
                const isSelected = selectedLanguages.includes(language.id);
                const langIndex = selectedLanguages.indexOf(language.id);
                return (
                  <div
                    key={language.id}
                    className={`flex items-center space-x-2 p-1.5 rounded cursor-pointer text-sm ${
                      isSelected
                        ? LANG_COLORS[langIndex]?.light || "bg-gray-100"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => toggleLanguage(language.id)}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={!isSelected && selectedLanguages.length >= MAX_LANGUAGES}
                    />
                    <span className="truncate">{language.name}</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Results */}
      {selectedInventories.length >= 2 && (
        <>
          {/* Summary via ComparisonTable */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Summary Statistics</h3>
            <ComparisonTable
              columns={comparisonColumns}
              rows={comparisonRows}
              footer={comparisonFooter}
            />
          </Card>

          {/* IPA Consonant Heatmap */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">IPA Consonant Heatmap</h3>
            <PhonemeHeatmapGrid
              rows={MANNERS}
              columns={PLACES}
              data={heatmapData}
              colors={LANG_COLORS.map((c) => c.bg)}
              highlightCells={highlightedCells}
              cornerLabel="Manner \ Place"
            />
            <div className="flex items-center gap-4 mt-3 text-xs text-gray-600">
              {selectedLanguages.map((langId, idx) => (
                <div key={langId} className="flex items-center gap-1">
                  <span className={`inline-block w-3 h-3 rounded ${LANG_COLORS[idx].bg}`} />
                  {getLangName(langId)}
                </div>
              ))}
              {overlapAnalysis && (
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded bg-yellow-200 border border-yellow-400" />
                  Shared
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {selectedInventories.length < 2 && selectedLanguages.length > 0 && (
        <div className="text-center text-gray-500 py-8">
          Select at least 2 languages to compare phonological inventories
        </div>
      )}

      {selectedLanguages.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          <Music className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Select 2-{MAX_LANGUAGES} languages above to compare their sound systems</p>
          <p className="text-xs mt-2">
            {languagesWithData.length} languages with phonological data available
          </p>
        </div>
      )}
    </div>
  );
}
