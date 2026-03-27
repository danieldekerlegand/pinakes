import React, { useMemo } from 'react';
import Slider from 'rc-slider';
import { Layers, ChevronDown, ChevronUp, Eye, EyeOff, Bookmark } from 'lucide-react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Card } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import { Badge } from '../../ui/badge';
import type { LayerConfig } from '../../../lib/visualization/geospatial-types';
import { LAYER_PRESETS } from '../../../lib/visualization/geospatial-types';
import { SLIDER_COLORS } from '../../../lib/visualization/color-theme';
import 'rc-slider/assets/index.css';

interface LayerPanelProps {
  layerConfigs: Map<string, LayerConfig>;
  activeLayers: Set<string>;
  onToggleLayer: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onShowCategory: (category: string) => void;
  onHideCategory: (category: string) => void;
  onApplyPreset?: (presetId: string) => void;
  activePresetId?: string | null;
}

export function LayerPanel({
  layerConfigs,
  activeLayers,
  onToggleLayer,
  onOpacityChange,
  onShowAll,
  onHideAll,
  onShowCategory,
  onHideCategory,
  onApplyPreset,
  activePresetId,
}: LayerPanelProps) {
  const [isOpen, setIsOpen] = React.useState(true);
  const [openCategories, setOpenCategories] = React.useState<Set<string>>(
    new Set(['languages']) // Language layers open by default
  );
  const [showPresets, setShowPresets] = React.useState(false);

  // Group layers by category
  const layersByCategory = useMemo(() => {
    const grouped = new Map<string, LayerConfig[]>();

    Array.from(layerConfigs.values()).forEach((config) => {
      const category = config.category;
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(config);
    });

    return grouped;
  }, [layerConfigs]);

  const toggleCategory = (category: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getCategoryIcon = (category: string) => {
    const colors: Record<string, string> = {
      languages: 'bg-blue-500',
      archaeology: 'bg-amber-500',
      civilizations: 'bg-purple-500',
      routes: 'bg-green-500',
      culture: 'bg-red-500',
      cuisines: 'bg-orange-500',
      music: 'bg-fuchsia-500',
      religions: 'bg-indigo-500',
      genetics: 'bg-emerald-500',
    };
    return colors[category] || 'bg-gray-500';
  };

  const formatCategoryName = (category: string): string => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const getCategoryVisibleCount = (category: string): number => {
    const categoryLayers = layersByCategory.get(category) || [];
    return categoryLayers.filter((layer) => activeLayers.has(layer.id)).length;
  };

  if (!isOpen) {
    return (
      <div className="absolute top-4 right-4 z-[1000]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="bg-white shadow-lg"
        >
          <Layers className="h-4 w-4 mr-2" />
          Layers
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute top-4 right-4 z-[1000] w-80">
      <Card className="bg-white shadow-lg">
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              <h3 className="font-semibold">Map Layers</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          </div>

          {/* Presets */}
          {onApplyPreset && (
            <div className="mb-3">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between text-xs h-7"
                onClick={() => setShowPresets(!showPresets)}
              >
                <div className="flex items-center gap-1">
                  <Bookmark className="h-3 w-3" />
                  <span>Presets</span>
                  {activePresetId && (
                    <Badge variant="secondary" className="text-xs h-4 px-1">
                      {LAYER_PRESETS.find((p) => p.id === activePresetId)?.name}
                    </Badge>
                  )}
                </div>
                {showPresets ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>

              {showPresets && (
                <div className="mt-1 space-y-1">
                  {LAYER_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      variant={activePresetId === preset.id ? 'default' : 'outline'}
                      size="sm"
                      className="w-full justify-start text-xs h-7"
                      onClick={() => onApplyPreset(preset.id)}
                    >
                      {preset.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Show All / Hide All */}
          <div className="flex gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onShowAll}
            >
              <Eye className="h-4 w-4 mr-1" />
              Show All
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onHideAll}
            >
              <EyeOff className="h-4 w-4 mr-1" />
              Hide All
            </Button>
          </div>

          {/* Layer Categories */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {Array.from(layersByCategory.entries()).map(([category, layers]) => {
              const isExpanded = openCategories.has(category);
              const visibleCount = getCategoryVisibleCount(category);

              return (
                <Collapsible
                  key={category}
                  open={isExpanded}
                  onOpenChange={() => toggleCategory(category)}
                >
                  <div className="border rounded-lg">
                    {/* Category Header */}
                    <CollapsibleTrigger className="w-full p-2 hover:bg-gray-50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded ${getCategoryIcon(category)}`} />
                        <span className="font-medium text-sm">{formatCategoryName(category)}</span>
                        <Badge variant="outline" className="text-xs">
                          {visibleCount}/{layers.length}
                        </Badge>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </CollapsibleTrigger>

                    {/* Category Controls */}
                    <CollapsibleContent>
                      <div className="p-2 border-t bg-gray-50">
                        <div className="flex gap-1 mb-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            onClick={() => onShowCategory(category)}
                          >
                            Show All
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            onClick={() => onHideCategory(category)}
                          >
                            Hide All
                          </Button>
                        </div>

                        {/* Individual Layers */}
                        <div className="space-y-2">
                          {layers.map((layer) => {
                            const isVisible = activeLayers.has(layer.id);

                            return (
                              <div key={layer.id} className="bg-white rounded p-2 space-y-2">
                                {/* Layer Name & Checkbox */}
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    checked={isVisible}
                                    onCheckedChange={() => onToggleLayer(layer.id)}
                                    id={`layer-${layer.id}`}
                                  />
                                  <label
                                    htmlFor={`layer-${layer.id}`}
                                    className="text-sm flex-1 cursor-pointer"
                                  >
                                    {layer.name}
                                  </label>
                                </div>

                                {/* Opacity Slider */}
                                {isVisible && (
                                  <div className="pl-6 pr-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-gray-600 w-16">Opacity:</span>
                                      <Slider
                                        min={0}
                                        max={100}
                                        value={Math.round(layer.opacity * 100)}
                                        onChange={(value) => {
                                          if (typeof value === 'number') {
                                            onOpacityChange(layer.id, value / 100);
                                          }
                                        }}
                                        trackStyle={{ backgroundColor: SLIDER_COLORS.track, height: 4 }}
                                        railStyle={{ backgroundColor: SLIDER_COLORS.rail, height: 4 }}
                                        handleStyle={{
                                          borderColor: SLIDER_COLORS.track,
                                          height: 14,
                                          width: 14,
                                          marginTop: -5,
                                          backgroundColor: '#fff',
                                        }}
                                      />
                                      <span className="text-xs text-gray-600 w-10 text-right">
                                        {Math.round(layer.opacity * 100)}%
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
