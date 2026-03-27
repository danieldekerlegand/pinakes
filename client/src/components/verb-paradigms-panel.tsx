import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  X,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Language } from "@shared/types";

interface VerbParadigm {
  id: string;
  languageId: string;
  verbConcept: string;
  infinitiveForm: string;
  conjugationTable: Record<string, Record<string, string> | unknown>;
  irregular: boolean;
  complexityScore: number;
  notes: string;
}

interface VerbParadigmsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

const LANGUAGE_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", cell: "bg-blue-50", header: "bg-blue-600" },
  { bg: "bg-emerald-100", text: "text-emerald-800", border: "border-emerald-300", cell: "bg-emerald-50", header: "bg-emerald-600" },
  { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-300", cell: "bg-purple-50", header: "bg-purple-600" },
];

export default function VerbParadigmsPanel({ isOpen, onClose, embedded }: VerbParadigmsPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedVerbConcept, setSelectedVerbConcept] = useState<string>("to be");

  // Fetch all languages for the selector
  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ["/api/languages"],
    enabled: isOpen,
  });

  // Fetch verb paradigms for selected languages
  const { data: paradigmsData } = useQuery<{ paradigms: VerbParadigm[]; count: number }>({
    queryKey: ["/api/verb-paradigms", { verb_concept: selectedVerbConcept }],
    enabled: isOpen && selectedLanguages.length > 0,
  });

  const allParadigms = paradigmsData?.paradigms ?? [];

  // Filter paradigms to selected languages
  const selectedParadigms = useMemo(() => {
    return selectedLanguages
      .map((langId) => allParadigms.find((p) => p.languageId === langId))
      .filter((p): p is VerbParadigm => p !== undefined);
  }, [allParadigms, selectedLanguages]);

  // Get all available verb concepts
  const { data: allParadigmsForConcepts } = useQuery<{ paradigms: VerbParadigm[]; count: number }>({
    queryKey: ["/api/verb-paradigms"],
    enabled: isOpen,
  });

  const verbConcepts = useMemo(() => {
    const concepts = new Set<string>();
    (allParadigmsForConcepts?.paradigms ?? []).forEach((p) => concepts.add(p.verbConcept));
    return Array.from(concepts).sort();
  }, [allParadigmsForConcepts]);

  // Languages that have verb paradigm data
  const languagesWithData = useMemo(() => {
    const langIds = new Set<string>();
    (allParadigmsForConcepts?.paradigms ?? []).forEach((p) => langIds.add(p.languageId));
    return languages.filter((l) => langIds.has(l.id));
  }, [languages, allParadigmsForConcepts]);

  // Filtered languages for search
  const filteredLanguages = useMemo(() => {
    if (!searchQuery) return languagesWithData;
    const q = searchQuery.toLowerCase();
    return languagesWithData.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q)
    );
  }, [languagesWithData, searchQuery]);

  // Collect all tenses/moods across selected paradigms
  const allTenses = useMemo(() => {
    const tenseSet = new Set<string>();
    selectedParadigms.forEach((p) => {
      Object.keys(p.conjugationTable).forEach((t) => tenseSet.add(t));
    });
    return Array.from(tenseSet).sort();
  }, [selectedParadigms]);

  // Collect all person keys across selected paradigms
  const allPersons = useMemo(() => {
    const personSet = new Set<string>();
    selectedParadigms.forEach((p) => {
      Object.values(p.conjugationTable).forEach((tenseData) => {
        if (tenseData && typeof tenseData === "object") {
          Object.keys(tenseData as Record<string, string>).forEach((k) => personSet.add(k));
        }
      });
    });
    // Sort persons in a natural order
    const order = ["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"];
    return Array.from(personSet).sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [selectedParadigms]);

  // Find shared forms across languages for a given tense+person
  const getSharedForms = useMemo(() => {
    if (selectedParadigms.length < 2) return new Set<string>();
    const shared = new Set<string>();

    for (const tense of allTenses) {
      for (const person of allPersons) {
        const forms = selectedParadigms.map((p) => {
          const tenseData = p.conjugationTable[tense] as Record<string, string> | undefined;
          return tenseData?.[person]?.toLowerCase();
        }).filter(Boolean);

        // Check if any two languages share the exact same form
        const formCounts = new Map<string, number>();
        forms.forEach((f) => {
          if (f) formCounts.set(f, (formCounts.get(f) ?? 0) + 1);
        });
        formCounts.forEach((count, form) => {
          if (count > 1) {
            // Mark all matching paradigms for this cell
            selectedParadigms.forEach((p) => {
              const tenseData = p.conjugationTable[tense] as Record<string, string> | undefined;
              if (tenseData?.[person]?.toLowerCase() === form) {
                shared.add(`${p.languageId}-${tense}-${person}`);
              }
            });
          }
        });
      }
    }
    return shared;
  }, [selectedParadigms, allTenses, allPersons]);

  // Find shared tense categories (e.g. Romance languages all having future tense)
  const sharedTenseCategories = useMemo(() => {
    if (selectedParadigms.length < 2) return new Set<string>();
    const shared = new Set<string>();
    for (const tense of allTenses) {
      const hasAll = selectedParadigms.every((p) => tense in p.conjugationTable);
      if (hasAll) shared.add(tense);
    }
    return shared;
  }, [selectedParadigms, allTenses]);

  const addLanguage = (langId: string) => {
    if (selectedLanguages.length < 3 && !selectedLanguages.includes(langId)) {
      setSelectedLanguages([...selectedLanguages, langId]);
    }
  };

  const removeLanguage = (langId: string) => {
    setSelectedLanguages(selectedLanguages.filter((id) => id !== langId));
  };

  const getLanguageName = (langId: string) => {
    return languages.find((l) => l.id === langId)?.name ?? langId;
  };

  const formatTenseName = (tense: string) => {
    return tense.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatPersonLabel = (person: string) => {
    const labels: Record<string, string> = {
      "1sg": "1st Sg",
      "2sg": "2nd Sg",
      "3sg": "3rd Sg",
      "1pl": "1st Pl",
      "2pl": "2nd Pl",
      "3pl": "3rd Pl",
    };
    return labels[person] ?? person;
  };

  if (!isOpen && !embedded) return null;

  const panelContent = (
    <div className={embedded ? "h-full flex flex-col bg-white" : "fixed right-0 top-0 h-full w-[900px] max-w-[95vw] bg-white shadow-xl z-50 flex flex-col"}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-indigo-600 text-white">
        <h2 className="text-lg font-semibold">Verb Conjugation Comparison</h2>
        {!embedded && (
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-indigo-700"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Verb Concept Selector */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Verb Concept
              </label>
              <Select value={selectedVerbConcept} onValueChange={setSelectedVerbConcept}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select verb concept" />
                </SelectTrigger>
                <SelectContent>
                  {verbConcepts.map((concept) => (
                    <SelectItem key={concept} value={concept}>
                      {concept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Language Selector */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Select Languages (up to 3)
              </label>

              {/* Selected Languages */}
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedLanguages.map((langId, idx) => (
                  <Badge
                    key={langId}
                    className={`${LANGUAGE_COLORS[idx].bg} ${LANGUAGE_COLORS[idx].text} ${LANGUAGE_COLORS[idx].border} border px-3 py-1`}
                  >
                    {getLanguageName(langId)}
                    <button
                      onClick={() => removeLanguage(langId)}
                      className="ml-2 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {selectedLanguages.length === 0 && (
                  <span className="text-sm text-gray-400">No languages selected</span>
                )}
              </div>

              {/* Language Search */}
              {selectedLanguages.length < 3 && (
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search languages..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-8"
                  />
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />

                  {searchQuery && filteredLanguages.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredLanguages.slice(0, 20).map((lang) => (
                        <button
                          key={lang.id}
                          className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm disabled:opacity-50"
                          onClick={() => {
                            addLanguage(lang.id);
                            setSearchQuery("");
                          }}
                          disabled={selectedLanguages.includes(lang.id)}
                        >
                          {lang.name}{" "}
                          <span className="text-gray-400">({lang.id})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* No selection message */}
            {selectedLanguages.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg mb-2">Select languages to compare verb conjugations</p>
                <p className="text-sm">Choose up to 3 languages and a verb concept to see side-by-side paradigms</p>
              </div>
            )}

            {/* Single language conjugation table */}
            {selectedParadigms.length === 1 && (
              <div className="space-y-4">
                <ParadigmCard
                  paradigm={selectedParadigms[0]}
                  languageName={getLanguageName(selectedParadigms[0].languageId)}
                  color={LANGUAGE_COLORS[0]}
                  formatTenseName={formatTenseName}
                  formatPersonLabel={formatPersonLabel}
                />
              </div>
            )}

            {/* Side-by-side comparison */}
            {selectedParadigms.length >= 2 && (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4">
                  {selectedParadigms.map((p, idx) => (
                    <div key={p.id} className={`rounded-lg border p-4 ${LANGUAGE_COLORS[idx].border} ${LANGUAGE_COLORS[idx].cell}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className={`font-semibold ${LANGUAGE_COLORS[idx].text}`}>
                          {getLanguageName(p.languageId)}
                        </h3>
                        {p.irregular ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Irregular
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-300">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Regular
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        <span className="font-medium">Infinitive:</span> {p.infinitiveForm}
                      </p>
                      <p className="text-sm text-gray-600 mb-1">
                        <span className="font-medium">Complexity:</span>{" "}
                        <span className={`font-bold ${p.complexityScore > 20 ? "text-red-600" : p.complexityScore > 10 ? "text-amber-600" : "text-green-600"}`}>
                          {p.complexityScore}
                        </span>
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Distinct forms:</span>{" "}
                        {countDistinctForms(p)}
                      </p>
                      {p.notes && (
                        <p className="text-xs text-gray-500 mt-2 italic">{p.notes}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Shared tense categories indicator */}
                {sharedTenseCategories.size > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-yellow-800 mb-1">
                      Shared tense/mood categories:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {Array.from(sharedTenseCategories).map((t) => (
                        <Badge key={t} className="bg-yellow-100 text-yellow-800 border-yellow-300">
                          {formatTenseName(t)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comparison Table by Tense */}
                {allTenses.map((tense) => (
                  <div key={tense} className="border rounded-lg overflow-hidden">
                    <div className={`px-4 py-2 font-medium text-sm ${sharedTenseCategories.has(tense) ? "bg-yellow-50 text-yellow-900" : "bg-gray-100 text-gray-700"}`}>
                      {formatTenseName(tense)}
                      {sharedTenseCategories.has(tense) && selectedParadigms.length >= 2 && (
                        <span className="ml-2 text-xs text-yellow-600">(shared)</span>
                      )}
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="px-3 py-2 text-left text-gray-500 w-20">Person</th>
                          {selectedParadigms.map((p, idx) => (
                            <th
                              key={p.id}
                              className={`px-3 py-2 text-left text-white ${LANGUAGE_COLORS[idx].header}`}
                            >
                              {getLanguageName(p.languageId)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allPersons.map((person) => {
                          const hasAnyData = selectedParadigms.some((p) => {
                            const td = p.conjugationTable[tense] as Record<string, string> | undefined;
                            return td?.[person];
                          });
                          if (!hasAnyData) return null;

                          return (
                            <tr key={person} className="border-b last:border-b-0">
                              <td className="px-3 py-2 text-gray-500 font-medium">
                                {formatPersonLabel(person)}
                              </td>
                              {selectedParadigms.map((p, idx) => {
                                const tenseData = p.conjugationTable[tense] as Record<string, string> | undefined;
                                const form = tenseData?.[person] ?? "—";
                                const isShared = getSharedForms.has(`${p.languageId}-${tense}-${person}`);

                                return (
                                  <td
                                    key={p.id}
                                    className={`px-3 py-2 font-mono ${isShared ? "bg-yellow-50 font-semibold" : LANGUAGE_COLORS[idx].cell}`}
                                  >
                                    {form}
                                    {isShared && (
                                      <span className="ml-1 text-yellow-500 text-xs">●</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}

                {/* Complexity Comparison Bar */}
                <div className="border rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Complexity Comparison</h3>
                  <div className="space-y-2">
                    {selectedParadigms.map((p, idx) => {
                      const maxScore = Math.max(...selectedParadigms.map((pp) => pp.complexityScore), 1);
                      const pct = (p.complexityScore / maxScore) * 100;
                      return (
                        <div key={p.id} className="flex items-center gap-3">
                          <span className={`text-sm w-28 ${LANGUAGE_COLORS[idx].text} font-medium`}>
                            {getLanguageName(p.languageId)}
                          </span>
                          <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${LANGUAGE_COLORS[idx].header} transition-all`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-sm font-mono w-8 text-right">{p.complexityScore}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Message when language has no data for this verb concept */}
            {selectedLanguages.length > 0 && selectedParadigms.length < selectedLanguages.length && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                Some selected languages don't have data for "{selectedVerbConcept}".
                Available languages may vary by verb concept.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
  );

  if (embedded) return panelContent;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />
      {panelContent}
    </>
  );
}

/** Single paradigm card for viewing one language's full conjugation */
function ParadigmCard({
  paradigm,
  languageName,
  color,
  formatTenseName,
  formatPersonLabel,
}: {
  paradigm: VerbParadigm;
  languageName: string;
  color: typeof LANGUAGE_COLORS[number];
  formatTenseName: (t: string) => string;
  formatPersonLabel: (p: string) => string;
}) {
  const tenses = Object.keys(paradigm.conjugationTable);
  const allPersons = new Set<string>();
  Object.values(paradigm.conjugationTable).forEach((td) => {
    if (td && typeof td === "object") {
      Object.keys(td as Record<string, string>).forEach((k) => allPersons.add(k));
    }
  });
  const personOrder = ["1sg", "2sg", "3sg", "1pl", "2pl", "3pl"];
  const persons = Array.from(allPersons).sort((a, b) => {
    const ai = personOrder.indexOf(a);
    const bi = personOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className={`border rounded-lg overflow-hidden ${color.border}`}>
      <div className={`px-4 py-3 ${color.header} text-white flex items-center justify-between`}>
        <div>
          <h3 className="font-semibold">{languageName}</h3>
          <p className="text-sm opacity-90">"{paradigm.verbConcept}" — {paradigm.infinitiveForm}</p>
        </div>
        <div className="flex items-center gap-2">
          {paradigm.irregular ? (
            <Badge className="bg-amber-500 text-white border-0">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Irregular
            </Badge>
          ) : (
            <Badge className="bg-green-500 text-white border-0">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Regular
            </Badge>
          )}
          <Badge className="bg-white/20 text-white border-0">
            Complexity: {paradigm.complexityScore}
          </Badge>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-3 py-2 text-left text-gray-500">Person</th>
            {tenses.map((t) => (
              <th key={t} className={`px-3 py-2 text-left ${color.text}`}>
                {formatTenseName(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {persons.map((person) => (
            <tr key={person} className="border-b last:border-b-0">
              <td className="px-3 py-2 text-gray-500 font-medium">
                {formatPersonLabel(person)}
              </td>
              {tenses.map((tense) => {
                const td = paradigm.conjugationTable[tense] as Record<string, string> | undefined;
                return (
                  <td key={tense} className={`px-3 py-2 font-mono ${color.cell}`}>
                    {td?.[person] ?? "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {paradigm.notes && (
        <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500 italic">
          {paradigm.notes}
        </div>
      )}

      <div className="px-4 py-2 border-t text-xs text-gray-500">
        Distinct forms: {countDistinctForms(paradigm)}
      </div>
    </div>
  );
}

function countDistinctForms(paradigm: VerbParadigm): number {
  const forms = new Set<string>();
  Object.values(paradigm.conjugationTable).forEach((td) => {
    if (td && typeof td === "object") {
      Object.values(td as Record<string, string>).forEach((form) => {
        if (form) forms.add(form);
      });
    }
  });
  return forms.size;
}
