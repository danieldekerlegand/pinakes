import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatYear, ALL_COMPARISON_LAYERS, COMPARISON_LAYER_LABELS } from './useSplitScreen';
import type { ComparisonMode, ComparisonLayerType, SplitScreenState } from './useSplitScreen';

/** Helper to create a SplitScreenState with default layer sets */
function makeState(overrides: Omit<SplitScreenState, 'leftLayers' | 'rightLayers'> & {
  leftLayers?: Set<ComparisonLayerType>;
  rightLayers?: Set<ComparisonLayerType>;
}): SplitScreenState {
  return {
    leftLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
    rightLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
    ...overrides,
  };
}

// ============================================================================
// formatYear utility tests
// ============================================================================

describe('formatYear', () => {
  it('formats negative years as BCE', () => {
    expect(formatYear(-3000)).toBe('3000 BCE');
    expect(formatYear(-500)).toBe('500 BCE');
    expect(formatYear(-1)).toBe('1 BCE');
  });

  it('formats positive years as CE', () => {
    expect(formatYear(2024)).toBe('2024 CE');
    expect(formatYear(1)).toBe('1 CE');
    expect(formatYear(500)).toBe('500 CE');
  });

  it('formats year 0 as CE', () => {
    expect(formatYear(0)).toBe('0 CE');
  });
});

// ============================================================================
// SplitScreenState type tests
// ============================================================================

describe('SplitScreenState', () => {
  it('has correct default structure', () => {
    const state: SplitScreenState = {
      isActive: false,
      mode: 'swipe',
      leftYear: -500,
      rightYear: 2024,
      dividerPosition: 50,
      blinkInterval: 1500,
      blinkShowingLeft: true,
      leftLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
      rightLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
    };
    expect(state.isActive).toBe(false);
    expect(state.mode).toBe('swipe');
    expect(state.dividerPosition).toBe(50);
    expect(state.leftLayers.size).toBe(2);
    expect(state.rightLayers.size).toBe(2);
  });

  it('supports swipe mode', () => {
    const mode: ComparisonMode = 'swipe';
    expect(mode).toBe('swipe');
  });

  it('supports blink mode', () => {
    const mode: ComparisonMode = 'blink';
    expect(mode).toBe('blink');
  });
});

// ============================================================================
// Split screen state logic tests (pure function simulations)
// ============================================================================

