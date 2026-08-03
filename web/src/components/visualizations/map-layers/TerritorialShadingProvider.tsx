/**
 * TerritorialShadingProvider injects SVG pattern definitions into Leaflet's
 * SVG renderer so that map layers can use hatched and striped fills via CSS.
 *
 * Place this component inside a <MapContainer> alongside the layers that
 * need pattern fills.
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import {
  type TerritorialFillType,
  patternId,
  createHatchedPatternSVG,
  createStripedPatternSVG,
  buildPatternCSS,
} from '../../../lib/visualization/territorial-shading';

interface PatternSpec {
  fillType: TerritorialFillType;
  color: string;
}

interface TerritorialShadingProviderProps {
  patterns: PatternSpec[];
}

export function TerritorialShadingProvider({ patterns }: TerritorialShadingProviderProps) {
  const map = useMap();
  const defsRef = useRef<SVGDefsElement | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    const container = map.getContainer();
    const svg = container.querySelector('svg.leaflet-zoom-animated');
    if (!svg) return;

    // Create or reuse <defs>
    let defs = svg.querySelector('defs.territorial-shading-defs') as SVGDefsElement | null;
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.setAttribute('class', 'territorial-shading-defs');
      svg.insertBefore(defs, svg.firstChild);
    }
    defsRef.current = defs;

    // Create or reuse <style>
    let style = document.getElementById('territorial-shading-styles') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'territorial-shading-styles';
      document.head.appendChild(style);
    }
    styleRef.current = style;

    return () => {
      // Clean up on unmount
      if (defsRef.current?.parentNode) {
        defsRef.current.parentNode.removeChild(defsRef.current);
      }
      if (styleRef.current?.parentNode) {
        styleRef.current.parentNode.removeChild(styleRef.current);
      }
    };
  }, [map]);

  useEffect(() => {
    const defs = defsRef.current;
    const style = styleRef.current;
    if (!defs || !style) return;

    // Build SVG patterns and CSS rules
    const patternMarkup: string[] = [];
    const cssRules: string[] = [];

    for (const { fillType, color } of patterns) {
      if (fillType === 'solid' || fillType === 'gradient') continue;

      const id = patternId(fillType, color);
      // Skip if already defined
      if (defs.querySelector(`#${id}`)) continue;

      if (fillType === 'hatched') {
        patternMarkup.push(createHatchedPatternSVG(color, id));
      } else if (fillType === 'striped') {
        patternMarkup.push(createStripedPatternSVG(color, id));
      }

      cssRules.push(buildPatternCSS(fillType, color));
    }

    if (patternMarkup.length > 0) {
      defs.innerHTML += patternMarkup.join('\n');
    }
    if (cssRules.length > 0) {
      style.textContent += cssRules.join('\n');
    }
  }, [patterns]);

  return null;
}
