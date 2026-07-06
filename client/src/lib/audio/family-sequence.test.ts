import { describe, it, expect, vi } from "vitest";
import {
  familyOrderIndex,
  orderLanguagesGenealogically,
  buildFamilySequence,
  createSequencePlayer,
  type OrderableFamily,
  type OrderableLanguage,
  type FamilySequenceItem,
} from "./family-sequence";
import type { SpeechController, SpeechTarget } from "./ipa-speech";

// A small Indo-European-ish tree:
//   ie
//   ├─ germanic
//   └─ romance
const FAMILIES: OrderableFamily[] = [
  { id: "ie", name: "Indo-European", parentId: null },
  { id: "germanic", name: "Germanic", parentId: "ie" },
  { id: "romance", name: "Romance", parentId: "ie" },
];

const LANGUAGES: OrderableLanguage[] = [
  { id: "fr", name: "French", familyId: "romance", chronologicalOrder: 2 },
  { id: "de", name: "German", familyId: "germanic", chronologicalOrder: 2 },
  { id: "en", name: "English", familyId: "germanic", chronologicalOrder: 3 },
  { id: "la", name: "Latin", familyId: "romance", chronologicalOrder: 1 },
];

describe("familyOrderIndex", () => {
  it("visits parents before children in a stable DFS pre-order", () => {
    const order = familyOrderIndex(FAMILIES);
    // Root first, then its children (Germanic < Romance by name).
    expect(order.get("ie")).toBe(0);
    expect(order.get("germanic")).toBe(1);
    expect(order.get("romance")).toBe(2);
  });

  it("treats a family whose parent is absent as a root (no orphan drop)", () => {
    const order = familyOrderIndex([{ id: "x", name: "X", parentId: "missing" }]);
    expect(order.get("x")).toBe(0);
  });

  it("does not loop on a self-parent cycle", () => {
    const order = familyOrderIndex([{ id: "c", name: "C", parentId: "c" }]);
    expect(order.get("c")).toBe(0);
    expect(order.size).toBe(1);
  });
});

describe("orderLanguagesGenealogically", () => {
  it("groups languages by branch and orders ancestors first within a branch", () => {
    const ordered = orderLanguagesGenealogically(LANGUAGES, FAMILIES).map((l) => l.id);
    // Germanic branch (index 1) before Romance branch (index 2); within
    // Germanic, chronologicalOrder de(2) < en(3); within Romance la(1) < fr(2).
    expect(ordered).toEqual(["de", "en", "la", "fr"]);
  });

  it("orders a parent language before its child via parentLanguageId", () => {
    const langs: OrderableLanguage[] = [
      { id: "child", name: "Zeta", familyId: "germanic", parentLanguageId: "root" },
      { id: "root", name: "Alpha", familyId: "germanic", parentLanguageId: null },
    ];
    const ordered = orderLanguagesGenealogically(langs, FAMILIES).map((l) => l.id);
    expect(ordered).toEqual(["root", "child"]);
  });

  it("sorts languages with an unknown family last", () => {
    const langs: OrderableLanguage[] = [
      { id: "iso", name: "Isolate", familyId: "nope" },
      { id: "de", name: "German", familyId: "germanic" },
    ];
    const ordered = orderLanguagesGenealogically(langs, FAMILIES).map((l) => l.id);
    expect(ordered).toEqual(["de", "iso"]);
  });
});

describe("buildFamilySequence", () => {
  const content = (l: OrderableLanguage): SpeechTarget => ({
    form: `${l.id}-form`,
    ipa: null,
    lang: l.id,
  });

  it("produces the genealogical order with resolved content", () => {
    const seq = buildFamilySequence({ languages: LANGUAGES, families: FAMILIES, content });
    expect(seq.map((s) => s.id)).toEqual(["de", "en", "la", "fr"]);
    expect(seq.every((s) => s.reconstructed === false)).toBe(true);
    expect(seq[0].form).toBe("de-form");
  });

  it("places reconstructed proto-forms first, flagged speculative, in tree order", () => {
    const seq = buildFamilySequence({
      languages: LANGUAGES,
      families: FAMILIES,
      content,
      reconstructed: [
        { id: "proto-romance", label: "Proto-Romance", familyId: "romance", form: "*rom" },
        { id: "pie", label: "Proto-Indo-European", familyId: "ie", form: "*pie" },
      ],
    });
    // Protos come first, ordered by family tree index (ie=0 before romance=2).
    expect(seq.slice(0, 2).map((s) => s.id)).toEqual(["pie", "proto-romance"]);
    expect(seq.slice(0, 2).every((s) => s.reconstructed)).toBe(true);
    // Then the attested languages follow in genealogical order.
    expect(seq.slice(2).map((s) => s.id)).toEqual(["de", "en", "la", "fr"]);
  });
});

