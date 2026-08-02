import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { VisualizationProps } from "@/lib/visualization/adapters/types";

export default function GenericMap({ projections, onSelect }: VisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      worldCopyJump: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const items = projections.spatial ?? [];
    if (items.length === 0) return;

    const bounds = L.latLngBounds([]);
    const maxMag = items.reduce((m, i) => Math.max(m, i.magnitude ?? 1), 1);
    const coordsById = new Map<string, [number, number]>();

    // Draw relational overlay first (under markers) when both dimensions are present
    const relational = projections.relational;
    if (relational && relational.links.length > 0) {
      // Build coord lookup ahead of marker pass
      for (const item of items) coordsById.set(item.id, [item.lat, item.lng]);
      const maxWeight = relational.links.reduce((m, l) => Math.max(m, l.weight ?? 1), 1);
      for (const link of relational.links) {
        const a = coordsById.get(link.source);
        const b = coordsById.get(link.target);
        if (!a || !b) continue;
        const polyline = L.polyline([a, b], {
          color: "#f59e0b",
          weight: 1 + ((link.weight ?? 1) / maxWeight) * 2,
          opacity: 0.45,
        });
        polyline.addTo(layer);
      }
    }

    for (const item of items) {
      const radius = 4 + ((item.magnitude ?? 1) / maxMag) * 10;
      const marker = L.circleMarker([item.lat, item.lng], {
        radius,
        color: "#2563eb",
        weight: 1.5,
        fillColor: "#3b82f6",
        fillOpacity: 0.6,
      });
      marker.bindTooltip(item.label, { direction: "top", offset: [0, -4] });
      marker.on("click", () => onSelect?.(item.id, item.payload));
      marker.addTo(layer);
      bounds.extend([item.lat, item.lng]);
    }

    if (bounds.isValid()) {
      mapRef.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
    }
  }, [projections.spatial, projections.relational, onSelect]);

  if ((projections.spatial ?? []).length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        This dataset has no spatial data to render.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
