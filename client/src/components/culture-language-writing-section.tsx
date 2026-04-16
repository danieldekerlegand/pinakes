import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Globe,
  Languages,
  Type,
} from "lucide-react";

interface WritingSystem {
  id: string;
  name: string;
  type: string;
  direction: string;
  parentSystemId: string;
  languageIds: string[];
  originDate: string;
  originRegion: string;
  characterCount: number;
  sampleCharacters: string;
  unicodeBlock: string;
  isActive: boolean;
}

interface LanguageInfo {
  id: string;
  name: string;
  nativeName?: string | null;
  familyId: string;
  region?: string | null;
  status: string;
  nativeSpeakers?: number | null;
  totalSpeakers?: number | null;
  writingSystem?: string | null;
  classification?: string | null;
  timeOrigin?: string | null;
  timeEnd?: string | null;
}

interface LiteraryWork {
  id: string;
  title: string;
  author: string;
  traditionId: string;
  languageId: string;
  dateComposed: number;
  genre: string;
  form: string;
  description: string;
  significance: string;
  originalScript: string;
}

interface SampleText {
  id: string;
  languageId: string;
  title: string;
  text: string;
  transliteration: string;
  translationEn: string;
  source: string;
  dateComposed: string;
  genre: string;
  script: string;
}

export interface CultureLanguageWritingSectionProps {
  languageIds: string[];
  writingSystemIds: string[];
  literaryTraditionIds: string[];
}