/** A fake controller whose `play` fires onStart+onEnd synchronously. */
function fakeController(overrides: Partial<SpeechController> = {}): {
  controller: SpeechController;
  spoken: string[];
} {
  const spoken: string[] = [];
  const controller: SpeechController = {
    supported: true,
    play(target, options) {
      const text = target.form ?? target.ipa ?? "";
      if (!text) return false; // nothing to say
      spoken.push(String(text));
      options?.onStart?.();
      options?.onEnd?.();
      return true;
    },
    stop: vi.fn(),
    ...overrides,
  };
  return { controller, spoken };
}

// A synchronous timer so the whole sequence unrolls within start().
const syncTimer = (cb: () => void) => {
  cb();
  return 0;
};

function makeItems(ids: string[]): FamilySequenceItem[] {
  return ids.map((id) => ({ id, label: id, form: `${id}!`, reconstructed: false }));
}

describe("createSequencePlayer", () => {
  it("plays every item in order and reports completion", () => {
    const { controller, spoken } = fakeController();
    const started: string[] = [];
    let completed = false;
    const player = createSequencePlayer(controller, makeItems(["a", "b", "c"]), {
      setTimer: syncTimer,
      onItemStart: (item) => started.push(item.id),
      onComplete: () => (completed = true),
    });

    player.start();

    expect(spoken).toEqual(["a!", "b!", "c!"]);
    expect(started).toEqual(["a", "b", "c"]);
    expect(completed).toBe(true);
    expect(player.isPlaying()).toBe(false);
    expect(player.index()).toBe(-1);
  });

  it("skips items with nothing to pronounce without stalling", () => {
    const { controller, spoken } = fakeController();
    const items: FamilySequenceItem[] = [
      { id: "a", label: "a", form: "a!", reconstructed: false },
      { id: "gap", label: "gap", form: null, ipa: null, reconstructed: false },
      { id: "c", label: "c", form: "c!", reconstructed: false },
    ];
    const ended: string[] = [];
    const player = createSequencePlayer(controller, items, {
      setTimer: syncTimer,
      onItemEnd: (item) => ended.push(item.id),
    });

    player.start();

    expect(spoken).toEqual(["a!", "c!"]); // 'gap' skipped
    expect(ended).toEqual(["a", "gap", "c"]); // but still reported as ended
  });

  it("stop() cancels speech and fires onStop while playing", () => {
    // A controller that does NOT auto-complete, so the player stays playing.
    const stop = vi.fn();
    const controller: SpeechController = {
      supported: true,
      play: (target, options) => {
        options?.onStart?.();
        return true; // never fires onEnd -> sequence parks on item 0
      },
      stop,
    };
    let stopped = false;
    const player = createSequencePlayer(controller, makeItems(["a", "b"]), {
      setTimer: (cb) => setTimeout(cb, 0),
      onStop: () => (stopped = true),
    });

    player.start();
    expect(player.isPlaying()).toBe(true);
    expect(player.index()).toBe(0);

    player.stop();
    expect(stop).toHaveBeenCalled();
    expect(stopped).toBe(true);
    expect(player.isPlaying()).toBe(false);
  });

  it("does nothing when speech is unsupported or the sequence is empty", () => {
    const { controller } = fakeController({ supported: false });
    const player = createSequencePlayer(controller, makeItems(["a"]), { setTimer: syncTimer });
    player.start();
    expect(player.isPlaying()).toBe(false);

    const supported = fakeController();
    const empty = createSequencePlayer(supported.controller, [], { setTimer: syncTimer });
    empty.start();
    expect(empty.isPlaying()).toBe(false);
    expect(supported.spoken).toEqual([]);
  });
});
