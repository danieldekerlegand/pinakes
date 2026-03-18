import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import {
  Search,
  X,
  Music,
} from "lucide-react";
import type { Language } from "@shared/types";

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

interface PhonologyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Standard IPA consonant chart layout
// Columns: places of articulation
const PLACES = [
  "Bilabial", "Labiodental", "Dental", "Alveolar", "Postalveolar",
  "Retroflex", "Palatal", "Velar", "Uvular", "Pharyngeal", "Glottal"
] as const;

// Rows: manners of articulation
const MANNERS = [
  "Plosive", "Nasal", "Trill", "Tap/Flap", "Fricative",
  "Lateral fricative", "Approximant", "Lateral approximant"
] as const;

// IPA consonant mapping: phoneme -> { place, manner, voiced }
const IPA_CONSONANT_MAP: Record<string, { place: string; manner: string; voiced: boolean }> = {
  // Plosives
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
  // Nasals
  "m": { place: "Bilabial", manner: "Nasal", voiced: true },
  "ɱ": { place: "Labiodental", manner: "Nasal", voiced: true },
  "n": { place: "Alveolar", manner: "Nasal", voiced: true },
  "ɳ": { place: "Retroflex", manner: "Nasal", voiced: true },
  "ɲ": { place: "Palatal", manner: "Nasal", voiced: true },
  "ŋ": { place: "Velar", manner: "Nasal", voiced: true },
  "ɴ": { place: "Uvular", manner: "Nasal", voiced: true },
  // Trills
  "ʙ": { place: "Bilabial", manner: "Trill", voiced: true },
  "r": { place: "Alveolar", manner: "Trill", voiced: true },
  "ʀ": { place: "Uvular", manner: "Trill", voiced: true },
  // Taps/Flaps
  "ⱱ": { place: "Labiodental", manner: "Tap/Flap", voiced: true },
  "ɾ": { place: "Alveolar", manner: "Tap/Flap", voiced: true },
  "ɽ": { place: "Retroflex", manner: "Tap/Flap", voiced: true },
  // Fricatives
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
  // Lateral fricatives
  "ɬ": { place: "Alveolar", manner: "Lateral fricative", voiced: false },
  "ɮ": { place: "Alveolar", manner: "Lateral fricative", voiced: true },
  // Approximants
  "ʋ": { place: "Labiodental", manner: "Approximant", voiced: true },
  "ɹ": { place: "Alveolar", manner: "Approximant", voiced: true },
  "ɻ": { place: "Retroflex", manner: "Approximant", voiced: true },
  "j": { place: "Palatal", manner: "Approximant", voiced: true },
  "ɰ": { place: "Velar", manner: "Approximant", voiced: true },
  // Lateral approximants
  "l": { place: "Alveolar", manner: "Lateral approximant", voiced: true },
  "ɭ": { place: "Retroflex", manner: "Lateral approximant", voiced: true },
  "ʎ": { place: "Palatal", manner: "Lateral approximant", voiced: true },
  "ʟ": { place: "Velar", manner: "Lateral approximant", voiced: true },
  // Common co-articulated consonants (map to nearest cell)
  "w": { place: "Velar", manner: "Approximant", voiced: true },
  "ʍ": { place: "Velar", manner: "Fricative", voiced: false },
};