const WRITING_TYPE_COLORS: Record<string, string> = {
  alphabet: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  abjad: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  abugida: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  syllabary: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  logographic: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  featural: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

const STATUS_COLORS: Record<string, string> = {
  living: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  endangered: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  moribund: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  dead: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const DIRECTION_LABELS: Record<string, string> = {
  LTR: "Left to Right",
  RTL: "Right to Left",
  TTB: "Top to Bottom",
};

function formatYear(year: number | string | null): string {
  if (year === null || year === undefined) return "present";
  const num = typeof year === "string" ? parseInt(year, 10) : year;
  if (isNaN(num)) return String(year);
  if (num < 0) return `${Math.abs(num)} BCE`;
  return `${num} CE`;
}

function formatSpeakers(count: number | null | undefined): string {
  if (!count) return "Unknown";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

function LanguageCard({
  language,
  onSelect,
}: {
  language: LanguageInfo;
  onSelect?: (id: string) => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onSelect?.(language.id)}
      data-testid={`language-card-${language.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
              {language.name}
            </h4>
            {language.nativeName && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                {language.nativeName}
              </p>
            )}
          </div>
          <Badge
            className={`ml-2 text-xs shrink-0 ${STATUS_COLORS[language.status] || "bg-gray-100 text-gray-800"}`}
          >
            {language.status}
          </Badge>
        </div>
        {language.classification && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 flex items-center gap-1">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{language.classification}</span>
          </p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
          {language.totalSpeakers && (
            <span>{formatSpeakers(language.totalSpeakers)} speakers</span>
          )}
          {language.writingSystem && (
            <span className="flex items-center gap-1">
              <Type className="h-3 w-3" />
              {language.writingSystem}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WritingSystemCard({
  system,
  ancestors,
}: {
  system: WritingSystem;
  ancestors: WritingSystem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const lineage = ancestors.length > 0 ? [...ancestors, system] : [system];

  return (
    <Card data-testid={`writing-system-card-${system.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
              {system.name}
            </h4>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                className={`text-xs ${WRITING_TYPE_COLORS[system.type] || "bg-gray-100 text-gray-800"}`}
              >
                {system.type}
              </Badge>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {DIRECTION_LABELS[system.direction] || system.direction}
              </span>
            </div>
          </div>
          {system.isActive ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
              Active
            </Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 text-xs">
              Historical
            </Badge>
          )}
        </div>

        {/* Sample glyphs */}
        {system.sampleCharacters && (
          <div className="mt-3 p-2 bg-gray-50 dark:bg-gray-800 rounded text-center">
            <p
              className="text-lg tracking-widest font-serif"
              data-testid={`glyphs-${system.id}`}
            >
              {system.sampleCharacters}
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{system.characterCount} characters</span>
          <span>{system.originRegion}</span>
          <span>{formatYear(system.originDate)}</span>
        </div>

        {/* Script evolution mini-tree */}
        {lineage.length > 1 && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              data-testid={`toggle-lineage-${system.id}`}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Script evolution ({lineage.length} steps)
            </button>
            {expanded && (
              <div
                className="mt-2 pl-2 border-l-2 border-blue-200 dark:border-blue-800 space-y-1"
                data-testid={`lineage-${system.id}`}
              >
                {lineage.map((ancestor, i) => (
                  <div
                    key={ancestor.id}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className={`${i === lineage.length - 1 ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}
                    >
                      {ancestor.name}
                    </span>
                    <Badge
                      className={`text-[10px] ${WRITING_TYPE_COLORS[ancestor.type] || "bg-gray-100 text-gray-800"}`}
                    >
                      {ancestor.type}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LiteraryWorkCard({ work }: { work: LiteraryWork }) {
  return (
    <Card
      className="hover:shadow-md transition-shadow"
      data-testid={`literary-work-card-${work.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
              {work.title}
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              {work.author} · {formatYear(work.dateComposed)}
            </p>
          </div>
          <Badge className="ml-2 text-xs bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 shrink-0">
            {work.genre}
          </Badge>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">
          {work.description}
        </p>
        {work.originalScript && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1">
            <Type className="h-3 w-3" />
            {work.originalScript} script
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SampleTextCard({ sampleText }: { sampleText: SampleText }) {
  const [showTranslation, setShowTranslation] = useState(false);

  return (
    <Card data-testid={`sample-text-card-${sampleText.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {sampleText.title}
          </h4>
          <Badge className="text-xs ml-2 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 shrink-0">
            {sampleText.genre}
          </Badge>
        </div>

        {/* Original text */}
        <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
          <p className="text-sm font-serif leading-relaxed" dir="auto">
            {sampleText.text}
          </p>
        </div>

        {/* Transliteration */}
        {sampleText.transliteration && sampleText.transliteration.trim() && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Transliteration
            </p>
            <p className="text-xs text-gray-700 dark:text-gray-300 italic mt-0.5">
              {sampleText.transliteration}
            </p>
          </div>
        )}

        {/* Translation toggle */}
        {sampleText.translationEn && (
          <div className="mt-2">
            <button
              onClick={() => setShowTranslation(!showTranslation)}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              data-testid={`toggle-translation-${sampleText.id}`}
            >
              {showTranslation ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {showTranslation ? "Hide" : "Show"} translation
            </button>
            {showTranslation && (
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 italic">
                {sampleText.translationEn}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
          {sampleText.source && <span>{sampleText.source}</span>}
          {sampleText.dateComposed && (
            <span>{formatYear(sampleText.dateComposed)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CultureLanguageWritingSection({
  languageIds,
  writingSystemIds,
  literaryTraditionIds,
}: CultureLanguageWritingSectionProps) {
  // Fetch all languages, then filter client-side by IDs
  const { data: languagesData, isLoading: isLoadingLanguages } = useQuery<{
    languages: LanguageInfo[];
  }>({
    queryKey: ["/api/languages"],
    enabled: languageIds.length > 0,
  });

  // Fetch all writing systems, then filter client-side by IDs
  const { data: writingSystemsData, isLoading: isLoadingWritingSystems } =
    useQuery<{ systems: WritingSystem[]; count: number }>({
      queryKey: ["/api/writing-systems"],
      enabled: writingSystemIds.length > 0,
    });

  // Fetch literary works filtered by language IDs
  const { data: literaryWorksData, isLoading: isLoadingWorks } = useQuery<{
    works: LiteraryWork[];
    count: number;
  }>({
    queryKey: ["/api/literary-works"],
    enabled: literaryTraditionIds.length > 0 || languageIds.length > 0,
  });

  // Fetch sample texts for associated languages
  const { data: sampleTextsData, isLoading: isLoadingSampleTexts } = useQuery<{
    texts: SampleText[];
    count: number;
  }>({
    queryKey: ["/api/sample-texts"],
    enabled: languageIds.length > 0,
  });

  const allSystems = writingSystemsData?.systems || [];

  // Filter data to only what's relevant to this culture
  const languages = (languagesData?.languages || []).filter((l) =>
    languageIds.includes(l.id),
  );
  const writingSystems = allSystems.filter((s) =>
    writingSystemIds.includes(s.id),
  );
  const literaryWorks = (literaryWorksData?.works || []).filter(
    (w) =>
      literaryTraditionIds.includes(w.traditionId) ||
      languageIds.includes(w.languageId),
  );
  const sampleTexts = (sampleTextsData?.texts || []).filter((t) =>
    languageIds.includes(t.languageId),
  );

  // Build ancestor chains for writing systems
  function getAncestors(system: WritingSystem): WritingSystem[] {
    const ancestors: WritingSystem[] = [];
    let current = system;
    const visited = new Set<string>();
    while (current.parentSystemId && !visited.has(current.parentSystemId)) {
      visited.add(current.parentSystemId);
      const parent = allSystems.find((s) => s.id === current.parentSystemId);
      if (!parent) break;
      ancestors.unshift(parent);
      current = parent;
    }
    return ancestors;
  }

  const isLoading =
    isLoadingLanguages ||
    isLoadingWritingSystems ||
    isLoadingWorks ||
    isLoadingSampleTexts;

  const hasNoData =
    !isLoading &&
    languages.length === 0 &&
    writingSystems.length === 0 &&
    literaryWorks.length === 0 &&
    sampleTexts.length === 0;

  if (hasNoData) {
    return (
      <div
        className="text-center py-8 text-gray-500 dark:text-gray-400"
        data-testid="language-writing-empty"
      >
        <Languages className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">
          No language or writing data available for this culture.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="culture-language-writing-section">
      {/* Languages */}
      {(languages.length > 0 || isLoadingLanguages) && (
        <section>
          <CardHeader className="px-0 pt-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Languages className="h-4 w-4" />
              Associated Languages
              {languages.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {languages.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          {isLoadingLanguages ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {languages.map((lang) => (
                <LanguageCard key={lang.id} language={lang} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Writing Systems */}
      {(writingSystems.length > 0 || isLoadingWritingSystems) && (
        <section>
          <CardHeader className="px-0 pt-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Type className="h-4 w-4" />
              Writing Systems
              {writingSystems.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {writingSystems.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          {isLoadingWritingSystems ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {writingSystems.map((system) => (
                <WritingSystemCard
                  key={system.id}
                  system={system}
                  ancestors={getAncestors(system)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Literary Works */}
      {(literaryWorks.length > 0 || isLoadingWorks) && (
        <section>
          <CardHeader className="px-0 pt-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Literary Works
              {literaryWorks.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {literaryWorks.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          {isLoadingWorks ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"
                />
              ))}
            </div>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="grid grid-cols-1 gap-2 pr-2">
                {literaryWorks.map((work) => (
                  <LiteraryWorkCard key={work.id} work={work} />
                ))}
              </div>
            </ScrollArea>
          )}
        </section>
      )}

      {/* Sample Texts */}
      {(sampleTexts.length > 0 || isLoadingSampleTexts) && (
        <section>
          <CardHeader className="px-0 pt-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Sample Texts
              {sampleTexts.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {sampleTexts.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          {isLoadingSampleTexts ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-28 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"
                />
              ))}
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="grid grid-cols-1 gap-2 pr-2">
                {sampleTexts.map((text) => (
                  <SampleTextCard key={text.id} sampleText={text} />
                ))}
              </div>
            </ScrollArea>
          )}
        </section>
      )}
    </div>
  );
}
