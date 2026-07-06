import { describe, it, expect } from "vitest";

import {
  CANONICAL_PATH_TEMPLATE,
  canonicalEntityPath,
  describeEntity,
  entityApiPath,
  entityDomains,
  ENTITY_DOMAINS,
  isEntityDomain,
  parseCanonicalEntityPath,
  stableEntityId,
} from "./entity-resolver";

describe("entity-resolver registry", () => {
  it("covers the major entity types called out in US-009", () => {
    const domains = entityDomains();
    for (const expected of [
      "language",
      "language-family",
      "civilization",
      "culture-profile",
      "archaeological-site",
      "deity",
    ]) {
      expect(domains).toContain(expected);
    }
  });

  it("exposes a stable path template", () => {
    expect(CANONICAL_PATH_TEMPLATE).toBe("/entity/:domain/:id");
  });

  it("only marks the citable (sources-bearing) domains as citable", () => {
    expect(ENTITY_DOMAINS["culture-profile"].citable).toBe(true);
    expect(ENTITY_DOMAINS.civilization.citable).toBe(true);
    expect(ENTITY_DOMAINS.deity.citable).toBe(true);
    expect(ENTITY_DOMAINS["archaeological-site"].citable).toBe(true);
    expect(ENTITY_DOMAINS.language.citable).toBe(false);
    expect(ENTITY_DOMAINS.cuisine.citable).toBe(false);
  });
});

describe("isEntityDomain", () => {
  it("accepts known domains and rejects everything else", () => {
    expect(isEntityDomain("deity")).toBe(true);
    expect(isEntityDomain("dragons")).toBe(false);
    expect(isEntityDomain("")).toBe(false);
    expect(isEntityDomain(42)).toBe(false);
    expect(isEntityDomain(undefined)).toBe(false);
    // not fooled by inherited Object props
    expect(isEntityDomain("toString")).toBe(false);
    expect(isEntityDomain("hasOwnProperty")).toBe(false);
  });
});

describe("canonicalEntityPath / entityApiPath / stableEntityId", () => {
  it("builds a permanent canonical path", () => {
    expect(canonicalEntityPath("deity", "zeus")).toBe("/entity/deity/zeus");
    expect(entityApiPath("deity", "zeus")).toBe("/api/entity/deity/zeus");
  });

  it("url-encodes ids with reserved chars", () => {
    expect(canonicalEntityPath("language", "a/b?c")).toBe("/entity/language/a%2Fb%3Fc");
  });

  it("mints the graph-aligned stable id off the domain's node type", () => {
    expect(stableEntityId("civilization", "sumer")).toBe("cs:culture:sumer");
    expect(stableEntityId("archaeological-site", "ur")).toBe("cs:place:ur");
    expect(stableEntityId("language", "eng")).toBe("cs:language:eng");
  });
});

describe("parseCanonicalEntityPath", () => {
  it("round-trips a canonical path", () => {
    expect(parseCanonicalEntityPath("/entity/deity/zeus")).toEqual({ domain: "deity", id: "zeus" });
  });

  it("round-trips an encoded id", () => {
    const path = canonicalEntityPath("language", "a/b?c");
    expect(parseCanonicalEntityPath(path)).toEqual({ domain: "language", id: "a/b?c" });
  });

  it("tolerates an origin, trailing slash, and query/hash", () => {
    expect(parseCanonicalEntityPath("https://example.org/entity/deity/zeus")).toEqual({
      domain: "deity",
      id: "zeus",
    });
    expect(parseCanonicalEntityPath("/entity/deity/zeus/")).toEqual({ domain: "deity", id: "zeus" });
    expect(parseCanonicalEntityPath("/entity/deity/zeus?x=1#frag")).toEqual({ domain: "deity", id: "zeus" });
  });

  it("returns null for unknown domains and malformed paths", () => {
    expect(parseCanonicalEntityPath("/entity/dragons/smaug")).toBeNull();
    expect(parseCanonicalEntityPath("/entity/deity")).toBeNull();
    expect(parseCanonicalEntityPath("/entity/deity/zeus/report")).toBeNull();
    expect(parseCanonicalEntityPath("/other/deity/zeus")).toBeNull();
    expect(parseCanonicalEntityPath("")).toBeNull();
  });
});

describe("describeEntity", () => {
  it("builds a relative descriptor with no origin", () => {
    const d = describeEntity("culture-profile", { id: "minoan", name: "Minoan", region: "Crete", year: -2000 });
    expect(d).toMatchObject({
      domain: "culture-profile",
      id: "minoan",
      name: "Minoan",
      entityType: "culture",
      label: "Culture Profile",
      stableId: "cs:culture:minoan",
      canonicalPath: "/entity/culture-profile/minoan",
      canonicalUrl: "/entity/culture-profile/minoan",
      apiPath: "/api/entity/culture-profile/minoan",
      citable: true,
      citationDomain: "culture-profiles",
      viewPath: "/culture-profile/minoan/report",
      region: "Crete",
      year: -2000,
    });
  });

  it("makes canonicalUrl absolute when an origin is supplied", () => {
    const d = describeEntity("deity", { id: "zeus", name: "Zeus" }, "https://ling.example");
    expect(d.canonicalUrl).toBe("https://ling.example/entity/deity/zeus");
    expect(d.canonicalPath).toBe("/entity/deity/zeus");
    expect(d.viewPath).toBeNull();
    expect(d.region).toBeNull();
    expect(d.year).toBeNull();
  });
});
