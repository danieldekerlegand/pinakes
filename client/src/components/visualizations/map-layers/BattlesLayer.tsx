import React, { useEffect, useState, useRef } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';

export interface BattleFeature {
  id: string;
  name: string;
  date: string;
  coordinates: [number, number]; // [lat, lng]
  belligerents: Array<{ name: string; civilization_id: string | null }>;
  outcome: string;
  casualtiesEstimate: string;
  significance: string;
  associatedLanguageChanges: string;
  warName: string;
}

interface BattlesLayerProps {
  battles: BattleFeature[];
  currentYear: number;
  opacity?: number;
}

export function BattlesLayer({
  battles,
  currentYear,
  opacity = 0.9,
}: BattlesLayerProps) {
  const [flashingBattles, setFlashingBattles] = useState<Set<string>>(new Set());
  const prevYearRef = useRef(currentYear);

  // Detect when timeline crosses a battle's date and trigger flash
  useEffect(() => {
    const prevYear = prevYearRef.current;
    prevYearRef.current = currentYear;

    const newFlashes = new Set<string>();
    for (const battle of battles) {
      const battleYear = parseInt(battle.date);
      if (isNaN(battleYear)) continue;

      // Battle date is between previous year and current year (crossed during animation)
      const crossed =
        (prevYear <= battleYear && currentYear >= battleYear) ||
        (prevYear >= battleYear && currentYear <= battleYear);

      if (crossed) {
        newFlashes.add(battle.id);
      }
    }

    if (newFlashes.size > 0) {
      setFlashingBattles((prev) => {
        const next = new Set(prev);
        newFlashes.forEach((id) => next.add(id));
        return next;
      });

      // Remove flash after 2 seconds
      const timeout = setTimeout(() => {
        setFlashingBattles((prev) => {
          const next = new Set(prev);
          newFlashes.forEach((id) => next.delete(id));
          return next;
        });
      }, 2000);

      return () => clearTimeout(timeout);
    }
  }, [currentYear, battles]);

  // Filter battles within a window around current year (show recent battles briefly)
  const visibleBattles = battles.filter((b) => {
    const year = parseInt(b.date);
    if (isNaN(year)) return false;
    // Show battles within 50 years of current time
    return Math.abs(year - currentYear) <= 50;
  });

  if (visibleBattles.length === 0) {
    return null;
  }

  const formatYear = (date: string) => {
    const year = parseInt(date);
    if (year < 0) return `${Math.abs(year)} BCE`;
    return `${year} CE`;
  };

  return (
    <>
      {visibleBattles.map((battle) => {
        const [lat, lng] = battle.coordinates;
        const isFlashing = flashingBattles.has(battle.id);
        const battleYear = parseInt(battle.date);
        const yearsAgo = Math.abs(currentYear - battleYear);
        // Fade out over 50 years
        const fadeOpacity = Math.max(0.2, 1 - yearsAgo / 50);

        return (
          <CircleMarker
            key={battle.id}
            center={[lat, lng]}
            radius={isFlashing ? 14 : 8}
            pathOptions={{
              fillColor: isFlashing ? '#fbbf24' : '#ef4444',
              fillOpacity: isFlashing ? 1 : opacity * fadeOpacity,
              color: isFlashing ? '#f59e0b' : '#dc2626',
              weight: isFlashing ? 4 : 2,
            }}
          >
            <Popup>
              <div className="p-2 min-w-[220px]">
                <h3 className="font-bold text-base mb-1">{battle.name}</h3>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Date:</span>
                    <span className="font-medium">{formatYear(battle.date)}</span>
                  </div>
                  {battle.warName && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">War:</span>
                      <span className="font-medium text-right">{battle.warName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Outcome:</span>
                    <span className="font-medium text-right">{battle.outcome}</span>
                  </div>
                  {battle.casualtiesEstimate && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Casualties:</span>
                      <span className="font-medium">{battle.casualtiesEstimate}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t">
                    <span className="text-gray-600 text-xs font-medium">Belligerents:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {battle.belligerents.map((b, idx) => (
                        <span
                          key={idx}
                          className="inline-block px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded"
                        >
                          {b.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  {battle.significance && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Significance:</span>
                      <p className="text-xs mt-1 text-gray-700">{battle.significance}</p>
                    </div>
                  )}
                  {battle.associatedLanguageChanges && (
                    <div className="pt-2 border-t">
                      <span className="text-gray-600 text-xs font-medium">Language Impact:</span>
                      <p className="text-xs mt-1 text-gray-700">{battle.associatedLanguageChanges}</p>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
