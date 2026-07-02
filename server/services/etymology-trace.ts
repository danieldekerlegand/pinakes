import { storage } from "../storage";
import type { EtymologyRelation } from "../tsv-storage";

export interface EtymologyTreeNode {
  word: string;
  language: string;
  relation?: string;
  children: EtymologyTreeNode[];
}

// Relations where source_word is derived FROM target_word (ancestor direction)
const ANCESTOR_RELATIONS = ["derived_from", "etymology", "borrowed_from"];

/**
 * Recursively trace a word's etymology ancestors.
 * Follows derived_from, etymology, and borrowed_from relations from source to target.
 */
export async function traceEtymology(
  word: string,
  language?: string,
): Promise<EtymologyTreeNode> {
  const allRelations = await storage.getEtymologyRelations();
  const visited = new Set<string>();

  function makeKey(w: string, lang: string): string {
    return `${w.toLowerCase()}|${lang.toLowerCase()}`;
  }

  function trace(w: string, lang: string | undefined, relation?: string): EtymologyTreeNode {
    const key = lang ? makeKey(w, lang) : w.toLowerCase();
    if (visited.has(key)) {
      return { word: w, language: lang ?? "unknown", relation, children: [] };
    }
    visited.add(key);

    const normalizedWord = w.toLowerCase();

    // Find relations where this word is the source (i.e., this word is derived from something)
    const ancestors = allRelations.filter((r) => {
      if (!ANCESTOR_RELATIONS.includes(r.relationType)) return false;
      if (r.sourceWord.toLowerCase() !== normalizedWord) return false;
      if (lang && r.sourceLanguage.toLowerCase() !== lang.toLowerCase()) return false;
      return true;
    });

    const children = ancestors.map((r) =>
      trace(r.targetWord, r.targetLanguage, r.relationType),
    );

    return {
      word: w,
      language: lang ?? (ancestors.length > 0 ? ancestors[0].sourceLanguage : "unknown"),
      relation,
      children,
    };
  }

  return trace(word, language);
}

/**
 * Recursively trace a word's descendants.
 * Follows derived_from, etymology, and borrowed_from relations in reverse (target to source).
 */
export async function traceDescendants(
  word: string,
  language?: string,
): Promise<EtymologyTreeNode> {
  const allRelations = await storage.getEtymologyRelations();
  const visited = new Set<string>();

  function makeKey(w: string, lang: string): string {
    return `${w.toLowerCase()}|${lang.toLowerCase()}`;
  }

  function trace(w: string, lang: string | undefined, relation?: string): EtymologyTreeNode {
    const key = lang ? makeKey(w, lang) : w.toLowerCase();
    if (visited.has(key)) {
      return { word: w, language: lang ?? "unknown", relation, children: [] };
    }
    visited.add(key);

    const normalizedWord = w.toLowerCase();

    // Find relations where this word is the target (i.e., something is derived from this word)
    const descendants = allRelations.filter((r) => {
      if (!ANCESTOR_RELATIONS.includes(r.relationType)) return false;
      if (r.targetWord.toLowerCase() !== normalizedWord) return false;
      if (lang && r.targetLanguage.toLowerCase() !== lang.toLowerCase()) return false;
      return true;
    });

    const children = descendants.map((r) =>
      trace(r.sourceWord, r.sourceLanguage, r.relationType),
    );

    return {
      word: w,
      language: lang ?? (descendants.length > 0 ? descendants[0].targetLanguage : "unknown"),
      relation,
      children,
    };
  }

  return trace(word, language);
}
