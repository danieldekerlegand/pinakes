import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildExtractionPrompt,
  validateAndCleanResult,
  clampCoordinate,
  analyzeMapImage,
} from "./map-image-analyzer";
import type {
  MapFeatureExtractionResult,
  FeatureExtractionRequest,
} from "./map-image-analyzer";

// Mock the Google Generative AI module
const mockGenerateContent = vi.fn();
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
  SchemaType: {
    OBJECT: "OBJECT",
    ARRAY: "ARRAY",
    STRING: "STRING",
    NUMBER: "NUMBER",
  },
}));

describe("map-image-analyzer", () => {
  describe("clampCoordinate", () => {
    const bounds: [[number, number], [number, number]] = [
      [30, 20],
      [50, 40],
    ];

    it("returns coordinates within bounds unchanged", () => {
      expect(clampCoordinate(40, 30, bounds)).toEqual([40, 30]);
    });

    it("clamps coordinates outside bounds (with margin)", () => {
      const margin = Math.max((50 - 30) * 0.1, (40 - 20) * 0.1);
      const [lat, lng] = clampCoordinate(100, -100, bounds);
      expect(lat).toBe(50 + margin);
      expect(lng).toBe(20 - margin);
    });

    it("allows coordinates slightly outside bounds within margin", () => {
      const [lat, lng] = clampCoordinate(51, 19, bounds);
      // 51 is within margin of 2 (10% of 20), so should be unchanged
      expect(lat).toBe(51);
      expect(lng).toBe(19);
    });
  });

  describe("buildExtractionPrompt", () => {
    it("includes bounds in the prompt", () => {
      const bounds: [[number, number], [number, number]] = [
        [30.5, 20.1],
        [50.2, 40.8],
      ];
      const prompt = buildExtractionPrompt(bounds, ["settlements", "routes"]);
      expect(prompt).toContain("30.5000");
      expect(prompt).toContain("20.1000");
      expect(prompt).toContain("50.2000");
      expect(prompt).toContain("40.8000");
    });

    it("includes requested feature types", () => {
      const bounds: [[number, number], [number, number]] = [
        [0, 0],
        [10, 10],
      ];
      const prompt = buildExtractionPrompt(bounds, ["settlements", "boundaries"]);
      expect(prompt).toContain("settlements");
      expect(prompt).toContain("boundaries");
    });

    it("includes guidance for each feature type", () => {
      const bounds: [[number, number], [number, number]] = [
        [0, 0],
        [10, 10],
      ];
      const prompt = buildExtractionPrompt(bounds, [
        "settlements",
        "boundaries",
        "routes",
        "labels",
      ]);
      expect(prompt).toContain("settlements");
      expect(prompt).toContain("boundaries");
      expect(prompt).toContain("routes");
      expect(prompt).toContain("labels");
    });
  });

  describe("validateAndCleanResult", () => {
    const bounds: [[number, number], [number, number]] = [
      [30, 20],
      [50, 40],
    ];

    it("passes through valid data", () => {
      const raw: MapFeatureExtractionResult = {
        settlements: [
          { name: "Rome", lat: 41.9, lng: 12.5, type: "city", confidence: 0.9 },
        ],
        boundaries: [],
        routes: [],
        labels: [],
        mapDescription: "Roman Empire",
        estimatedTimePeriod: "100 CE",
        estimatedRegion: "Mediterranean",
      };
      // Note: lat 41.9 is within bounds, lng 12.5 is outside but within margin
      const result = validateAndCleanResult(raw, bounds);
      expect(result.settlements).toHaveLength(1);
      expect(result.settlements[0].name).toBe("Rome");
      expect(result.settlements[0].type).toBe("city");
    });

    it("clamps confidence to 0-1 range", () => {
      const raw: MapFeatureExtractionResult = {
        settlements: [
          { name: "Test", lat: 40, lng: 30, type: "city", confidence: 1.5 },
        ],
        boundaries: [],
        routes: [],
        labels: [],
        mapDescription: "",
        estimatedTimePeriod: "",
        estimatedRegion: "",
      };
      const result = validateAndCleanResult(raw, bounds);
      expect(result.settlements[0].confidence).toBe(1);
    });

    it("replaces invalid type with 'unknown'", () => {
      const raw: MapFeatureExtractionResult = {
        settlements: [
          {
            name: "Test",
            lat: 40,
            lng: 30,
            type: "hamlet" as "city",
            confidence: 0.5,
          },
        ],
        boundaries: [
          {
            name: "Test Region",
            coordinates: [
              [35, 25],
              [35, 35],
              [45, 35],
            ],
            type: "province" as "empire",
            confidence: 0.6,
          },
        ],
        routes: [
          {
            name: "Test Route",
            waypoints: [
              [35, 25],
              [45, 35],
            ],
            type: "caravan" as "trade",
            confidence: 0.7,
          },
        ],
        labels: [
          {
            text: "Test Label",
            lat: 40,
            lng: 30,
            category: "sea" as "water",
            confidence: 0.8,
          },
        ],
        mapDescription: "",
        estimatedTimePeriod: "",
        estimatedRegion: "",
      };
      const result = validateAndCleanResult(raw, bounds);
      expect(result.settlements[0].type).toBe("unknown");
      expect(result.boundaries[0].type).toBe("unknown");
      expect(result.routes[0].type).toBe("unknown");
      expect(result.labels[0].category).toBe("unknown");
    });

    it("handles missing arrays gracefully", () => {
      const raw = {
        settlements: undefined,
        boundaries: undefined,
        routes: undefined,
        labels: undefined,
        mapDescription: "test",
        estimatedTimePeriod: "",
        estimatedRegion: "",
      } as unknown as MapFeatureExtractionResult;
      const result = validateAndCleanResult(raw, bounds);
      expect(result.settlements).toEqual([]);
      expect(result.boundaries).toEqual([]);
      expect(result.routes).toEqual([]);
      expect(result.labels).toEqual([]);
    });

    it("clamps coordinates far outside bounds", () => {
      const raw: MapFeatureExtractionResult = {
        settlements: [
          { name: "Far Away", lat: 90, lng: -180, type: "city", confidence: 0.5 },
        ],
        boundaries: [],
        routes: [],
        labels: [],
        mapDescription: "",
        estimatedTimePeriod: "",
        estimatedRegion: "",
      };
      const result = validateAndCleanResult(raw, bounds);
      const s = result.settlements[0];
      const margin = Math.max((50 - 30) * 0.1, (40 - 20) * 0.1);
      expect(s.lat).toBeLessThanOrEqual(50 + margin);
      expect(s.lng).toBeGreaterThanOrEqual(20 - margin);
    });
  });

  describe("analyzeMapImage", () => {
    const originalEnv = process.env.GEMINI_API_KEY;

    beforeEach(() => {
      process.env.GEMINI_API_KEY = "test-key";
      mockGenerateContent.mockReset();
    });

    it("throws if GEMINI_API_KEY is not set", async () => {
      delete process.env.GEMINI_API_KEY;
      const request: FeatureExtractionRequest = {
        imageBase64: "dGVzdA==",
        mimeType: "image/png",
        bounds: [
          [30, 20],
          [50, 40],
        ],
      };
      await expect(analyzeMapImage(request)).rejects.toThrow("GEMINI_API_KEY");
      process.env.GEMINI_API_KEY = originalEnv;
    });

    it("calls Gemini with image data and returns parsed result", async () => {
      const mockResult: MapFeatureExtractionResult = {
        settlements: [
          { name: "Constantinople", lat: 41.01, lng: 28.98, type: "city", confidence: 0.95 },
        ],
        boundaries: [],
        routes: [],
        labels: [
          { text: "Bosporus", lat: 41.1, lng: 29.05, category: "water", confidence: 0.8 },
        ],
        mapDescription: "Byzantine Empire map",
        estimatedTimePeriod: "600 CE",
        estimatedRegion: "Eastern Mediterranean",
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(mockResult),
        },
      });

      const request: FeatureExtractionRequest = {
        imageBase64: "dGVzdA==",
        mimeType: "image/png",
        bounds: [
          [30, 20],
          [50, 40],
        ],
      };

      const result = await analyzeMapImage(request);
      expect(result.settlements).toHaveLength(1);
      expect(result.settlements[0].name).toBe("Constantinople");
      expect(result.labels).toHaveLength(1);
      expect(result.labels[0].text).toBe("Bosporus");
      expect(result.mapDescription).toBe("Byzantine Empire map");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("defaults feature types to all when not specified", async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () =>
            JSON.stringify({
              settlements: [],
              boundaries: [],
              routes: [],
              labels: [],
              mapDescription: "",
              estimatedTimePeriod: "",
              estimatedRegion: "",
            }),
        },
      });

      const request: FeatureExtractionRequest = {
        imageBase64: "dGVzdA==",
        mimeType: "image/png",
        bounds: [
          [0, 0],
          [10, 10],
        ],
      };

      await analyzeMapImage(request);

      // Check the prompt includes all feature types
      const callArgs = mockGenerateContent.mock.calls[0][0];
      const prompt = callArgs[0];
      expect(prompt).toContain("settlements");
      expect(prompt).toContain("boundaries");
      expect(prompt).toContain("routes");
      expect(prompt).toContain("labels");
    });

    it("handles Gemini API errors", async () => {
      mockGenerateContent.mockRejectedValue(new Error("API rate limit exceeded"));

      const request: FeatureExtractionRequest = {
        imageBase64: "dGVzdA==",
        mimeType: "image/png",
        bounds: [
          [0, 0],
          [10, 10],
        ],
      };

      await expect(analyzeMapImage(request)).rejects.toThrow("API rate limit exceeded");
    });
  });
});
