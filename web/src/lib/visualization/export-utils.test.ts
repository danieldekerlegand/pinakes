import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectMapLayers,
  drawMapLayers,
  captureMapToCanvas,
  exportMapPNG,
  type MapLayerSource,
} from './export-utils';

// ---------------------------------------------------------------------------
// Test doubles — vitest runs in the `node` environment (no jsdom), so the DOM /
// canvas APIs the map export touches are mocked by hand.
// ---------------------------------------------------------------------------

type Rect = { left: number; top: number; width: number; height: number };

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fakeCanvasEl(r: DOMRect) {
  return { tagName: 'CANVAS', getBoundingClientRect: () => r } as unknown as HTMLCanvasElement;
}

function fakeTileImg(
  r: DOMRect,
  { complete = true, naturalWidth = 256 } = {}
) {
  return {
    tagName: 'IMG',
    complete,
    naturalWidth,
    getBoundingClientRect: () => r,
  } as unknown as HTMLImageElement;
}

function fakeContainer(r: DOMRect, children: unknown[]) {
  return {
    getBoundingClientRect: () => r,
    querySelectorAll: () => children as unknown as NodeListOf<Element>,
  } as unknown as HTMLElement;
}

/** A recording 2D context that captures every call for assertions. */
function recordingCtx() {
  const calls: Array<[string, ...unknown[]]> = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  const ctx = {
    calls,
    save: rec('save'),
    restore: rec('restore'),
    scale: rec('scale'),
    fillRect: rec('fillRect'),
    drawImage: rec('drawImage'),
    beginPath: rec('beginPath'),
    roundRect: rec('roundRect'),
    fill: rec('fill'),
    fillText: rec('fillText'),
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillStyle: '',
    font: '',
  };
  return ctx;
}

describe('collectMapLayers', () => {
  it('returns canvas + loaded tile layers with rects relative to the container', () => {
    const container = fakeContainer(rect(100, 50, 800, 600), [
      fakeCanvasEl(rect(100, 50, 800, 600)), // deck.gl canvas, flush with container
      fakeTileImg(rect(150, 100, 256, 256)), // a tile offset into the container
    ]);

    const layers = collectMapLayers(container);

    expect(layers).toHaveLength(2);
    expect(layers[0].rect).toEqual({ left: 0, top: 0, width: 800, height: 600 });
    expect(layers[1].rect).toEqual({ left: 50, top: 50, width: 256, height: 256 });
  });

  it('skips unloaded / broken tile images', () => {
    const container = fakeContainer(rect(0, 0, 500, 500), [
      fakeTileImg(rect(0, 0, 256, 256), { complete: false }),
      fakeTileImg(rect(0, 0, 256, 256), { naturalWidth: 0 }),
      fakeTileImg(rect(0, 0, 256, 256)), // the only good one
    ]);

    expect(collectMapLayers(container)).toHaveLength(1);
  });

  it('skips zero-size elements', () => {
    const container = fakeContainer(rect(0, 0, 500, 500), [
      fakeCanvasEl(rect(0, 0, 0, 0)),
      fakeCanvasEl(rect(0, 0, 500, 500)),
    ]);

    expect(collectMapLayers(container)).toHaveLength(1);
  });
});

