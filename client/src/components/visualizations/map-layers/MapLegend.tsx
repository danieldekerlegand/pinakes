import React, { useMemo } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import type { LayerConfig } from '../../../lib/visualization/geospatial-types';

interface MapLegendProps {
  layerConfigs: Map<string, LayerConfig>;
  activeLayers: Set<string>;
  familyColors?: Map<string, string>;
}

export function MapLegend({ layerConfigs, activeLayers, familyColors }: MapLegendProps) {
  const [isOpen, setIsOpen] = React.useState(true);

  // Get only visible layers
  const visibleLayers = useMemo(() => {
    return Array.from(layerConfigs.values()).filter((layer) => activeLayers.has(layer.id));
  }, [layerConfigs, activeLayers]);

  if (visibleLayers.length === 0) {
    return null;
  }

  if (!isOpen) {
    return (
      <div className="absolute bottom-20 right-4 z-[1000]">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="bg-white shadow-lg"
        >
          <Info className="h-4 w-4 mr-2" />
          Legend
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-20 right-4 z-[1000] w-64">
      <Card className="bg-white shadow-lg">
        <div className="p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              <h4 className="font-semibold text-sm">Legend</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-6 w-6 p-0"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>

          {/* Legend Items */}
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {visibleLayers.map((layer) => (
              <div key={layer.id} className="space-y-1">
                <div className="text-xs font-medium text-gray-700">{layer.name}</div>

                {/* Language Ranges */}
                {layer.type === 'language-ranges' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 rounded border-2 border-white" style={{ backgroundColor: '#60a5fa', opacity: 0.5 }} />
                      <span className="text-xs text-gray-600">Language Territory</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-6">Color by family</div>
                  </div>
                )}

                {/* Archaeological Sites */}
                {layer.type === 'archaeological-sites' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-amber-500" />
                      <span className="text-xs text-gray-600">Settlement</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-purple-500" />
                      <span className="text-xs text-gray-600">Temple/Ceremonial</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <span className="text-xs text-gray-600">Burial Site</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Size by importance</div>
                  </div>
                )}

                {/* Civilizations */}
                {layer.type === 'civilizations' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 rounded border-2 border-purple-600" style={{ backgroundColor: '#c084fc', opacity: 0.3 }} />
                      <span className="text-xs text-gray-600">Civilization Boundary</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-6">Hatched pattern</div>
                  </div>
                )}

                {/* Historical Routes */}
                {layer.type === 'routes' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <svg width="16" height="12" className="flex-shrink-0">
                        <line x1="0" y1="6" x2="16" y2="6" stroke="#22c55e" strokeWidth="2" />
                        <polygon points="13,3 16,6 13,9" fill="#22c55e" />
                      </svg>
                      <span className="text-xs text-gray-600">Trade Route</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="12" className="flex-shrink-0">
                        <line x1="0" y1="6" x2="16" y2="6" stroke="#3b82f6" strokeWidth="2" strokeDasharray="2,2" />
                        <polygon points="13,3 16,6 13,9" fill="#3b82f6" />
                      </svg>
                      <span className="text-xs text-gray-600">Migration Route</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="12" className="flex-shrink-0">
                        <line x1="0" y1="6" x2="16" y2="6" stroke="#ef4444" strokeWidth="2" />
                        <polygon points="13,3 16,6 13,9" fill="#ef4444" />
                      </svg>
                      <span className="text-xs text-gray-600">Conquest Route</span>
                    </div>
                  </div>
                )}

                {/* Battles */}
                {layer.type === 'battles' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-600" />
                      <span className="text-xs text-gray-600">Battle Site</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-yellow-400 bg-yellow-200" style={{ opacity: 0.7 }} />
                      <span className="text-xs text-gray-600">Active (flash)</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Visible within 50yr window</div>
                  </div>
                )}

                {/* Material Culture Heatmap */}
                {layer.type === 'material-culture-heatmap' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3 rounded" style={{
                        background: 'linear-gradient(to right, blue, lime, red)'
                      }} />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Low</span>
                      <span>High</span>
                    </div>
                    <div className="text-xs text-gray-500">Artifact density</div>
                  </div>
                )}

                {/* Material Culture */}
                {layer.type === 'material-culture' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 rounded border border-red-400" style={{ backgroundColor: '#fca5a5', opacity: 0.4 }} />
                      <span className="text-xs text-gray-600">Culture Region</span>
                    </div>
                  </div>
                )}

                {/* Cuisines */}
                {layer.type === 'cuisines' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <span className="text-xs text-gray-600">East Asian</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-orange-500" />
                      <span className="text-xs text-gray-600">South Asian</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                      <span className="text-xs text-gray-600">European</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Color by region</div>
                  </div>
                )}

                {/* Music */}
                {layer.type === 'music' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-fuchsia-500" />
                      <span className="text-xs text-gray-600">Music Tradition</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Color by tradition type</div>
                  </div>
                )}

                {/* Religions */}
                {layer.type === 'religions' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-indigo-500" />
                      <span className="text-xs text-gray-600">Religion Origin</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Color by religion</div>
                  </div>
                )}

                {/* Haplogroups */}
                {layer.type === 'haplogroups' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <span className="text-xs text-gray-600">Haplogroup Region</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Color by haplogroup type</div>
                  </div>
                )}

                {/* Language Contacts */}
                {layer.type === 'language-contacts' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <svg width="16" height="12" className="flex-shrink-0">
                        <line x1="0" y1="6" x2="16" y2="6" stroke="#ef4444" strokeWidth="2" />
                      </svg>
                      <span className="text-xs text-gray-600">Superstrate</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="12" className="flex-shrink-0">
                        <line x1="0" y1="6" x2="16" y2="6" stroke="#3b82f6" strokeWidth="2" />
                      </svg>
                      <span className="text-xs text-gray-600">Adstrate</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="12" className="flex-shrink-0">
                        <line x1="0" y1="6" x2="16" y2="6" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4,2" />
                      </svg>
                      <span className="text-xs text-gray-600">Substrate</span>
                    </div>
                    <div className="text-xs text-gray-500 ml-5">Thickness = intensity</div>
                  </div>
                )}
              </div>
            ))}

            {/* General Info */}
            <div className="pt-2 border-t text-xs text-gray-500">
              <div>Click features to select</div>
              <div>Hover for details</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
