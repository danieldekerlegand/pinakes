import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

interface MarkerClusterGroupProps {
  children?: React.ReactNode;
  markers: Array<{
    position: [number, number];
    color?: string;
    radius?: number;
    popupContent?: string;
    onClick?: () => void;
  }>;
  maxClusterRadius?: number;
  disableClusteringAtZoom?: number;
}

export function MarkerClusterGroup({
  markers,
  maxClusterRadius = 50,
  disableClusteringAtZoom = 10,
}: MarkerClusterGroupProps) {
  const map = useMap();
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!map) return;

    // Clean up previous cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
    }

    const clusterGroup = L.markerClusterGroup({
      maxClusterRadius,
      disableClusteringAtZoom,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      chunkedLoading: true,
    });

    const leafletMarkers = markers.map((m) => {
      const marker = L.circleMarker(m.position, {
        radius: m.radius ?? 6,
        fillColor: m.color ?? '#3b82f6',
        fillOpacity: 0.8,
        color: '#ffffff',
        weight: 2,
      });

      if (m.popupContent) {
        marker.bindPopup(m.popupContent);
      }

      if (m.onClick) {
        marker.on('click', m.onClick);
      }

      return marker;
    });

    clusterGroup.addLayers(leafletMarkers);
    map.addLayer(clusterGroup);
    clusterGroupRef.current = clusterGroup;

    return () => {
      if (clusterGroupRef.current) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
      }
    };
  }, [map, markers, maxClusterRadius, disableClusteringAtZoom]);

  return null;
}
