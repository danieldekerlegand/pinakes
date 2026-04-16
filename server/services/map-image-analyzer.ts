import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";

// ============================================================================
// Types
// ============================================================================

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

export interface FeatureExtractionRequest {
  imageBase64: string;
  mimeType: string;
  bounds: [[number, number], [number, number]];
  featureTypes?: ("settlements" | "boundaries" | "routes" | "labels")[];
}

// ============================================================================
// Gemini Vision API Integration
// ============================================================================

function buildExtractionPrompt(
  bounds: [[number, number], [number, number]],
  featureTypes: string[]
): string {
  const [[south, west], [north, east]] = bounds;
  return `You are analyzing a historical map image that has been georeferenced to the following geographic bounds:
- South-West corner: ${south.toFixed(4)}°N, ${west.toFixed(4)}°E
- North-East corner: ${north.toFixed(4)}°N, ${east.toFixed(4)}°E

Extract geographic features from this map image. All coordinates you return must be within or near these bounds. Convert pixel positions to approximate lat/lng coordinates based on the map's geographic extent.

Extract the following feature types: ${featureTypes.join(", ")}

For each feature, assign a confidence score (0.0 to 1.0) indicating how certain you are about the identification.

Guidelines:
- For settlements: identify cities, towns, villages, forts, ports, and religious sites marked on the map. Use symbols, dots, or text labels as indicators.
- For boundaries: trace political or territorial boundaries shown as lines or color-coded regions. Return polygon coordinates as ordered points tracing the boundary.
- For routes: identify trade routes, roads, rivers used as routes, or migration paths shown as lines. Return ordered waypoints along the route.
- For labels: extract any text visible on the map including place names, region names, water body names, and legend text.
- Estimate the map's time period and geographic region from visual cues (cartographic style, place names, political boundaries).

Return valid JSON matching the schema. If no features of a type are found, return an empty array for that type.`;
}

const EXTRACTION_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    settlements: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          lat: { type: SchemaType.NUMBER },
          lng: { type: SchemaType.NUMBER },
          type: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ["name", "lat", "lng", "type", "confidence"],
      },
    },
    boundaries: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          coordinates: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
            },
          },
          type: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ["name", "coordinates", "type", "confidence"],
      },
    },
    routes: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          waypoints: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
            },
          },
          type: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ["name", "waypoints", "type", "confidence"],
      },
    },
    labels: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          text: { type: SchemaType.STRING },
          lat: { type: SchemaType.NUMBER },
          lng: { type: SchemaType.NUMBER },
          category: { type: SchemaType.STRING },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ["text", "lat", "lng", "category", "confidence"],
      },
    },
    mapDescription: { type: SchemaType.STRING },
    estimatedTimePeriod: { type: SchemaType.STRING },
    estimatedRegion: { type: SchemaType.STRING },
  },
  required: [
    "settlements",
    "boundaries",
    "routes",
    "labels",
    "mapDescription",
    "estimatedTimePeriod",
    "estimatedRegion",
  ],
};

function clampCoordinate(
  lat: number,
  lng: number,
  bounds: [[number, number], [number, number]]
): [number, number] {
  const [[south, west], [north, east]] = bounds;
  const margin = Math.max((north - south) * 0.1, (east - west) * 0.1);
  return [
    Math.max(south - margin, Math.min(north + margin, lat)),
    Math.max(west - margin, Math.min(east + margin, lng)),
  ];
}

function validateAndCleanResult(
  raw: MapFeatureExtractionResult,
  bounds: [[number, number], [number, number]]
): MapFeatureExtractionResult {
  const result = { ...raw };

  result.settlements = (raw.settlements || []).map((s) => {
    const [lat, lng] = clampCoordinate(s.lat, s.lng, bounds);
    return {
      ...s,
      lat,
      lng,
      confidence: Math.max(0, Math.min(1, s.confidence)),
      type: (["city", "town", "village", "fort", "port", "religious"].includes(s.type)
        ? s.type
        : "unknown") as ExtractedSettlement["type"],
    };
  });

  result.boundaries = (raw.boundaries || []).map((b) => ({
    ...b,
    coordinates: (b.coordinates || []).map(
      (coord) => clampCoordinate(coord[0], coord[1], bounds) as [number, number]
    ),
    confidence: Math.max(0, Math.min(1, b.confidence)),
    type: (["empire", "kingdom", "region", "territory"].includes(b.type)
      ? b.type
      : "unknown") as ExtractedBoundary["type"],
  }));

  result.routes = (raw.routes || []).map((r) => ({
    ...r,
    waypoints: (r.waypoints || []).map(
      (wp) => clampCoordinate(wp[0], wp[1], bounds) as [number, number]
    ),
    confidence: Math.max(0, Math.min(1, r.confidence)),
    type: (["trade", "migration", "military", "pilgrimage"].includes(r.type)
      ? r.type
      : "unknown") as ExtractedRoute["type"],
  }));

  result.labels = (raw.labels || []).map((l) => {
    const [lat, lng] = clampCoordinate(l.lat, l.lng, bounds);
    return {
      ...l,
      lat,
      lng,
      confidence: Math.max(0, Math.min(1, l.confidence)),
      category: (["place", "region", "water", "mountain", "legend"].includes(l.category)
        ? l.category
        : "unknown") as ExtractedLabel["category"],
    };
  });

  return result;
}

export async function analyzeMapImage(
  request: FeatureExtractionRequest
): Promise<MapFeatureExtractionResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required for map image analysis");
  }

  const featureTypes = request.featureTypes || ["settlements", "boundaries", "routes", "labels"];
  const prompt = buildExtractionPrompt(request.bounds, featureTypes);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA,
    },
  });

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: request.mimeType,
        data: request.imageBase64,
      },
    },
  ]);

  const text = result.response.text();
  const parsed = JSON.parse(text) as MapFeatureExtractionResult;

  return validateAndCleanResult(parsed, request.bounds);
}

// Exported for testing
export { buildExtractionPrompt, validateAndCleanResult, clampCoordinate, EXTRACTION_SCHEMA };