describe('split screen state logic', () => {
  // Simulate the clamping logic from useSplitScreen
  function clampYear(year: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, year));
  }

  function clampDivider(position: number): number {
    return Math.max(10, Math.min(90, position));
  }

  function clampBlinkInterval(interval: number): number {
    return Math.max(200, Math.min(5000, interval));
  }

  describe('year clamping', () => {
    it('clamps year to min bound', () => {
      expect(clampYear(-5000, -3000, 2024)).toBe(-3000);
    });

    it('clamps year to max bound', () => {
      expect(clampYear(3000, -3000, 2024)).toBe(2024);
    });

    it('allows year within range', () => {
      expect(clampYear(500, -3000, 2024)).toBe(500);
    });

    it('allows exact min', () => {
      expect(clampYear(-3000, -3000, 2024)).toBe(-3000);
    });

    it('allows exact max', () => {
      expect(clampYear(2024, -3000, 2024)).toBe(2024);
    });
  });

  describe('divider position clamping', () => {
    it('clamps to minimum 10%', () => {
      expect(clampDivider(0)).toBe(10);
      expect(clampDivider(5)).toBe(10);
    });

    it('clamps to maximum 90%', () => {
      expect(clampDivider(100)).toBe(90);
      expect(clampDivider(95)).toBe(90);
    });

    it('allows values within range', () => {
      expect(clampDivider(50)).toBe(50);
      expect(clampDivider(10)).toBe(10);
      expect(clampDivider(90)).toBe(90);
    });
  });

  describe('blink interval clamping', () => {
    it('clamps to minimum 200ms', () => {
      expect(clampBlinkInterval(50)).toBe(200);
      expect(clampBlinkInterval(0)).toBe(200);
    });

    it('clamps to maximum 5000ms', () => {
      expect(clampBlinkInterval(10000)).toBe(5000);
      expect(clampBlinkInterval(6000)).toBe(5000);
    });

    it('allows values within range', () => {
      expect(clampBlinkInterval(1500)).toBe(1500);
      expect(clampBlinkInterval(200)).toBe(200);
      expect(clampBlinkInterval(5000)).toBe(5000);
    });
  });

  describe('year swapping', () => {
    it('swaps left and right years', () => {
      const state = { leftYear: -500, rightYear: 2024 };
      const swapped = { leftYear: state.rightYear, rightYear: state.leftYear };
      expect(swapped.leftYear).toBe(2024);
      expect(swapped.rightYear).toBe(-500);
    });

    it('swap is its own inverse', () => {
      const state = { leftYear: -500, rightYear: 2024 };
      const swapped = { leftYear: state.rightYear, rightYear: state.leftYear };
      const doubleSwapped = { leftYear: swapped.rightYear, rightYear: swapped.leftYear };
      expect(doubleSwapped.leftYear).toBe(state.leftYear);
      expect(doubleSwapped.rightYear).toBe(state.rightYear);
    });
  });

  describe('active year computation', () => {
    it('returns left year when blink showing left', () => {
      const state = makeState({
        isActive: true, mode: 'blink', leftYear: -500, rightYear: 2024,
        dividerPosition: 50, blinkInterval: 1500, blinkShowingLeft: true,
      });
      const activeYear = state.blinkShowingLeft ? state.leftYear : state.rightYear;
      expect(activeYear).toBe(-500);
    });

    it('returns right year when blink showing right', () => {
      const state = makeState({
        isActive: true, mode: 'blink', leftYear: -500, rightYear: 2024,
        dividerPosition: 50, blinkInterval: 1500, blinkShowingLeft: false,
      });
      const activeYear = state.blinkShowingLeft ? state.leftYear : state.rightYear;
      expect(activeYear).toBe(2024);
    });

    it('returns currentYear when not in blink mode', () => {
      const currentYear = 1000;
      const state = makeState({
        isActive: true, mode: 'swipe', leftYear: -500, rightYear: 2024,
        dividerPosition: 50, blinkInterval: 1500, blinkShowingLeft: true,
      });
      const activeYear = state.isActive && state.mode === 'blink'
        ? (state.blinkShowingLeft ? state.leftYear : state.rightYear)
        : currentYear;
      expect(activeYear).toBe(1000);
    });

    it('returns currentYear when split screen is inactive', () => {
      const currentYear = 1000;
      const state = makeState({
        isActive: false, mode: 'blink', leftYear: -500, rightYear: 2024,
        dividerPosition: 50, blinkInterval: 1500, blinkShowingLeft: true,
      });
      const activeYear = state.isActive && state.mode === 'blink'
        ? (state.blinkShowingLeft ? state.leftYear : state.rightYear)
        : currentYear;
      expect(activeYear).toBe(1000);
    });
  });

  describe('mode transitions', () => {
    it('activating resets blink showing to left', () => {
      const prev = makeState({
        isActive: false, mode: 'blink', leftYear: -500, rightYear: 2024,
        dividerPosition: 50, blinkInterval: 1500, blinkShowingLeft: false,
      });
      const activated = { ...prev, isActive: true, blinkShowingLeft: true };
      expect(activated.isActive).toBe(true);
      expect(activated.blinkShowingLeft).toBe(true);
    });

    it('deactivating resets blink showing to left', () => {
      const prev = makeState({
        isActive: true, mode: 'blink', leftYear: -500, rightYear: 2024,
        dividerPosition: 50, blinkInterval: 1500, blinkShowingLeft: false,
      });
      const deactivated = { ...prev, isActive: false, blinkShowingLeft: true };
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.blinkShowingLeft).toBe(true);
    });

    it('switching to swipe mode preserves years', () => {
      const state: SplitScreenState = {
        isActive: true,
        mode: 'blink',
        leftYear: -1000,
        rightYear: 500,
        dividerPosition: 50,
        blinkInterval: 1500,
        blinkShowingLeft: false,
        leftLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
        rightLayers: new Set<ComparisonLayerType>(['civilizations', 'language-ranges']),
      };
      const switched = { ...state, mode: 'swipe' as ComparisonMode, blinkShowingLeft: true };
      expect(switched.mode).toBe('swipe');
      expect(switched.leftYear).toBe(-1000);
      expect(switched.rightYear).toBe(500);
    });
  });

  describe('per-side layer configuration', () => {
    function toggleLayer(layers: Set<ComparisonLayerType>, layer: ComparisonLayerType): Set<ComparisonLayerType> {
      const next = new Set(layers);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    }

    it('defaults to all layers on both sides', () => {
      const left = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      const right = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      expect(left.has('civilizations')).toBe(true);
      expect(left.has('language-ranges')).toBe(true);
      expect(right.has('civilizations')).toBe(true);
      expect(right.has('language-ranges')).toBe(true);
    });

    it('toggles a layer off on the left side', () => {
      const layers = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      const toggled = toggleLayer(layers, 'civilizations');
      expect(toggled.has('civilizations')).toBe(false);
      expect(toggled.has('language-ranges')).toBe(true);
    });

    it('toggles a layer on from empty', () => {
      const layers = new Set<ComparisonLayerType>();
      const toggled = toggleLayer(layers, 'language-ranges');
      expect(toggled.has('language-ranges')).toBe(true);
      expect(toggled.size).toBe(1);
    });

    it('toggle is its own inverse', () => {
      const layers = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      const once = toggleLayer(layers, 'civilizations');
      const twice = toggleLayer(once, 'civilizations');
      expect(twice.has('civilizations')).toBe(true);
      expect(twice.has('language-ranges')).toBe(true);
    });

    it('left and right sides are independent', () => {
      const left = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      const right = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      const newLeft = toggleLayer(left, 'civilizations');
      // Right should be unaffected
      expect(right.has('civilizations')).toBe(true);
      expect(newLeft.has('civilizations')).toBe(false);
    });

    it('can have empty layers on one side', () => {
      let layers = new Set<ComparisonLayerType>(['civilizations', 'language-ranges']);
      layers = toggleLayer(layers, 'civilizations');
      layers = toggleLayer(layers, 'language-ranges');
      expect(layers.size).toBe(0);
    });
  });
});

// ============================================================================
// Comparison layer constants tests
// ============================================================================

describe('comparison layer constants', () => {
  it('ALL_COMPARISON_LAYERS contains expected layer types', () => {
    expect(ALL_COMPARISON_LAYERS).toContain('civilizations');
    expect(ALL_COMPARISON_LAYERS).toContain('language-ranges');
    expect(ALL_COMPARISON_LAYERS.length).toBe(2);
  });

  it('COMPARISON_LAYER_LABELS has labels for all layer types', () => {
    for (const layer of ALL_COMPARISON_LAYERS) {
      expect(COMPARISON_LAYER_LABELS[layer]).toBeDefined();
      expect(typeof COMPARISON_LAYER_LABELS[layer]).toBe('string');
      expect(COMPARISON_LAYER_LABELS[layer].length).toBeGreaterThan(0);
    }
  });

  it('has readable label names', () => {
    expect(COMPARISON_LAYER_LABELS['civilizations']).toBe('Civilizations');
    expect(COMPARISON_LAYER_LABELS['language-ranges']).toBe('Language Ranges');
  });
});
