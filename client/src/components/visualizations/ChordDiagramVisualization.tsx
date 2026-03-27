import React from 'react';
import { ChordDiagram } from './shared/ChordDiagram';
import { getFamilyColor } from '../../lib/visualization/d3-helpers';
import type { ChordData } from '@shared/types';

interface ChordDiagramVisualizationProps {
  data: ChordData;
  onGroupClick?: (name: string) => void;
}

function familyColorFn(_index: number, name: string): string {
  return getFamilyColor(name, 1);
}

function formatGroupTooltip(name: string, value: number): string {
  return `${name}\nTotal influence: ${value}`;
}

function formatRibbonTooltip(source: string, target: string, value: number): string {
  return `${source} ↔ ${target}\nInfluence: ${value}`;
}

export function ChordDiagramVisualization({ data, onGroupClick }: ChordDiagramVisualizationProps) {
  return (
    <ChordDiagram
      data={data}
      colorFn={familyColorFn}
      formatGroupTooltip={formatGroupTooltip}
      formatRibbonTooltip={formatRibbonTooltip}
      onGroupClick={onGroupClick ? (name) => onGroupClick(name) : undefined}
      exportFilename="chord-diagram"
      hintText="Hover for details · Click group to filter"
    />
  );
}
