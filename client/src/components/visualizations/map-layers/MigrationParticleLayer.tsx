import React from 'react';
import { CircleMarker } from 'react-leaflet';
import type { MigrationParticle } from '../../../lib/visualization/temporal-boundary-morphing';

interface MigrationParticleLayerProps {
  /** Map of routeId -> particles */
  particles: Map<string, MigrationParticle[]>;
  opacity?: number;
}

export function MigrationParticleLayer({
  particles,
  opacity = 0.8,
}: MigrationParticleLayerProps) {
  const allParticles: MigrationParticle[] = [];
  for (const [, routeParticles] of particles) {
    allParticles.push(...routeParticles);
  }

  if (allParticles.length === 0) return null;

  return (
    <>
      {allParticles.map((particle, index) => (
        <CircleMarker
          key={`${particle.id}-${index}`}
          center={[particle.position[1], particle.position[0]]} // [lat, lng]
          radius={particle.size}
          pathOptions={{
            fillColor: particle.color,
            fillOpacity: opacity * (0.5 + 0.5 * Math.sin(particle.routeProgress * Math.PI)),
            color: particle.color,
            weight: 1,
            opacity: opacity * 0.6,
          }}
        />
      ))}
    </>
  );
}
