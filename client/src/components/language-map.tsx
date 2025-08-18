import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { X, Map as MapIcon, Filter } from "lucide-react";
import type { Language, LanguageFamily } from "@shared/schema";

interface LanguageMapProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MapPoint {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  type: 'language' | 'family';
  speakers?: number;
  status?: string;
  familyName?: string;
}

export default function LanguageMap({ isOpen, onClose }: LanguageMapProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    type: 'all', // all, languages, families
    status: 'all', // all, living, endangered, extinct, historical
    minSpeakers: 0,
  });
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);

  const { data: languages = [] } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
  });

  const { data: families = [] } = useQuery<LanguageFamily[]>({
    queryKey: ['/api/language-families'],
  });

  const mapPoints: MapPoint[] = [
    // Languages with coordinates
    ...languages
      .filter(lang => lang.coordinates && !lang.isHistoricalVariant)
      .map(lang => ({
        id: lang.id,
        name: lang.name,
        coordinates: lang.coordinates!,
        type: 'language' as const,
        speakers: lang.totalSpeakers || 0,
        status: lang.status,
        familyName: families.find(f => f.id === lang.familyId)?.name,
      })),
    // Language families (could add coordinates for family origins)
    ...families
      .filter(family => family.region) // Families with known regions
      .map(family => ({
        id: family.id,
        name: family.name,
        coordinates: getEstimatedCoordinates(family.region!), // Helper function for regions
        type: 'family' as const,
        speakers: family.totalSpeakers || 0,
      })),
  ];

  const filteredPoints = mapPoints.filter(point => {
    if (filters.type !== 'all' && point.type !== filters.type) return false;
    if (filters.status !== 'all' && point.status !== filters.status) return false;
    if (point.speakers! < filters.minSpeakers) return false;
    return true;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-material-3 w-full max-w-7xl max-h-[90vh] m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <MapIcon className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-medium text-gray-900" data-testid="text-map-title">
              Interactive Language Map
            </h2>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="text-gray-600"
              data-testid="button-toggle-filters"
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              data-testid="button-close-map"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="flex h-[70vh]">
          {/* Filters Panel */}
          {showFilters && (
            <div className="w-80 border-r border-gray-200 p-4 overflow-y-auto bg-gray-50">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Map Filters</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Show
                  </label>
                  <select
                    value={filters.type}
                    onChange={(e) => setFilters({...filters, type: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="all">All</option>
                    <option value="languages">Languages Only</option>
                    <option value="families">Families Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Status
                  </label>
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters({...filters, status: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="all">All Status</option>
                    <option value="living">Living</option>
                    <option value="endangered">Endangered</option>
                    <option value="extinct">Extinct</option>
                    <option value="historical">Historical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Minimum Speakers
                  </label>
                  <input
                    type="number"
                    value={filters.minSpeakers}
                    onChange={(e) => setFilters({...filters, minSpeakers: parseInt(e.target.value) || 0})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="0"
                  />
                </div>

                <div className="pt-4">
                  <p className="text-sm text-gray-600">
                    Showing {filteredPoints.length} of {mapPoints.length} items
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Map Container */}
          <div className="flex-1 relative">
            {/* Simple placeholder map - in a real implementation, this would be a proper map component */}
            <div className="w-full h-full bg-gradient-to-b from-blue-100 to-green-100 relative overflow-hidden">
              <div className="absolute inset-0 opacity-20 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMSIgZmlsbD0iIzMzMzMzMyIvPgo8L3N2Zz4K')] opacity-10"></div>
              
              {/* Language/Family Points */}
              {filteredPoints.map((point, index) => {
                // Convert lat/lng to screen coordinates (simplified)
                const x = ((point.coordinates.lng + 180) / 360) * 100;
                const y = ((90 - point.coordinates.lat) / 180) * 100;
                
                return (
                  <div
                    key={point.id}
                    className={`absolute cursor-pointer transform -translate-x-1/2 -translate-y-1/2 ${
                      point.type === 'language' ? 'z-20' : 'z-10'
                    }`}
                    style={{ left: `${x}%`, top: `${y}%` }}
                    onClick={() => setSelectedPoint(point)}
                    data-testid={`map-point-${point.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${
                        point.type === 'language'
                          ? point.status === 'living'
                            ? 'bg-green-500'
                            : point.status === 'endangered'
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                          : 'bg-blue-500'
                      } hover:scale-150 transition-transform`}
                    />
                    {/* Speaker count indicator for languages */}
                    {point.type === 'language' && point.speakers! > 1000000 && (
                      <div className="absolute -top-1 -right-1 w-2 h-2 bg-orange-400 rounded-full border border-white"></div>
                    )}
                  </div>
                );
              })}

              {/* Legend */}
              <div className="absolute bottom-4 left-4 bg-white bg-opacity-90 p-3 rounded-lg shadow-sm">
                <h4 className="text-sm font-medium text-gray-900 mb-2">Legend</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span>Living Language</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                    <span>Endangered</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <span>Extinct/Historical</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span>Language Family</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
                    <span>1M+ speakers</span>
                  </div>
                </div>
              </div>

              {/* Selected Point Info */}
              {selectedPoint && (
                <Card className="absolute top-4 right-4 max-w-sm p-4 bg-white shadow-lg">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium text-gray-900">{selectedPoint.name}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPoint(null)}
                      className="h-6 w-6 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center space-x-2">
                      <Badge className={`${
                        selectedPoint.type === 'language'
                          ? selectedPoint.status === 'living'
                            ? 'bg-green-100 text-green-800'
                            : selectedPoint.status === 'endangered'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {selectedPoint.type === 'language' ? selectedPoint.status : selectedPoint.type}
                      </Badge>
                    </div>
                    
                    {selectedPoint.speakers && selectedPoint.speakers > 0 && (
                      <p className="text-gray-600">
                        <span className="font-medium">Speakers:</span> {selectedPoint.speakers.toLocaleString()}
                      </p>
                    )}
                    
                    {selectedPoint.familyName && (
                      <p className="text-gray-600">
                        <span className="font-medium">Family:</span> {selectedPoint.familyName}
                      </p>
                    )}
                    
                    <p className="text-gray-500 text-xs">
                      {selectedPoint.coordinates.lat.toFixed(2)}°, {selectedPoint.coordinates.lng.toFixed(2)}°
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 text-center text-sm text-gray-600">
          Interactive map showing language families and individual languages with geographic distribution
        </div>
      </div>
    </div>
  );
}

// Helper function to get estimated coordinates for regions
function getEstimatedCoordinates(region: string): { lat: number; lng: number } {
  const regionCoords: Record<string, { lat: number; lng: number }> = {
    'Europe': { lat: 54.5260, lng: 15.2551 },
    'Asia': { lat: 29.8403, lng: 89.2961 },
    'Africa': { lat: -8.7832, lng: 34.5085 },
    'North America': { lat: 54.5260, lng: -105.2551 },
    'South America': { lat: -14.2350, lng: -51.9253 },
    'Oceania': { lat: -25.2744, lng: 133.7751 },
    'Middle East': { lat: 29.2985, lng: 42.5510 },
    'Northern Europe': { lat: 64.0000, lng: 10.0000 },
    'Central Europe': { lat: 48.0000, lng: 17.0000 },
    'Global': { lat: 0, lng: 0 },
  };
  
  return regionCoords[region] || { lat: 0, lng: 0 };
}