// IPA vowel positions for trapezoid chart
// x: 0 (front) to 100 (back), y: 0 (close) to 100 (open)
const IPA_VOWEL_MAP: Record<string, { x: number; y: number; rounded: boolean }> = {
  // Close
  "i": { x: 10, y: 5, rounded: false },
  "y": { x: 18, y: 5, rounded: true },
  "ɨ": { x: 45, y: 5, rounded: false },
  "ʉ": { x: 53, y: 5, rounded: true },
  "ɯ": { x: 82, y: 5, rounded: false },
  "u": { x: 90, y: 5, rounded: true },
  // Near-close
  "ɪ": { x: 18, y: 20, rounded: false },
  "ʏ": { x: 26, y: 20, rounded: true },
  "ʊ": { x: 82, y: 20, rounded: true },
  // Close-mid
  "e": { x: 18, y: 33, rounded: false },
  "ø": { x: 26, y: 33, rounded: true },
  "ɘ": { x: 48, y: 33, rounded: false },
  "ɵ": { x: 56, y: 33, rounded: true },
  "ɤ": { x: 78, y: 33, rounded: false },
  "o": { x: 86, y: 33, rounded: true },
  // Mid
  "ə": { x: 50, y: 50, rounded: false },
  // Open-mid
  "ɛ": { x: 26, y: 62, rounded: false },
  "œ": { x: 34, y: 62, rounded: true },
  "ɜ": { x: 50, y: 62, rounded: false },
  "ɞ": { x: 58, y: 62, rounded: true },
  "ʌ": { x: 72, y: 62, rounded: false },
  "ɔ": { x: 80, y: 62, rounded: true },
  // Near-open
  "æ": { x: 30, y: 80, rounded: false },
  "ɐ": { x: 50, y: 80, rounded: false },
  // Open
  "a": { x: 30, y: 95, rounded: false },
  "ɶ": { x: 38, y: 95, rounded: true },
  "ɑ": { x: 82, y: 95, rounded: false },
  "ɒ": { x: 90, y: 95, rounded: true },
};

const LANG_COLORS = [
  { bg: "bg-blue-500", text: "text-blue-700", fill: "#3b82f6", light: "bg-blue-100" },
  { bg: "bg-red-500", text: "text-red-700", fill: "#ef4444", light: "bg-red-100" },
  { bg: "bg-green-500", text: "text-green-700", fill: "#22c55e", light: "bg-green-100" },
  { bg: "bg-amber-500", text: "text-amber-700", fill: "#f59e0b", light: "bg-amber-100" },
];

const MAX_LANGUAGES = 4;

