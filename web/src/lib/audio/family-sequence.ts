/**
 * "Sound of a language family" sequence player (US-004).
 *
 * Given the languages of a family (plus, optionally, reconstructed proto-forms)
 * this orders them **genealogically** — grouped by branch of the family tree,
 * ancestors before descendants — and steps through their pronunciations one at a
 * time so a learner can perceive the family resemblance.
 *
 * The ordering is pure (unit-tested in `family-sequence.test.ts`) and the step
 * player is driven through an injectable {@link SpeechController} (from US-002,
 * `ipa-speech.ts`) plus an injectable timer, so both are testable in a non-DOM
 * (node) environment. The React binding lives in
 * `web/src/components/FamilySoundSequence.tsx`.
 */

import type { SpeechController, SpeechTarget } from "./ipa-speech";

/** Minimal language shape needed for genealogical ordering. */
export interface OrderableLanguage {
  id: string;
  name: string;
  familyId?: string | null;
  parentLanguageId?: string | null;
  /** Lower = earlier/older; used as an intra-branch tiebreak (0 when unknown). */
  chronologicalOrder?: number | null;
}

/** Minimal family shape needed to reconstruct the family tree. */
export interface OrderableFamily {
  id: string;
  name: string;
  parentId?: string | null;
}

/**
 * A reconstructed proto-language form. It is *speculative* (no living speakers)
 * and is always surfaced flagged as such. `familyId` is the family it
 * reconstructs — protos are ordered by that family's position in the tree.
 */
export interface ReconstructedForm {
  id: string;
  label: string;
  familyId?: string | null;
  form?: string | null;
  ipa?: string | null;
  lang?: string | null;
}

/** One playable step in the sequence. */
export interface FamilySequenceItem extends SpeechTarget {
  /** Language id (or proto id). */
  id: string;
  /** Human-readable name shown in the UI (language / proto-language name). */
  label: string;
  /** True when this is a reconstructed proto-form (speculative). */
  reconstructed: boolean;
}

const FAR = Number.MAX_SAFE_INTEGER;

/**
 * Depth-first pre-order index of every family in the forest: a family is
 * immediately followed by its descendants, so member languages of one branch
 * stay contiguous. Roots and children are visited in a deterministic order
 * (by name, then id) so the sequence is stable.
 */
export function familyOrderIndex(families: OrderableFamily[]): Map<string, number> {
  const ids = new Set(families.map((f) => f.id));
  const byParent = new Map<string | null, OrderableFamily[]>();
  for (const f of families) {
    // Treat a parent that isn't in the set (or a self-parent) as a root.
    const parent = f.parentId && f.parentId !== f.id && ids.has(f.parentId) ? f.parentId : null;
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(f);
    else byParent.set(parent, [f]);
  }
  for (const bucket of Array.from(byParent.values())) {
    bucket.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  const order = new Map<string, number>();
  let next = 0;
  const visit = (parent: string | null) => {
    for (const f of byParent.get(parent) ?? []) {
      if (order.has(f.id)) continue; // cycle guard
      order.set(f.id, next++);
      visit(f.id);
    }
  };
  visit(null);
  return order;
}

/**
 * Order languages genealogically: primarily by their family's position in the
 * family tree (so a branch's languages are contiguous), then ancestor languages
 * before their descendants (`parentLanguageId` chain), then by
 * `chronologicalOrder`, then by name. Languages with an unknown family sort last.
 */
export function orderLanguagesGenealogically(
  languages: OrderableLanguage[],
  families: OrderableFamily[],
): OrderableLanguage[] {
  const famIndex = familyOrderIndex(families);
  const byId = new Map(languages.map((l) => [l.id, l]));

  const depthOf = (lang: OrderableLanguage): number => {
    let depth = 0;
    const seen = new Set<string>([lang.id]);
    let parentId = lang.parentLanguageId ?? null;
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = byId.get(parentId)?.parentLanguageId ?? null;
    }
    return depth;
  };

  const rankFamily = (l: OrderableLanguage) =>
    l.familyId && famIndex.has(l.familyId) ? (famIndex.get(l.familyId) as number) : FAR;

  return [...languages].sort((a, b) => {
    return (
      rankFamily(a) - rankFamily(b) ||
      depthOf(a) - depthOf(b) ||
      (a.chronologicalOrder ?? 0) - (b.chronologicalOrder ?? 0) ||
      a.name.localeCompare(b.name)
    );
  });
}

/**
 * Resolve the pronounceable content for one language (its word form / IPA /
 * BCP-47 hint for the target concept). Returning empty fields is fine — the
 * player skips items with nothing to say.
 */
