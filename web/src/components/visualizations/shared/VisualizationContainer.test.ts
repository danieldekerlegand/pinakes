import { describe, it, expect } from 'vitest';
import type { TooltipState, VisualizationRenderContext, VisualizationContainerProps } from './VisualizationContainer';
import type { TooltipData } from '../../../lib/visualization/types';

describe('VisualizationContainer types and tooltip state', () => {
  const sampleTooltipData: TooltipData = {
    id: 'lang-1',
    name: 'English',
    type: 'language',
    familyName: 'Indo-European',
    region: 'Europe',
    status: 'living',
    totalSpeakers: 1500000000,
  };

  describe('TooltipState', () => {
    it('should represent initial tooltip state correctly', () => {
      const initial: TooltipState = {
        data: null,
        x: 0,
        y: 0,
        visible: false,
      };

      expect(initial.data).toBeNull();
      expect(initial.visible).toBe(false);
      expect(initial.x).toBe(0);
      expect(initial.y).toBe(0);
    });

    it('should represent visible tooltip state correctly', () => {
      const visible: TooltipState = {
        data: sampleTooltipData,
        x: 150,
        y: 200,
        visible: true,
      };

      expect(visible.data).toBe(sampleTooltipData);
      expect(visible.visible).toBe(true);
      expect(visible.x).toBe(150);
      expect(visible.y).toBe(200);
    });

    it('should support tooltip move by updating only coordinates', () => {
      const state: TooltipState = {
        data: sampleTooltipData,
        x: 100,
        y: 100,
        visible: true,
      };

      const moved: TooltipState = { ...state, x: 200, y: 300 };

      expect(moved.data).toBe(sampleTooltipData);
      expect(moved.visible).toBe(true);
      expect(moved.x).toBe(200);
      expect(moved.y).toBe(300);
    });

    it('should support tooltip hide by setting visible to false', () => {
      const state: TooltipState = {
        data: sampleTooltipData,
        x: 100,
        y: 100,
        visible: true,
      };

      const hidden: TooltipState = { ...state, visible: false };

      expect(hidden.data).toBe(sampleTooltipData);
      expect(hidden.visible).toBe(false);
    });
  });

  describe('VisualizationContainerProps', () => {
    it('should accept minimal props', () => {
      const props: Pick<VisualizationContainerProps, 'currentView' | 'children'> = {
        currentView: 'tree',
        children: () => null,
      };

      expect(props.currentView).toBe('tree');
      expect(typeof props.children).toBe('function');
    });

    it('should accept all optional props', () => {
      const props: VisualizationContainerProps = {
        currentView: 'network',
        interactionHint: 'Scroll to zoom',
        exportData: [{ id: '1' }],
        showExport: true,
        loading: false,
        emptyMessage: 'No languages found',
        isEmpty: false,
        className: 'custom-class',
        children: () => null,
      };

      expect(props.interactionHint).toBe('Scroll to zoom');
      expect(props.showExport).toBe(true);
      expect(props.loading).toBe(false);
      expect(props.emptyMessage).toBe('No languages found');
      expect(props.isEmpty).toBe(false);
      expect(props.className).toBe('custom-class');
    });
  });

  describe('VisualizationRenderContext', () => {
    it('should have the expected shape', () => {
      const context: VisualizationRenderContext = {
        width: 800,
        height: 600,
        containerRef: { current: null } as any,
        svgRef: { current: null } as any,
        tooltip: { data: null, x: 0, y: 0, visible: false },
        showTooltip: () => {},
        moveTooltip: () => {},
        hideTooltip: () => {},
      };

      expect(context.width).toBe(800);
      expect(context.height).toBe(600);
      expect(typeof context.showTooltip).toBe('function');
      expect(typeof context.moveTooltip).toBe('function');
      expect(typeof context.hideTooltip).toBe('function');
    });
  });

  describe('tooltip state transitions', () => {
    it('should follow show -> move -> hide lifecycle', () => {
      let state: TooltipState = { data: null, x: 0, y: 0, visible: false };

      // Show
      state = { data: sampleTooltipData, x: 100, y: 200, visible: true };
      expect(state.visible).toBe(true);
      expect(state.data?.name).toBe('English');

      // Move
      state = { ...state, x: 150, y: 250 };
      expect(state.visible).toBe(true);
      expect(state.x).toBe(150);
      expect(state.y).toBe(250);
      expect(state.data?.name).toBe('English');

      // Hide
      state = { ...state, visible: false };
      expect(state.visible).toBe(false);
      expect(state.data?.name).toBe('English'); // data preserved on hide
    });

    it('should support different tooltip data types', () => {
      const familyData: TooltipData = {
        id: 'fam-1',
        name: 'Indo-European',
        type: 'family',
        languageCount: 449,
      };

      const state: TooltipState = {
        data: familyData,
        x: 50,
        y: 75,
        visible: true,
      };

      expect(state.data?.type).toBe('family');
      expect(state.data?.languageCount).toBe(449);
    });
  });
});
