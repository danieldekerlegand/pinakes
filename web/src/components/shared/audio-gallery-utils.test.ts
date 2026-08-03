import { describe, it, expect } from "vitest";
import {
  isAudioAsset,
  partitionMedia,
  toAudioClip,
  clipProvenance,
  nextClipIndex,
  prevClipIndex,
  clampClipIndex,
  forwardClipIndex,
  isAudioPlaybackSupported,
  detectAudioSupport,
  type MediaAssetLike,
} from "./audio-gallery-utils";

function asset(over: Partial<MediaAssetLike> = {}): MediaAssetLike {
  return {
    id: "media-001",
    mediaType: "audio",
    url: "https://example.org/clip.mp3",
    title: "Kora improvisation",
    ...over,
  };
}

describe("isAudioAsset", () => {
  it("recognizes audio/music/sound media types (case-insensitive)", () => {
    expect(isAudioAsset({ mediaType: "audio" })).toBe(true);
    expect(isAudioAsset({ mediaType: "MUSIC" })).toBe(true);
    expect(isAudioAsset({ mediaType: " Sound " })).toBe(true);
  });

  it("rejects non-audio and missing types", () => {
    expect(isAudioAsset({ mediaType: "image" })).toBe(false);
    expect(isAudioAsset({ mediaType: "" })).toBe(false);
    expect(isAudioAsset({})).toBe(false);
  });
});

describe("partitionMedia", () => {
  it("splits audio clips from images preserving order", () => {
    const list = [
      asset({ id: "a1", mediaType: "audio" }),
      asset({ id: "i1", mediaType: "image" }),
      asset({ id: "a2", mediaType: "music" }),
      asset({ id: "i2", mediaType: "illustration" }),
    ];
    const { audio, images } = partitionMedia(list);
    expect(audio.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(images.map((a) => a.id)).toEqual(["i1", "i2"]);
  });

  it("handles an all-image list with no audio", () => {
    const { audio, images } = partitionMedia([asset({ mediaType: "image" })]);
    expect(audio).toHaveLength(0);
    expect(images).toHaveLength(1);
  });
});

describe("toAudioClip", () => {
  it("maps a row and drops empty optional fields", () => {
    const clip = toAudioClip(
      asset({ description: "", source: "", attribution: "", tags: ["kora"] }),
    );
    expect(clip).toMatchObject({
      id: "media-001",
      url: "https://example.org/clip.mp3",
      title: "Kora improvisation",
      tags: ["kora"],
    });
    expect(clip.description).toBeUndefined();
    expect(clip.source).toBeUndefined();
    expect(clip.attribution).toBeUndefined();
  });

  it("defaults tags to an empty array", () => {
    expect(toAudioClip(asset()).tags).toEqual([]);
  });
});

describe("clipProvenance", () => {
  it("normalizes the license and builds a credit summary", () => {
    const prov = clipProvenance(
      toAudioClip(
        asset({ license: "cc by 4.0", attribution: "A. Player", source: "Wikimedia" }),
      ),
    );
    expect(prov.license).toBe("CC BY 4.0");
    expect(prov.attribution).toBe("A. Player");
    expect(prov.summary).toBe("CC BY 4.0 · by A. Player · Wikimedia");
  });

  it("always yields a license label even with no attribution/source", () => {
    const prov = clipProvenance(toAudioClip(asset({ license: "" })));
    expect(prov.license).toBe("Unknown");
    expect(prov.summary).toBe("Unknown");
    expect(prov.attribution).toBeUndefined();
  });
});

describe("sequence navigation", () => {
  it("advances then stops at the end when not looping", () => {
    expect(nextClipIndex(0, 3)).toBe(1);
    expect(nextClipIndex(1, 3)).toBe(2);
    expect(nextClipIndex(2, 3)).toBeNull();
  });

  it("wraps at the end when looping", () => {
    expect(nextClipIndex(2, 3, true)).toBe(0);
  });

  it("returns null for an empty list", () => {
    expect(nextClipIndex(0, 0)).toBeNull();
  });

  it("wraps manual prev/forward navigation", () => {
    expect(prevClipIndex(0, 3)).toBe(2);
    expect(forwardClipIndex(2, 3)).toBe(0);
    expect(clampClipIndex(5, 3)).toBe(2);
  });
});

describe("audio support detection", () => {
  it("is supported when an <audio> element exposes canPlayType", () => {
    const doc = { createElement: () => ({ canPlayType: () => "probably" }) };
    expect(detectAudioSupport(doc)).toBe(true);
    expect(isAudioPlaybackSupported({ hasAudioElement: true })).toBe(true);
  });

  it("is unsupported without a document or canPlayType", () => {
    expect(detectAudioSupport(null)).toBe(false);
    expect(detectAudioSupport({ createElement: () => ({}) })).toBe(false);
    expect(isAudioPlaybackSupported({ hasAudioElement: false })).toBe(false);
  });
});
