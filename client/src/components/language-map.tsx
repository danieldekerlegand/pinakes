import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { 
  MapPin, 
  Users, 
  Globe, 
  Layers, 
  ZoomIn, 
  ZoomOut,
  Filter,
  Info,
  TreePine,
  Network
} from "lucide-react";

interface LanguageMapProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Language {
  id: string;
  name: string;
  nativeName?: string;
  familyId?: string;
  familyName?: string;
  coordinates?: [number, number];
  speakerCount?: number;
  region?: string;
  status?: string;
  iso639_1?: string;
  iso639_2?: string;
}

interface LanguageFamily {
  id: string;
  name: string;
  parentId?: string;
  coordinates?: [number, number];
  languages: Language[];
  color?: string;
}

export default function LanguageMap({ isOpen, onClose }: LanguageMapProps) {
  const [selectedFamily, setSelectedFamily] = useState<string>('all');
  const [showConnections, setShowConnections] = useState(true);
  const [showFamilyNames, setShowFamilyNames] = useState(true);
  const [zoomLevel, setZoomLevel] = useState([1]);
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Fetch languages with coordinates
  const { data: languagesData = [] } = useQuery({
    queryKey: ['/api/languages'],
  });

  // Transform language data to include coordinates
  const languages: Language[] = languagesData.map((lang: any) => ({
    ...lang,
    familyName: lang.familyId ? 'Indo-European' : 'Unknown', // Simplified for demo
    coordinates: getLanguageCoordinates(lang.name), // Helper function
  })).filter(lang => lang.coordinates);

  // Fetch language families
  const { data: families = [] } = useQuery({
    queryKey: ['/api/language-families'],
  });

  // Helper function to get approximate coordinates for languages
  function getLanguageCoordinates(languageName: string): [number, number] | undefined {
    const coords: Record<string, [number, number]> = {
      'English': [-2, 54], // UK
      'American English': [-95, 40], // USA
      'British English': [-2, 54], // UK
      'Australian English': [133, -27], // Australia
      'German': [10, 51], // Germany
      'Dutch': [5, 52], // Netherlands
      'Swedish': [15, 60], // Sweden
      'Norwegian': [8, 60], // Norway
      'Danish': [10, 56], // Denmark
      'Icelandic': [-19, 64], // Iceland
      'French': [2, 46], // France
      'Italian': [12, 42], // Italy
      'Spanish': [-4, 40], // Spain
      'Portuguese': [-8, 40], // Portugal
      'Old English': [-2, 54], // Historical UK
      'Middle English': [-2, 54], // Historical UK
      'Early Modern English': [-2, 54], // Historical UK
      'Gothic': [25, 45], // Historical Eastern Europe
    };
    return coords[languageName];
  }

  // Family color mapping
  const familyColors = new Map([
    ['Indo-European', '#3B82F6'], // Blue
    ['West Germanic', '#10B981'], // Green
    ['North Germanic', '#F59E0B'], // Amber
    ['East Germanic', '#EF4444'], // Red
    ['Germanic', '#8B5CF6'], // Purple
    ['Romance', '#EC4899'], // Pink
    ['Slavic', '#06B6D4'], // Cyan
  ]);

  const getFamilyColor = (familyName: string): string => {
    return familyColors.get(familyName) || '#6B7280'; // Default gray
  };

  // Filter languages based on selected family
  const filteredLanguages = selectedFamily === 'all' 
    ? languages 
    : languages.filter(lang => lang.familyName === selectedFamily);

  // Generate language connections based on family relationships
  const generateConnections = (): Array<{ from: Language; to: Language; family: string }> => {
    const connections: Array<{ from: Language; to: Language; family: string }> = [];
    
    // Group languages by family
    const languagesByFamily = new Map<string, Language[]>();
    filteredLanguages.forEach(lang => {
      const family = lang.familyName || 'Unknown';
      if (!languagesByFamily.has(family)) {
        languagesByFamily.set(family, []);
      }
      languagesByFamily.get(family)!.push(lang);
    });

    // Create connections within each family
    languagesByFamily.forEach((langs, family) => {
      if (langs.length > 1) {
        // Connect each language to the next one in the family
        for (let i = 0; i < langs.length - 1; i++) {
          connections.push({
            from: langs[i],
            to: langs[i + 1],
            family
          });
        }
      }
    });

    return connections;
  };

  const connections = showConnections ? generateConnections() : [];

  // Convert geographic coordinates to SVG coordinates
  const projectCoordinates = (coords: [number, number], width: number, height: number): [number, number] => {
    const [lon, lat] = coords;
    // Simple equirectangular projection
    const x = ((lon + 180) / 360) * width;
    const y = ((90 - lat) / 180) * height;
    return [x * zoomLevel[0], y * zoomLevel[0]];
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Interactive Linguistic Map
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 h-[80vh]">
          {/* Map Controls Sidebar */}
          <div className="w-80 space-y-4 overflow-y-auto">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Map Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Family Filter */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Language Family</label>
                  <Select value={selectedFamily} onValueChange={setSelectedFamily}>
                    <SelectTrigger data-testid="select-family-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Families</SelectItem>
                      <SelectItem value="Indo-European">Indo-European</SelectItem>
                      <SelectItem value="West Germanic">West Germanic</SelectItem>
                      <SelectItem value="North Germanic">North Germanic</SelectItem>
                      <SelectItem value="East Germanic">East Germanic</SelectItem>
                      <SelectItem value="Romance">Romance</SelectItem>
                      <SelectItem value="Slavic">Slavic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Display Options */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Show Connections</label>
                    <Switch 
                      checked={showConnections} 
                      onCheckedChange={setShowConnections}
                      data-testid="switch-connections"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Show Language Names</label>
                    <Switch 
                      checked={showFamilyNames} 
                      onCheckedChange={setShowFamilyNames}
                      data-testid="switch-names"
                    />
                  </div>
                </div>

                {/* Zoom Control */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Zoom Level: {zoomLevel[0].toFixed(1)}x
                  </label>
                  <Slider
                    value={zoomLevel}
                    onValueChange={setZoomLevel}
                    min={0.5}
                    max={3}
                    step={0.1}
                    className="w-full"
                    data-testid="slider-zoom"
                  />
                </div>

                {/* Statistics */}
                <div className="pt-2 border-t">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Languages:</span>
                      <span className="font-medium">{filteredLanguages.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Families:</span>
                      <span className="font-medium">
                        {new Set(filteredLanguages.map(l => l.familyName)).size}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Connections:</span>
                      <span className="font-medium">{connections.length}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Language Details */}
            {selectedLanguage && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Language Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h3 className="font-semibold text-lg">{selectedLanguage.name}</h3>
                    {selectedLanguage.nativeName && (
                      <p className="text-sm text-muted-foreground">{selectedLanguage.nativeName}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Family:</span>
                      <Badge 
                        style={{ backgroundColor: getFamilyColor(selectedLanguage.familyName || '') }}
                        className="text-white"
                      >
                        {selectedLanguage.familyName || 'Unknown'}
                      </Badge>
                    </div>
                    
                    {selectedLanguage.speakerCount && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Speakers:</span>
                        <span className="font-medium">
                          {selectedLanguage.speakerCount.toLocaleString()}
                        </span>
                      </div>
                    )}
                    
                    {selectedLanguage.region && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Region:</span>
                        <span className="font-medium">{selectedLanguage.region}</span>
                      </div>
                    )}
                    
                    {selectedLanguage.iso639_1 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ISO Code:</span>
                        <span className="font-mono font-medium">{selectedLanguage.iso639_1}</span>
                      </div>
                    )}

                    {selectedLanguage.coordinates && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Coordinates:</span>
                        <span className="font-mono text-xs">
                          {selectedLanguage.coordinates[1].toFixed(2)}, {selectedLanguage.coordinates[0].toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Family Legend */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Family Legend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Array.from(new Set(filteredLanguages.map(l => l.familyName))).map(family => (
                    <div key={family} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getFamilyColor(family || '') }}
                      />
                      <span className="text-sm">{family || 'Unknown'}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Interactive Map */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-slate-50">
            <svg
              ref={svgRef}
              className="w-full h-full cursor-pointer"
              viewBox={`0 0 ${800 * zoomLevel[0]} ${400 * zoomLevel[0]}`}
              style={{ backgroundColor: '#f8fafc' }}
              data-testid="linguistic-map-svg"
            >
              {/* World outline (simplified) */}
              <defs>
                <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e2e8f0" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              
              {/* Continent outlines */}
              <g opacity="0.3">
                {/* Europe */}
                <rect x={320 * zoomLevel[0]} y={80 * zoomLevel[0]} width={150 * zoomLevel[0]} height={80 * zoomLevel[0]} 
                      fill="none" stroke="#cbd5e1" strokeWidth="2" rx="8" />
                <text x={395 * zoomLevel[0]} y={125 * zoomLevel[0]} textAnchor="middle" 
                      className="text-xs fill-gray-400" fontSize={12 * zoomLevel[0]}>Europe</text>
                
                {/* North America */}
                <rect x={100 * zoomLevel[0]} y={60 * zoomLevel[0]} width={180 * zoomLevel[0]} height={120 * zoomLevel[0]} 
                      fill="none" stroke="#cbd5e1" strokeWidth="2" rx="8" />
                <text x={190 * zoomLevel[0]} y={125 * zoomLevel[0]} textAnchor="middle" 
                      className="text-xs fill-gray-400" fontSize={12 * zoomLevel[0]}>North America</text>
                
                {/* Asia */}
                <rect x={480 * zoomLevel[0]} y={70 * zoomLevel[0]} width={200 * zoomLevel[0]} height={140 * zoomLevel[0]} 
                      fill="none" stroke="#cbd5e1" strokeWidth="2" rx="8" />
                <text x={580 * zoomLevel[0]} y={145 * zoomLevel[0]} textAnchor="middle" 
                      className="text-xs fill-gray-400" fontSize={12 * zoomLevel[0]}>Asia</text>
              </g>

              {/* Family Connections */}
              {connections.map((connection, index) => {
                const [fromX, fromY] = projectCoordinates(connection.from.coordinates!, 800, 400);
                const [toX, toY] = projectCoordinates(connection.to.coordinates!, 800, 400);
                
                return (
                  <line
                    key={`connection-${index}`}
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                    stroke={getFamilyColor(connection.family)}
                    strokeWidth={2 * zoomLevel[0]}
                    opacity="0.5"
                    strokeDasharray="5,5"
                    data-testid={`connection-${index}`}
                  />
                );
              })}

              {/* Language Points */}
              {filteredLanguages.map((language) => {
                if (!language.coordinates) return null;
                
                const [x, y] = projectCoordinates(language.coordinates, 800, 400);
                const isSelected = selectedLanguage?.id === language.id;
                const radius = isSelected ? 8 * zoomLevel[0] : 6 * zoomLevel[0];
                
                return (
                  <g key={language.id}>
                    <circle
                      cx={x}
                      cy={y}
                      r={radius}
                      fill={getFamilyColor(language.familyName || '')}
                      stroke={isSelected ? '#1f2937' : 'white'}
                      strokeWidth={isSelected ? 3 * zoomLevel[0] : 2 * zoomLevel[0]}
                      className="cursor-pointer hover:stroke-gray-800 transition-all"
                      onClick={() => setSelectedLanguage(language)}
                      data-testid={`language-point-${language.id}`}
                    />
                    
                    {(showFamilyNames || isSelected) && (
                      <text
                        x={x}
                        y={y - (radius + 5 * zoomLevel[0])}
                        textAnchor="middle"
                        className="text-xs font-medium pointer-events-none"
                        fill="#374151"
                        fontSize={11 * zoomLevel[0]}
                        data-testid={`language-label-${language.id}`}
                      >
                        {language.name}
                      </text>
                    )}
                    
                    {/* Speaker count indicator */}
                    {language.speakerCount && language.speakerCount > 1000000 && (
                      <circle
                        cx={x + radius - 2}
                        cy={y - radius + 2}
                        r={3 * zoomLevel[0]}
                        fill="#f59e0b"
                        stroke="white"
                        strokeWidth={1}
                        className="pointer-events-none"
                      />
                    )}
                  </g>
                );
              })}

              {/* Family name labels for major groups */}
              {showFamilyNames && selectedFamily === 'all' && (
                <g className="text-sm font-semibold">
                  <text x={395 * zoomLevel[0]} y={50 * zoomLevel[0]} textAnchor="middle" 
                        fill={getFamilyColor('Indo-European')} fontSize={16 * zoomLevel[0]}>
                    Indo-European
                  </text>
                  <text x={395 * zoomLevel[0]} y={200 * zoomLevel[0]} textAnchor="middle" 
                        fill={getFamilyColor('West Germanic')} fontSize={14 * zoomLevel[0]}>
                    Germanic Branch
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}