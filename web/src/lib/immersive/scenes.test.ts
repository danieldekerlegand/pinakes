import { describe, it, expect } from 'vitest';
import {
  detectImmersiveSupport,
  availableSceneModes,
  selectSceneMode,
  buildFlyThroughPath,
  selectMuseumArtifacts,
  isPublicDomainLicense,
  countRenderableModels,
  SCENE_MODES,
  type ImmersiveEnvironment,
  type ImmersiveSupport,
  type RouteFeatureLike,
  type MuseumArtifactInput,
} from './scenes';

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

const vrEnv = (supportsVr = true): ImmersiveEnvironment => ({
  isSecureContext: true,
  webgl2: true,
  xr: { isSessionSupported: async (mode: string) => mode === 'immersive-vr' && supportsVr },
});

describe('detectImmersiveSupport', () => {
  it('reports immersive-vr on a secure WebXR + WebGL2 device', async () => {
    const s = await detectImmersiveSupport(vrEnv(true));
    expect(s.canRender3d).toBe(true);
    expect(s.hasImmersiveVr).toBe(true);
    expect(s.reason).toBe('immersive-vr');
  });

  it('falls back to on-screen 3D when WebXR is absent but WebGL2 works', async () => {
    const s = await detectImmersiveSupport({ isSecureContext: true, webgl2: true, xr: null });
    expect(s.canRender3d).toBe(true);
    expect(s.hasImmersiveVr).toBe(false);
    expect(s.hasWebXr).toBe(false);
    expect(s.reason).toBe('on-screen-3d');
  });

  it('on-screen 3D still available when immersive-vr session is unsupported', async () => {
    const s = await detectImmersiveSupport(vrEnv(false));
    expect(s.hasWebXr).toBe(true);
    expect(s.hasImmersiveVr).toBe(false);
    expect(s.canRender3d).toBe(true);
    expect(s.reason).toBe('on-screen-3d');
  });

  it('reports no-webgl2 (only flat map) when WebGL2 is unavailable', async () => {
    const s = await detectImmersiveSupport({ isSecureContext: true, webgl2: false, xr: null });
    expect(s.canRender3d).toBe(false);
    expect(s.reason).toBe('no-webgl2');
  });

  it('no-webgl2 takes priority over insecure context', async () => {
    const s = await detectImmersiveSupport({ isSecureContext: false, webgl2: false });
    expect(s.reason).toBe('no-webgl2');
  });

  it('flags insecure-context (blocks headset) when WebGL2 ok but not secure', async () => {
    const s = await detectImmersiveSupport({ isSecureContext: false, webgl2: true, xr: vrEnv().xr });
    expect(s.canRender3d).toBe(true);
    expect(s.hasImmersiveVr).toBe(false); // VR probe skipped in an insecure context
    expect(s.reason).toBe('insecure-context');
  });

  it('never throws when isSessionSupported rejects', async () => {
    const s = await detectImmersiveSupport({
      isSecureContext: true,
      webgl2: true,
      xr: { isSessionSupported: async () => { throw new Error('unknown mode'); } },
    });
    expect(s.hasImmersiveVr).toBe(false);
    expect(s.reason).toBe('on-screen-3d');
  });

  it('defaults optimistic for a null env (SSR/tests)', async () => {
    const s = await detectImmersiveSupport(null);
    expect(s.canRender3d).toBe(true);
    expect(s.hasImmersiveVr).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scene-mode selection
// ---------------------------------------------------------------------------

const support = (canRender3d: boolean): ImmersiveSupport => ({
  canRender3d,
  hasImmersiveVr: false,
  hasWebXr: false,
  hasWebgl2: canRender3d,
  secureContext: true,
  reason: canRender3d ? 'on-screen-3d' : 'no-webgl2',
});

describe('availableSceneModes / selectSceneMode', () => {
  it('exposes all three modes when 3D can render', () => {
    expect(availableSceneModes(support(true))).toEqual(['flat', 'globe', 'museum']);
  });

  it('exposes only the flat map without WebGL2', () => {
    expect(availableSceneModes(support(false))).toEqual(['flat']);
  });

  it('keeps the requested mode when available', () => {
    expect(selectSceneMode('museum', support(true))).toEqual({ mode: 'museum' });
    expect(selectSceneMode('globe', support(true))).toEqual({ mode: 'globe' });
  });

  it('degrades museum/globe to flat when 3D is unavailable', () => {
    expect(selectSceneMode('museum', support(false))).toEqual({ mode: 'flat', degradedFrom: 'museum' });
    expect(selectSceneMode('globe', support(false))).toEqual({ mode: 'flat', degradedFrom: 'globe' });
  });

  it('flat is always available (never degraded)', () => {
    expect(selectSceneMode('flat', support(false))).toEqual({ mode: 'flat' });
  });

  it('SCENE_MODES is ordered most-immersive first', () => {
    expect(SCENE_MODES).toEqual(['museum', 'globe', 'flat']);
  });
});

// ---------------------------------------------------------------------------
// Fly-through path
// ---------------------------------------------------------------------------

const route = (
  id: string,
  year: number,
  coords: [number, number][],
  name?: string,
): RouteFeatureLike => ({
  geometry: { type: 'LineString', coordinates: coords },
  properties: { routeId: id, name: name ?? id, timePeriod: { start: year, end: null, label: '' } },
});

describe('buildFlyThroughPath', () => {
  it('visits routes oldest-first (time-space order)', () => {
    const frames = buildFlyThroughPath([
      route('recent', -2000, [[0, 0], [10, 10]]),
      route('ancient', -50000, [[20, 20], [30, 30]]),
    ]);
    const order = frames.filter((f) => f.isRouteStart).map((f) => f.routeId);
    expect(order).toEqual(['ancient', 'recent']);
  });

  it('follows each migration path waypoint by waypoint', () => {
    const frames = buildFlyThroughPath([route('r', -1000, [[0, 0], [5, 5], [10, 10]])]);
    expect(frames).toHaveLength(3);
    expect(frames.map((f) => [f.longitude, f.latitude])).toEqual([[0, 0], [5, 5], [10, 10]]);
    expect(frames[0].isRouteStart).toBe(true);
    expect(frames[1].isRouteStart).toBe(false);
    expect(frames[0].label).toContain('waypoint 1/3');
  });

  it('samples long routes down to maxPointsPerRoute, keeping the endpoints', () => {
    const many: [number, number][] = Array.from({ length: 20 }, (_, i) => [i, i]);
    const frames = buildFlyThroughPath([route('r', 0, many)], { maxPointsPerRoute: 4 });
    expect(frames).toHaveLength(4);
    expect([frames[0].longitude, frames[0].latitude]).toEqual([0, 0]);
    expect([frames[3].longitude, frames[3].latitude]).toEqual([19, 19]);
  });

  it('skips routes with fewer than two valid points', () => {
    expect(buildFlyThroughPath([route('r', 0, [[0, 0]])])).toHaveLength(0);
    expect(
      buildFlyThroughPath([{ geometry: { type: 'LineString', coordinates: 'nope' }, properties: {} }]),
    ).toHaveLength(0);
  });

  it('sorts undated routes after dated ones', () => {
    const undated: RouteFeatureLike = {
      geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
      properties: { routeId: 'undated', name: 'undated' },
    };
    const frames = buildFlyThroughPath([undated, route('dated', -100, [[0, 0], [5, 5]])]);
    const order = frames.filter((f) => f.isRouteStart).map((f) => f.routeId);
    expect(order).toEqual(['dated', 'undated']);
  });

  it('caps total keyframes', () => {
    const routes = Array.from({ length: 30 }, (_, i) => route(`r${i}`, i, [[0, 0], [1, 1], [2, 2]]));
    const frames = buildFlyThroughPath(routes, { maxKeyframes: 10 });
    expect(frames).toHaveLength(10);
  });

  it('returns [] for empty / nullish input', () => {
    expect(buildFlyThroughPath(null)).toEqual([]);
    expect(buildFlyThroughPath([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Museum artifacts
// ---------------------------------------------------------------------------

describe('isPublicDomainLicense', () => {
  it('accepts CC0 / public domain / CC-BY', () => {
    expect(isPublicDomainLicense('CC0 1.0')).toBe(true);
    expect(isPublicDomainLicense('Public Domain')).toBe(true);
    expect(isPublicDomainLicense('CC-BY 4.0')).toBe(true);
    expect(isPublicDomainLicense('CC BY 4.0')).toBe(true);
  });

  it('rejects NC / ND / all-rights-reserved / unknown', () => {
    expect(isPublicDomainLicense('CC-BY-NC 4.0')).toBe(false);
    expect(isPublicDomainLicense('CC-BY-ND')).toBe(false);
    expect(isPublicDomainLicense('All Rights Reserved')).toBe(false);
    expect(isPublicDomainLicense(null)).toBe(false);
    expect(isPublicDomainLicense(undefined)).toBe(false);
    expect(isPublicDomainLicense('')).toBe(false);
  });
});

describe('selectMuseumArtifacts', () => {
  const inputs: MuseumArtifactInput[] = [
    { id: 'vase', name: 'Minoan Vase', modelUrl: 'https://ex/vase.glb', license: 'CC0' },
    { id: 'mask', name: 'Gold Mask', modelUrl: 'https://ex/mask.glb', license: 'CC-BY-NC' },
    { id: 'axe', name: 'Bronze Axe', modelUrl: null, license: null },
    { id: 'coin', name: 'Silver Coin', modelUrl: 'https://ex/coin.glb', license: 'Public Domain' },
  ];

  it('renders a model only when a public-domain model URL exists', () => {
    const out = selectMuseumArtifacts(inputs);
    const byId = Object.fromEntries(out.map((a) => [a.id, a]));
    expect(byId.vase.hasModel).toBe(true);
    expect(byId.vase.modelUrl).toBe('https://ex/vase.glb');
    expect(byId.mask.hasModel).toBe(false); // NC license — not renderable
    expect(byId.mask.modelUrl).toBe(null);
    expect(byId.axe.hasModel).toBe(false); // no model URL at all
    expect(byId.coin.hasModel).toBe(true);
  });

  it('sorts model-bearing artifacts first, then alphabetical', () => {
    const out = selectMuseumArtifacts(inputs);
    // model-bearing first (by name: "Minoan Vase" < "Silver Coin"), then placeholders
    expect(out.map((a) => a.id)).toEqual(['vase', 'coin', 'axe', 'mask']);
  });

  it('countRenderableModels reflects only renderable models', () => {
    const out = selectMuseumArtifacts(inputs);
    expect(countRenderableModels(out)).toBe(2);
  });

  it('handles an all-placeholder set (no public-domain models exist)', () => {
    const out = selectMuseumArtifacts([
      { id: 'a', name: 'A', modelUrl: null },
      { id: 'b', name: 'B', modelUrl: 'https://ex/b.glb', license: 'All Rights Reserved' },
    ]);
    expect(out).toHaveLength(2);
    expect(countRenderableModels(out)).toBe(0);
    expect(out.every((a) => !a.hasModel)).toBe(true);
  });

  it('caps the returned artifact count', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    expect(selectMuseumArtifacts(many, { maxArtifacts: 10 })).toHaveLength(10);
  });

  it('drops malformed entries and returns [] for nullish input', () => {
    expect(selectMuseumArtifacts(null)).toEqual([]);
    const out = selectMuseumArtifacts([
      { id: 'ok', name: 'Ok' },
      // @ts-expect-error — malformed on purpose
      { name: 'no id' },
    ]);
    expect(out.map((a) => a.id)).toEqual(['ok']);
  });
});
