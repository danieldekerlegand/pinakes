/**
 * The `POST /api/map/analyze-image` response shape.
 *
 * The client mirrors the wire contract here rather than importing it from the
 * handler: the handler is Python now
 * (`services/api/src/pinakes/media/map_image.py`), and until the cutover
 * (tasks/chief/80-cutover.json US-2) these declarations lived in
 * `server/services/map-image-analyzer.ts` and were imported across the
 * client/server boundary by `useMapFeatureExtraction` and the review utils.
 *
 * Same posture as `web/src/lib/graph/neighborhood-graph.ts` and
 * `web/src/lib/annotations.ts`: the shapes are stated on the client side and the
 * server is the authority. Keep them in step with `map_image.py`'s cleaner —
 * every `confidence` here can arrive as `null` when the model returned a
 * non-numeric one (`Math.min(1, NaN)` is `NaN`, which serialises as `null`).
 */

export interface ExtractedSettlement {
  name: string;
  lat: number;
  lng: number;
  type: "city" | "town" | "village" | "fort" | "port" | "religious" | "unknown";
  confidence: number;
}

export interface ExtractedBoundary {
  name: string;
  coordinates: [number, number][];
  type: "empire" | "kingdom" | "region" | "territory" | "unknown";
  confidence: number;
}

export interface ExtractedRoute {
  name: string;
  waypoints: [number, number][];
  type: "trade" | "migration" | "military" | "pilgrimage" | "unknown";
  confidence: number;
}

export interface ExtractedLabel {
  text: string;
  lat: number;
  lng: number;
  category: "place" | "region" | "water" | "mountain" | "legend" | "unknown";
  confidence: number;
}

export interface MapFeatureExtractionResult {
  settlements: ExtractedSettlement[];
  boundaries: ExtractedBoundary[];
  routes: ExtractedRoute[];
  labels: ExtractedLabel[];
  mapDescription: string;
  estimatedTimePeriod: string;
  estimatedRegion: string;
}