export default function PhonologyPanel({ isOpen, onClose }: PhonologyPanelProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ["/api/languages"],
  });

  const { data: inventories = [] } = useQuery<PhonologicalInventory[]>({
    queryKey: ["/api/phonological-inventories"],
  });

  // Filter languages to only those with phonological data
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

  // Get inventories for selected languages
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

  // Build consonant chart data: for each cell, which languages have phonemes there
  const consonantChartData = useMemo(() => {
    const data: Record<string, Record<string, { phoneme: string; langIndex: number }[]>> = {};
    for (const manner of MANNERS) {
      data[manner] = {};
      for (const place of PLACES) {
        data[manner][place] = [];
      }
    }

    selectedInventories.forEach((inv, langIndex) => {
      for (const phoneme of inv.consonants) {
        const info = IPA_CONSONANT_MAP[phoneme];
        if (info && data[info.manner]?.[info.place]) {
          data[info.manner][info.place].push({ phoneme, langIndex });
        }
      }
    });

    return data;
  }, [selectedInventories]);

  // Build vowel chart data
  const vowelChartData = useMemo(() => {
    const data: { phoneme: string; langIndex: number; x: number; y: number }[] = [];
    selectedInventories.forEach((inv, langIndex) => {
      for (const phoneme of inv.vowels) {
        const pos = IPA_VOWEL_MAP[phoneme];
        if (pos) {
          data.push({ phoneme, langIndex, x: pos.x, y: pos.y });
        }
      }
    });
    return data;
  }, [selectedInventories]);

  // Determine shared vs unique phonemes
  const overlapAnalysis = useMemo(() => {
    if (selectedInventories.length < 2) return null;

    const allConsonantSets = selectedInventories.map((inv) => new Set<string>(inv.consonants));
    const allVowelSets = selectedInventories.map((inv) => new Set<string>(inv.vowels));

    // Shared = present in ALL selected languages
    const sharedConsonants = Array.from(allConsonantSets[0]).filter((p) =>
      allConsonantSets.every((s) => s.has(p))
    );
    const sharedVowels = Array.from(allVowelSets[0]).filter((p) =>
      allVowelSets.every((s) => s.has(p))
    );

    return { sharedConsonants: new Set(sharedConsonants), sharedVowels: new Set(sharedVowels) };
  }, [selectedInventories]);

  if (!isOpen) return null;

  const getLangName = (langId: string) =>
    languages.find((l) => l.id === langId)?.name || langId;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-[1000px] max-w-[95vw] bg-white shadow-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Music className="h-5 w-5 mr-2" />
                Phonological Inventory Comparison
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Compare sound systems across languages on IPA charts
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Language Selection */}
            <div>
              <Label className="text-sm font-medium mb-3 block">
                Select Languages to Compare (2-{MAX_LANGUAGES})
              </Label>

              {/* Selected badges */}
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
                {/* Summary Statistics */}
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Summary Statistics</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4">Feature</th>
                          {selectedInventories.map((inv, idx) => (
                            <th
                              key={inv.languageId}
                              className={`text-left py-2 px-2 ${LANG_COLORS[idx].text}`}
                            >
                              {getLangName(inv.languageId)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b">
                          <td className="py-2 pr-4 font-medium">Total Consonants</td>
                          {selectedInventories.map((inv, idx) => (
                            <td key={inv.languageId} className="py-2 px-2">
                              {inv.consonants.length}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 pr-4 font-medium">Total Vowels</td>
                          {selectedInventories.map((inv, idx) => (
                            <td key={inv.languageId} className="py-2 px-2">
                              {inv.vowels.length}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 pr-4 font-medium">Has Tones</td>
                          {selectedInventories.map((inv, idx) => (
                            <td key={inv.languageId} className="py-2 px-2">
                              {inv.tones ? `Yes (${inv.tones.length})` : "No"}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 pr-4 font-medium">Syllable Structure</td>
                          {selectedInventories.map((inv, idx) => (
                            <td key={inv.languageId} className="py-2 px-2 font-mono text-xs">
                              {inv.syllableStructure}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="py-2 pr-4 font-medium">Stress System</td>
                          {selectedInventories.map((inv, idx) => (
                            <td key={inv.languageId} className="py-2 px-2 text-xs">
                              {inv.stressSystem}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {overlapAnalysis && (
                    <div className="mt-3 pt-3 border-t text-xs text-gray-600">
                      <span className="font-medium">Shared phonemes: </span>
                      {overlapAnalysis.sharedConsonants.size} consonants,{" "}
                      {overlapAnalysis.sharedVowels.size} vowels in common across all selected
                      languages
                    </div>
                  )}
                </Card>

                {/* IPA Consonant Chart */}
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">IPA Consonant Chart</h3>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse w-full">
                      <thead>
                        <tr>
                          <th className="border border-gray-300 px-1 py-1 bg-gray-50 text-left min-w-[80px]">
                            Manner \ Place
                          </th>
                          {PLACES.map((place) => (
                            <th
                              key={place}
                              className="border border-gray-300 px-1 py-1 bg-gray-50 text-center"
                              style={{ minWidth: "60px" }}
                            >
                              <span className="text-[10px] leading-tight block">{place}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {MANNERS.map((manner) => (
                          <tr key={manner}>
                            <td className="border border-gray-300 px-1 py-1 bg-gray-50 font-medium text-[10px]">
                              {manner}
                            </td>
                            {PLACES.map((place) => {
                              const cellPhonemes = consonantChartData[manner]?.[place] || [];
                              const isShared =
                                overlapAnalysis &&
                                cellPhonemes.length > 0 &&
                                cellPhonemes.some((p) =>
                                  overlapAnalysis.sharedConsonants.has(p.phoneme)
                                );
                              return (
                                <td
                                  key={place}
                                  className={`border border-gray-300 px-1 py-1 text-center ${
                                    isShared ? "bg-yellow-50" : ""
                                  }`}
                                >
                                  {cellPhonemes.length > 0 && (
                                    <div className="flex flex-wrap justify-center gap-0.5">
                                      {cellPhonemes.map((p, i) => (
                                        <span
                                          key={`${p.phoneme}-${p.langIndex}-${i}`}
                                          className={`inline-block rounded px-0.5 text-white text-[11px] font-mono ${LANG_COLORS[p.langIndex].bg}`}
                                          title={`${p.phoneme} - ${getLangName(selectedLanguages[p.langIndex])}`}
                                        >
                                          {p.phoneme}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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

                {/* Vowel Trapezoid Chart */}
                <Card className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Vowel Chart (Trapezoid)</h3>
                  <div className="relative mx-auto" style={{ width: "500px", height: "320px" }}>
                    <svg viewBox="0 0 500 320" className="w-full h-full">
                      {/* Trapezoid outline */}
                      <polygon
                        points="50,10 250,10 450,300 100,300"
                        fill="none"
                        stroke="#d1d5db"
                        strokeWidth="1.5"
                      />
                      {/* Horizontal grid lines */}
                      {[
                        { y: 10, label: "Close" },
                        { y: 68, label: "Near-close" },
                        { y: 115, label: "Close-mid" },
                        { y: 165, label: "Mid" },
                        { y: 210, label: "Open-mid" },
                        { y: 260, label: "Near-open" },
                        { y: 300, label: "Open" },
                      ].map(({ y, label }) => {
                        // Calculate trapezoid width at this y position
                        const t = (y - 10) / 290;
                        const leftX = 50 + t * (100 - 50);
                        const rightX = 250 + t * (450 - 250);
                        return (
                          <g key={label}>
                            <line
                              x1={leftX}
                              y1={y}
                              x2={rightX}
                              y2={y}
                              stroke="#e5e7eb"
                              strokeWidth="0.5"
                              strokeDasharray="4,4"
                            />
                            <text x={2} y={y + 4} fontSize="9" fill="#9ca3af">
                              {label}
                            </text>
                          </g>
                        );
                      })}
                      {/* Vertical guides */}
                      {[
                        { label: "Front", xTop: 50, xBot: 100 },
                        { label: "Central", xTop: 150, xBot: 275 },
                        { label: "Back", xTop: 250, xBot: 450 },
                      ].map(({ label, xTop, xBot }) => (
                        <g key={label}>
                          <line
                            x1={xTop}
                            y1={10}
                            x2={xBot}
                            y2={300}
                            stroke="#e5e7eb"
                            strokeWidth="0.5"
                            strokeDasharray="4,4"
                          />
                        </g>
                      ))}
                      {/* Vowel markers */}
                      {vowelChartData.map((v, i) => {
                        // Map normalized (0-100) coordinates to trapezoid SVG space
                        const yPos = 10 + (v.y / 100) * 290;
                        const t = v.y / 100;
                        const leftX = 50 + t * (100 - 50);
                        const rightX = 250 + t * (450 - 250);
                        const xPos = leftX + (v.x / 100) * (rightX - leftX);

                        const isSharedVowel =
                          overlapAnalysis && overlapAnalysis.sharedVowels.has(v.phoneme);

                        return (
                          <g key={`${v.phoneme}-${v.langIndex}-${i}`}>
                            {isSharedVowel && (
                              <circle
                                cx={xPos}
                                cy={yPos}
                                r={12}
                                fill="#fef08a"
                                fillOpacity={0.5}
                              />
                            )}
                            <circle
                              cx={xPos}
                              cy={yPos}
                              r={8}
                              fill={LANG_COLORS[v.langIndex].fill}
                              fillOpacity={0.85}
                              stroke="white"
                              strokeWidth="1"
                            />
                            <text
                              x={xPos}
                              y={yPos + 3.5}
                              textAnchor="middle"
                              fontSize="9"
                              fill="white"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {v.phoneme}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-600 justify-center">
                    {selectedLanguages.map((langId, idx) => (
                      <div key={langId} className="flex items-center gap-1">
                        <span className={`inline-block w-3 h-3 rounded-full ${LANG_COLORS[idx].bg}`} />
                        {getLangName(langId)}
                      </div>
                    ))}
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
        </div>
      </div>
    </div>
  );
}