export type LanguageContent = (lang: OrderableLanguage) => SpeechTarget;

/**
 * Build the full genealogically-ordered play sequence: reconstructed proto-forms
 * first (ancestors, clearly flagged speculative), ordered by their family's tree
 * position, followed by the attested languages in genealogical order.
 */
export function buildFamilySequence(params: {
  languages: OrderableLanguage[];
  families: OrderableFamily[];
  content: LanguageContent;
  reconstructed?: ReconstructedForm[];
}): FamilySequenceItem[] {
  const famIndex = familyOrderIndex(params.families);

  const protos: FamilySequenceItem[] = [...(params.reconstructed ?? [])]
    .sort((a, b) => {
      const ai = a.familyId && famIndex.has(a.familyId) ? (famIndex.get(a.familyId) as number) : FAR;
      const bi = b.familyId && famIndex.has(b.familyId) ? (famIndex.get(b.familyId) as number) : FAR;
      return ai - bi || a.label.localeCompare(b.label);
    })
    .map((r) => ({
      id: r.id,
      label: r.label,
      form: r.form,
      ipa: r.ipa,
      lang: r.lang,
      reconstructed: true,
    }));

  const attested: FamilySequenceItem[] = orderLanguagesGenealogically(
    params.languages,
    params.families,
  ).map((lang) => {
    const c = params.content(lang);
    return {
      id: lang.id,
      label: lang.name,
      form: c.form,
      ipa: c.ipa,
      lang: c.lang,
      reconstructed: false,
    };
  });

  return [...protos, ...attested];
}

export interface SequencePlayerOptions {
  /** Speaking rate forwarded to the speech controller. */
  rate?: number;
  /** Silence between items, in ms (default 350). */
  gapMs?: number;
  onItemStart?: (item: FamilySequenceItem, index: number) => void;
  onItemEnd?: (item: FamilySequenceItem, index: number) => void;
  /** Fired once the whole sequence has played to the end. */
  onComplete?: () => void;
  /** Fired when the sequence is stopped before completing. */
  onStop?: () => void;
  /** Injectable timer (defaults to `setTimeout`) for the inter-item gap. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SequencePlayerHandle {
  /** Number of items in the sequence. */
  readonly length: number;
  /** Begin playing from `from` (default 0). No-op if already playing/unsupported. */
  start(from?: number): void;
  /** Stop immediately, cancelling any in-flight speech. */
  stop(): void;
  isPlaying(): boolean;
  /** Index of the item currently playing, or -1 when idle. */
  index(): number;
}

/**
 * Step through `items`, speaking each via `controller` and advancing on the
 * utterance's `onEnd` (after `gapMs`). Items with nothing pronounceable are
 * skipped without a gap so a missing translation doesn't stall the sequence.
 */
export function createSequencePlayer(
  controller: SpeechController,
  items: FamilySequenceItem[],
  options: SequencePlayerOptions = {},
): SequencePlayerHandle {
  const setTimer = options.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const gap = options.gapMs ?? 350;

  let idx = -1;
  let playing = false;
  let timer: unknown = null;

  const clear = () => {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const advance = (next: number, delay: number) => {
    timer = setTimer(() => {
      timer = null;
      playAt(next);
    }, delay);
  };

  const finish = () => {
    playing = false;
    idx = -1;
    options.onComplete?.();
  };

  function playAt(i: number) {
    if (!playing) return;
    if (i >= items.length) {
      finish();
      return;
    }
    idx = i;
    const item = items[i];
    const started = controller.play(
      { form: item.form, ipa: item.ipa, lang: item.lang },
      {
        rate: options.rate,
        onStart: () => options.onItemStart?.(item, i),
        onEnd: () => {
          if (!playing) return;
          options.onItemEnd?.(item, i);
          advance(i + 1, gap);
        },
      },
    );
    if (!started) {
      // Nothing to say for this item — report and skip immediately.
      options.onItemEnd?.(item, i);
      advance(i + 1, 0);
    }
  }

  return {
    get length() {
      return items.length;
    },
    start(from = 0) {
      if (playing || !controller.supported || items.length === 0) return;
      playing = true;
      playAt(Math.max(0, from));
    },
    stop() {
      if (!playing && timer == null) return;
      clear();
      controller.stop();
      const wasPlaying = playing;
      playing = false;
      idx = -1;
      if (wasPlaying) options.onStop?.();
    },
    isPlaying() {
      return playing;
    },
    index() {
      return idx;
    },
  };
}
