import React from 'react';
import { Map } from 'lucide-react';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import type { BaseMapId, BaseMapTile } from '../../../lib/visualization/geospatial-types';

interface BaseMapSelectorProps {
  currentBaseMapId: BaseMapId;
  availableMaps: BaseMapTile[];
  onSelect: (id: BaseMapId) => void;
}

export function BaseMapSelector({ currentBaseMapId, availableMaps, onSelect }: BaseMapSelectorProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="absolute bottom-4 left-4 z-[1000]">
      {!isOpen ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className="bg-white shadow-lg"
        >
          <Map className="h-4 w-4 mr-2" />
          Base Map
        </Button>
      ) : (
        <Card className="bg-white shadow-lg p-3 w-56">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Map className="h-4 w-4" />
              <h4 className="font-semibold text-sm">Base Map</h4>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="h-6 w-6 p-0">
              ×
            </Button>
          </div>
          <div className="space-y-1">
            {availableMaps.map((tile) => (
              <button
                key={tile.id}
                onClick={() => {
                  onSelect(tile.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                  currentBaseMapId === tile.id
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{tile.name}</div>
                <div className="text-xs text-gray-500">{tile.description}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
