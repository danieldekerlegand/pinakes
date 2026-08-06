import { clampIndex, nextIndex, prevIndex, normalizeLicense } from "./image-gallery-utils";

/**
 * Pure helpers for the audio side of the culture media gallery (US-003).
 *
 * `mediaType:'audio'` assets (music traditions, instrument clips) are supported
 * by `services/api/src/pinakes/media/assets.py` but the image gallery can only
 * render `<img>` thumbnails, so audio must be split out and played with a
 * dedicated player. All list/partition/provenance/sequence logic lives here so
 * it is unit-testable in the node test environment; the React player
 * (`CultureAudioGallery.tsx`) is a thin wrapper around an `<audio>` element.
 */

/** Media types we treat as playable audio clips. */
export const AUDIO_MEDIA_TYPES = ["audio", "music", "sound"] as const;

/** Loose shape shared with the media-asset API rows. */
export interface MediaAssetLike {
  id: string;
  mediaType: string;
  url: string;
  title: string;
  description?: string;
  source?: string;
  license?: string;
  attribution?: string;
  mimeType?: string;
  tags?: string[];
}

/** A normalized, ready-to-play audio clip. */
export interface AudioClip {
  id: string;
  url: string;
  title: string;
  description?: string;
  source?: string;
  license?: string;
  attribution?: string;
  mimeType?: string;
  tags: string[];
}

/** Is this asset a playable audio clip? */
export function isAudioAsset(asset: { mediaType?: string | null }): boolean {
  const t = (asset.mediaType ?? "").trim().toLowerCase();
  return (AUDIO_MEDIA_TYPES as readonly string[]).includes(t);
}

/** Split a mixed asset list into audio clips and everything else (images). */
export function partitionMedia<T extends { mediaType?: string | null }>(
  assets: T[],
): { audio: T[]; images: T[] } {
  const audio: T[] = [];
  const images: T[] = [];
  for (const asset of assets) {
    if (isAudioAsset(asset)) audio.push(asset);
    else images.push(asset);
  }
  return { audio, images };
}

/** Normalize a media-asset row into an {@link AudioClip}. */
export function toAudioClip(asset: MediaAssetLike): AudioClip {
  return {
    id: asset.id,
    url: asset.url,
    title: asset.title,
    description: asset.description || undefined,
    source: asset.source || undefined,
    license: asset.license || undefined,
    attribution: asset.attribution || undefined,
    mimeType: asset.mimeType || undefined,
    tags: asset.tags ?? [],
  };
}

export interface ClipProvenance {
  /** Human label for the licence (falls back to "Unknown"). */
  license: string;
  attribution?: string;
  source?: string;
  /** A single-line credit string for compact display. */
  summary: string;
}

/**
 * Build the attribution/provenance shown for a clip. Always yields a licence
 * label; attribution/source are included when present.
 */
export function clipProvenance(clip: AudioClip): ClipProvenance {
  const license = normalizeLicense(clip.license);
  const attribution = clip.attribution?.trim() || undefined;
  const source = clip.source?.trim() || undefined;

  const parts = [license];
  if (attribution) parts.push(`by ${attribution}`);
  if (source) parts.push(source);

  return { license, attribution, source, summary: parts.join(" · ") };
}

/**
 * Next index when playing a sequence/playlist. Returns `null` at the end when
 * not looping so the player can stop cleanly; wraps when `loop` is set.
 */
export function nextClipIndex(
  current: number,
  length: number,
  loop = false,
): number | null {
  if (length <= 0) return null;
  if (current >= length - 1) return loop ? 0 : null;
  return current + 1;
}

/** Previous index for manual navigation (wraps). */
export function prevClipIndex(current: number, length: number): number {
  return prevIndex(current, length);
}

/** Clamp/normalize an index into range (wraps), for manual selection. */
export function clampClipIndex(index: number, length: number): number {
  return clampIndex(index, length);
}

/** Forward manual navigation (wraps), mirroring the image gallery. */
export function forwardClipIndex(current: number, length: number): number {
  return nextIndex(current, length);
}

/** Minimal shape of the `Audio`/`document` bits we feature-detect against. */
export interface AudioPlaybackEnv {
  hasAudioElement: boolean;
}

/** Feature-detect: can this environment play HTML5 audio at all? */
export function isAudioPlaybackSupported(env: AudioPlaybackEnv): boolean {
  return env.hasAudioElement;
}

/** Detect audio support from a real (or fake) `document`. */
export function detectAudioSupport(
  doc?: { createElement?: (tag: string) => unknown } | null,
): boolean {
  try {
    if (!doc?.createElement) return false;
    const el = doc.createElement("audio") as { canPlayType?: unknown } | null;
    return !!el && typeof el.canPlayType === "function";
  } catch {
    return false;
  }
}
