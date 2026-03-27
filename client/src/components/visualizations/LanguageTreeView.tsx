import React, { useState, useCallback, useMemo } from 'react';
import { ChevronRight, ChevronDown, Globe, Languages, Users } from 'lucide-react';
import { useVisualization } from '../../contexts/VisualizationContext';
import type { TreeNode } from '../../lib/visualization/types';
import type { LanguageFamilyWithChildren, LanguageWithVariants } from '../../../../shared/types';

interface LanguageTreeViewProps {
  treeData: TreeNode[];
  onNodeClick?: (id: string, type: 'family' | 'language') => void;
}

// Level-based color scheme matching the existing palette
const LEVEL_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-300', dot: 'bg-blue-500', text: 'text-blue-700', hover: 'hover:bg-blue-100' },
  { bg: 'bg-emerald-50', border: 'border-emerald-300', dot: 'bg-emerald-500', text: 'text-emerald-700', hover: 'hover:bg-emerald-100' },
  { bg: 'bg-orange-50', border: 'border-orange-300', dot: 'bg-orange-500', text: 'text-orange-700', hover: 'hover:bg-orange-100' },
  { bg: 'bg-gray-50', border: 'border-gray-300', dot: 'bg-gray-500', text: 'text-gray-700', hover: 'hover:bg-gray-100' },
];

function getLevelStyle(level: number) {
  return LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];
}

function countDescendants(node: TreeNode): { families: number; languages: number } {
  let families = 0;
  let languages = 0;
  for (const child of node.children ?? []) {
    if (child.type === 'family') {
      families++;
      const sub = countDescendants(child);
      families += sub.families;
      languages += sub.languages;
    } else {
      languages++;
    }
  }
  return { families, languages };
}

function formatSpeakers(count: number | undefined | null): string {
  if (!count) return '';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

interface TreeNodeItemProps {
  node: TreeNode;
  level: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
  onNodeClick?: (id: string, type: 'family' | 'language') => void;
  isLanguageSelected: (id: string) => boolean;
  searchQuery: string;
}

function TreeNodeItem({
  node,
  level,
  expandedNodes,
  onToggle,
  onNodeClick,
  isLanguageSelected,
  searchQuery,
}: TreeNodeItemProps) {
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = node.children && node.children.length > 0;
  const style = getLevelStyle(level);
  const isFamily = node.type === 'family';
  const isSelected = !isFamily && isLanguageSelected(node.id);

  const familyData = isFamily ? (node.data as LanguageFamilyWithChildren) : null;
  const langData = !isFamily ? (node.data as LanguageWithVariants) : null;

  const counts = useMemo(() => {
    if (!isFamily || !hasChildren) return null;
    return countDescendants(node);
  }, [node, isFamily, hasChildren]);

  const speakers = familyData?.totalSpeakers ?? langData?.nativeSpeakers;

  // Highlight matching text
  const nameMatchesSearch = searchQuery &&
    node.name.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div>
      <div
        className={`
          flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none
          transition-colors duration-100 rounded-md mx-1
          ${isSelected ? 'bg-blue-100 ring-1 ring-blue-400' : style.hover}
          ${nameMatchesSearch ? 'ring-1 ring-yellow-400 bg-yellow-50' : ''}
        `}
        style={{ paddingLeft: `${level * 20 + 12}px` }}
        onClick={(e) => {
          e.stopPropagation();
          if (isFamily && hasChildren) {
            onToggle(node.id);
          }
          onNodeClick?.(node.id, node.type);
        }}
        role="treeitem"
        aria-expanded={isFamily && hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
      >
        {/* Expand/collapse chevron */}
        {isFamily && hasChildren ? (
          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-400">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        ) : (
          <span className="flex-shrink-0 w-4" />
        )}

        {/* Node indicator dot */}
        <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${isSelected ? 'bg-blue-500' : style.dot}`} />

        {/* Name */}
        <span className={`
          flex-1 truncate text-sm
          ${isFamily ? 'font-semibold text-gray-900' : 'text-gray-700'}
          ${isSelected ? 'text-blue-900 font-medium' : ''}
        `}>
          {node.name}
        </span>

        {/* Metadata badges */}
        <span className="flex items-center gap-2 flex-shrink-0">
          {speakers ? (
            <span className="text-xs text-gray-400 flex items-center gap-0.5" title={`${speakers.toLocaleString()} speakers`}>
              <Users className="h-3 w-3" />
              {formatSpeakers(speakers)}
            </span>
          ) : null}
          {isFamily && counts && (
            <span className="text-xs text-gray-400">
              {counts.languages > 0 && `${counts.languages} lang`}
              {counts.families > 0 && counts.languages > 0 && ' · '}
              {counts.families > 0 && `${counts.families} sub`}
            </span>
          )}
          {langData?.status && langData.status !== 'living' && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              langData.status === 'endangered' ? 'bg-amber-100 text-amber-700' :
              langData.status === 'extinct' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {langData.status}
            </span>
          )}
        </span>
      </div>

      {/* Children */}
      {isFamily && hasChildren && isExpanded && (
        <div role="group">
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              onNodeClick={onNodeClick}
              isLanguageSelected={isLanguageSelected}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LanguageTreeView({ treeData, onNodeClick }: LanguageTreeViewProps) {
  const { isLanguageSelected, state } = useVisualization();
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());

  const searchQuery = state.filters.searchQuery;

  // Auto-expand nodes that match search
  const expandedWithSearch = useMemo(() => {
    if (!searchQuery) return expandedNodes;

    const expanded = new Set(expandedNodes);
    const query = searchQuery.toLowerCase();

    function findAndExpand(nodes: TreeNode[], ancestors: string[]): boolean {
      let found = false;
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(query)) {
          // Expand all ancestors
          for (const id of ancestors) expanded.add(id);
          found = true;
        }
        if (node.children) {
          if (findAndExpand(node.children, [...ancestors, node.id])) {
            found = true;
          }
        }
      }
      return found;
    }

    findAndExpand(treeData, []);
    return expanded;
  }, [searchQuery, treeData, expandedNodes]);

  const handleToggle = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const allIds = new Set<string>();
    function collect(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.type === 'family' && node.children?.length) {
          allIds.add(node.id);
          collect(node.children);
        }
      }
    }
    collect(treeData);
    setExpandedNodes(allIds);
  }, [treeData]);

  const handleCollapseAll = useCallback(() => {
    setExpandedNodes(new Set());
  }, []);

  const totalFamilies = treeData.length;
  const totalLanguages = useMemo(() => {
    let count = 0;
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'language') count++;
        if (n.children) walk(n.children);
      }
    }
    walk(treeData);
    return count;
  }, [treeData]);

  if (treeData.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center p-8">
          <Globe className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No language families match the current filters</p>
          <p className="text-sm text-gray-400 mt-1">Try adjusting the status or region filters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-lg border border-gray-200">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/50 rounded-t-lg">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Languages className="h-3.5 w-3.5" />
            {totalFamilies} families
          </span>
          <span>·</span>
          <span>{totalLanguages} languages</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExpandAll}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          >
            Expand all
          </button>
          <button
            onClick={handleCollapseAll}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto py-1" role="tree" aria-label="Language family tree">
        {treeData.map((node) => (
          <TreeNodeItem
            key={node.id}
            node={node}
            level={0}
            expandedNodes={expandedWithSearch}
            onToggle={handleToggle}
            onNodeClick={onNodeClick}
            isLanguageSelected={isLanguageSelected}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    </div>
  );
}
