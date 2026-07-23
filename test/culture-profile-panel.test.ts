import { describe, it, expect } from "vitest";
import { TsvStorage } from "../server/tsv-storage";
import type { CultureProfile } from "../shared/types";

describe("CultureProfile data layer", () => {
  const storage = new TsvStorage();

  describe("getCultureProfiles", () => {
    it("loads all culture profiles from TSV", async () => {
      const profiles = await storage.getCultureProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(10);
    });

    it("returns profiles with all required fields", async () => {
      const profiles = await storage.getCultureProfiles();
      for (const p of profiles) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(p.region).toBeTruthy();
        expect(typeof p.timePeriodStart).toBe("number");
        expect(typeof p.timePeriodEnd).toBe("number");
        expect(p.timePeriodStart).toBeLessThan(p.timePeriodEnd);
        expect(p.summaryDescription).toBeTruthy();
        expect(Array.isArray(p.associatedLanguageIds)).toBe(true);
        expect(Array.isArray(p.sources)).toBe(true);
      }
    });

    it("filters by region", async () => {
      const results = await storage.getCultureProfiles({ region: "Mesoamerica" });
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const p of results) {
        expect(p.region.toLowerCase()).toContain("mesoamerica");
      }
    });

    it("filters by time range", async () => {
      const results = await storage.getCultureProfiles({ timeStart: -5000, timeEnd: -100 });
      expect(results.length).toBeGreaterThan(0);
      for (const p of results) {
        expect(p.timePeriodEnd).toBeGreaterThanOrEqual(-5000);
        expect(p.timePeriodStart).toBeLessThanOrEqual(-100);
      }
    });

    it("filters by subsistence type", async () => {
      const results = await storage.getCultureProfiles({ subsistenceType: "maritime" });
      expect(results.length).toBeGreaterThan(0);
      for (const p of results) {
        expect(p.subsistenceType).toBe("maritime");
      }
    });

    it("filters by urbanism level", async () => {
      const results = await storage.getCultureProfiles({ urbanismLevel: "metropolis" });
      expect(results.length).toBeGreaterThan(0);
      for (const p of results) {
        expect(p.urbanismLevel).toBe("metropolis");
      }
    });

    it("returns empty array for no matches", async () => {
      const results = await storage.getCultureProfiles({ region: "nonexistent-region-xyz" });
      expect(results).toEqual([]);
    });
  });

  describe("getCultureProfileById", () => {
    it("returns a specific profile by ID", async () => {
      const profile = await storage.getCultureProfileById("cp-roman");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Roman Culture");
      expect(profile!.socialOrganization).toBe("empire");
      expect(profile!.technologyLevel).toBe("iron");
      expect(profile!.associatedLanguageIds).toContain("latin");
    });

    it("returns null for nonexistent ID", async () => {
      const profile = await storage.getCultureProfileById("nonexistent-id");
      expect(profile).toBeNull();
    });

    it("parses pipe-separated fields correctly", async () => {
      const profile = await storage.getCultureProfileById("cp-aztec");
      expect(profile).not.toBeNull();
      expect(profile!.alternateNames).toContain("Mexica");
      expect(profile!.alternateNames).toContain("Tenochca");
      expect(profile!.notableSettlements.length).toBeGreaterThan(0);
    });
  });

  describe("enum validation", () => {
    const validSocialOrgs = ["egalitarian", "chiefdom", "state", "empire"];
    const validSubsistence = ["hunter-gatherer", "pastoral", "agricultural", "maritime", "mixed"];
    const validUrbanism = ["nomadic", "village", "town", "city-state", "metropolis"];
    const validTech = ["stone", "copper", "bronze", "iron", "steel", "industrial"];

    it("all profiles have valid enum values", async () => {
      const profiles = await storage.getCultureProfiles();
      for (const p of profiles) {
        expect(validSocialOrgs).toContain(p.socialOrganization);
        expect(validSubsistence).toContain(p.subsistenceType);
        expect(validUrbanism).toContain(p.urbanismLevel);
        expect(validTech).toContain(p.technologyLevel);
      }
    });
  });
});