describe('drawMapLayers', () => {
  const el = fakeCanvasEl(rect(0, 0, 10, 10));

  it('draws each layer at its rect', () => {
    const ctx = recordingCtx();
    const layers: MapLayerSource[] = [
      { element: el as unknown as CanvasImageSource, rect: { left: 0, top: 0, width: 800, height: 600 } },
      { element: el as unknown as CanvasImageSource, rect: { left: 50, top: 50, width: 256, height: 256 } },
    ];

    drawMapLayers(ctx as unknown as CanvasRenderingContext2D, layers);

    const draws = ctx.calls.filter((c) => c[0] === 'drawImage');
    expect(draws).toHaveLength(2);
    expect(draws[0].slice(1)).toEqual([el, 0, 0, 800, 600]);
    expect(draws[1].slice(1)).toEqual([el, 50, 50, 256, 256]);
  });

  it('skips zero-size layers', () => {
    const ctx = recordingCtx();
    drawMapLayers(ctx as unknown as CanvasRenderingContext2D, [
      { element: el as unknown as CanvasImageSource, rect: { left: 0, top: 0, width: 0, height: 100 } },
    ]);
    expect(ctx.calls.filter((c) => c[0] === 'drawImage')).toHaveLength(0);
  });

  it('swallows a throwing (tainted) source instead of aborting', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = {
      drawImage: () => {
        throw new Error('tainted');
      },
    };
    expect(() =>
      drawMapLayers(throwing as unknown as CanvasRenderingContext2D, [
        { element: el as unknown as CanvasImageSource, rect: { left: 0, top: 0, width: 10, height: 10 } },
      ])
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// captureMapToCanvas / exportMapPNG need a mocked `document` (createElement),
// `URL`, and canvas primitives.
// ---------------------------------------------------------------------------

interface Harness {
  ctx: ReturnType<typeof recordingCtx>;
  canvas: { width: number; height: number };
  clicks: number;
  downloads: string[];
  toBlobResult: Blob | null;
  hasContext: boolean;
}

function installDom(): Harness {
  const ctx = recordingCtx();
  const h: Harness = {
    ctx,
    canvas: { width: 0, height: 0 },
    clicks: 0,
    downloads: [],
    toBlobResult: new Blob(['png']),
    hasContext: true,
  };

  const canvasEl = {
    get width() {
      return h.canvas.width;
    },
    set width(v: number) {
      h.canvas.width = v;
    },
    get height() {
      return h.canvas.height;
    },
    set height(v: number) {
      h.canvas.height = v;
    },
    getContext: () => (h.hasContext ? ctx : null),
    toBlob: (cb: (b: Blob | null) => void) => cb(h.toBlobResult),
  };

  const doc = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return canvasEl;
      if (tag === 'a') {
        const link = {
          href: '',
          download: '',
          click: () => {
            h.clicks += 1;
            h.downloads.push(link.download);
          },
        };
        return link;
      }
      return {};
    },
    body: { appendChild: () => {}, removeChild: () => {} },
  };

  vi.stubGlobal('document', doc);
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {},
  });

  return h;
}

describe('captureMapToCanvas', () => {
  beforeEach(() => installDom());
  afterEach(() => vi.unstubAllGlobals());

  it('sizes the canvas to container * scale and fills the background', () => {
    const h = installDom();
    const container = fakeContainer(rect(0, 0, 400, 300), [fakeCanvasEl(rect(0, 0, 400, 300))]);

    const result = captureMapToCanvas(container, { scale: 3 });

    expect(result).not.toBeNull();
    expect(h.canvas.width).toBe(1200);
    expect(h.canvas.height).toBe(900);
    expect(h.ctx.calls.find((c) => c[0] === 'scale')?.slice(1)).toEqual([3, 3]);
    // background fill uses CSS-pixel dimensions (context is pre-scaled)
    expect(h.ctx.calls.find((c) => c[0] === 'fillRect')?.slice(1)).toEqual([0, 0, 400, 300]);
    // one layer drawn
    expect(h.ctx.calls.filter((c) => c[0] === 'drawImage')).toHaveLength(1);
  });

  it('draws the watermark by default and omits it when disabled', () => {
    const h1 = installDom();
    captureMapToCanvas(fakeContainer(rect(0, 0, 400, 300), []), { watermark: true });
    expect(h1.ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'pinakes')).toBe(true);

    const h2 = installDom();
    captureMapToCanvas(fakeContainer(rect(0, 0, 400, 300), []), { watermark: false });
    expect(h2.ctx.calls.some((c) => c[0] === 'fillText')).toBe(false);
  });

  it('returns null when no 2D context is available', () => {
    const h = installDom();
    h.hasContext = false;
    expect(captureMapToCanvas(fakeContainer(rect(0, 0, 100, 100), []))).toBeNull();
  });
});

describe('exportMapPNG', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('captures, converts to a PNG blob, and triggers a download', async () => {
    const h = installDom();
    const container = fakeContainer(rect(0, 0, 400, 300), [fakeCanvasEl(rect(0, 0, 400, 300))]);

    const ok = await exportMapPNG(container, 'my-map.png', 2);

    expect(ok).toBe(true);
    expect(h.clicks).toBe(1);
    expect(h.downloads).toEqual(['my-map.png']);
  });

  it('resolves false when the canvas cannot produce a blob', async () => {
    const h = installDom();
    h.toBlobResult = null;
    const ok = await exportMapPNG(fakeContainer(rect(0, 0, 400, 300), []));
    expect(ok).toBe(false);
    expect(h.clicks).toBe(0);
  });

  it('resolves false when no 2D context is available', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = installDom();
    h.hasContext = false;
    const ok = await exportMapPNG(fakeContainer(rect(0, 0, 400, 300), []));
    expect(ok).toBe(false);
    err.mockRestore();
  });
});
