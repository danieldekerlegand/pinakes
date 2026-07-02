import { describe, it, expect } from "vitest";
import type { CultureProfile } from "../shared/types";
import {
  buildCultureProfileReportHtml,
  buildReportFilename,
  escapeHtml,
  formatReportPopulation,
  formatReportTimePeriod,
  formatReportYear,
  humanizeSocialOrganization,
  humanizeSubsistence,
  humanizeTechnology,
  humanizeUrbanism,
  REPORT_CSS,
} from "../client/src/lib/culture-profile-report";

const SAMPLE_PROFILE: CultureProfile = {
  id: "roman-culture",
  name: "Roman",
  alternateNames: ["Romani", "Latin"],
  civilizationId: "rome",
  archaeologicalCultureId: null,
  timePeriodStart: -753,
  timePeriodEnd: 476,
  region: "Mediterranean",
  summaryDescription:
    "A Mediterranean empire centered on the city of Rome known for law, engineering, & warfare.",
  socialOrganization: "empire",
  subsistenceType: "agricultural",
  urbanismLevel: "metropolis",
  populationEstimate: 70_000_000,
  technologyLevel: "iron",
  associatedLanguageIds: ["latin", "greek"],
  associatedReligionIds: ["roman-religion"],
  associatedWritingSystemIds: ["latin-alphabet"],
  associatedArtTraditionIds: ["roman-art"],
  associatedMusicTraditionIds: [],
  associatedCuisineId: "roman-cuisine",
  associatedArchitecturalStyleIds: ["roman-architecture"],
  associatedLiteraryTraditionIds: ["latin-literature"],
  notableSettlements: ["Rome", "Pompeii", "Constantinople"],
  imageGalleryTags: ["forum", "colosseum"],
  sources: ["wikipedia.org/wiki/Roman_Empire", "britannica.com/place/ancient-Rome"],
};

describe("culture-profile-report utilities", () => {
  describe("formatReportYear", () => {
    it("formats negative years as BCE", () => {
      expect(formatReportYear(-500)).toBe("500 BCE");
    });
    it("formats positive years as CE", () => {
      expect(formatReportYear(1500)).toBe("1500 CE");
    });
    it("handles the year zero", () => {
      expect(formatReportYear(0)).toBe("0 CE");
    });
  });

  describe("formatReportTimePeriod", () => {
    it("combines BCE start and CE end with an en-dash", () => {
      expect(formatReportTimePeriod(-753, 476)).toBe("753 BCE \u2013 476 CE");
    });
  });

  describe("formatReportPopulation", () => {
    it("returns Unknown for null", () => {
      expect(formatReportPopulation(null)).toBe("Unknown");
    });
    it("formats millions without decimals when round", () => {
      expect(formatReportPopulation(70_000_000)).toBe("70 million");
    });
    it("formats millions with one decimal otherwise", () => {
      expect(formatReportPopulation(1_500_000)).toBe("1.5 million");
    });
    it("formats thousands with K suffix", () => {
      expect(formatReportPopulation(12_000)).toBe("12K");
    });
    it("locales small numbers", () => {
      expect(formatReportPopulation(850)).toBe("850");
    });
  });

  describe("humanizers", () => {
    it("maps known enums to human labels", () => {
      expect(humanizeSocialOrganization("empire")).toBe("Empire");
      expect(humanizeSubsistence("hunter-gatherer")).toBe("Hunter-Gatherer");
      expect(humanizeUrbanism("city-state")).toBe("City-State");
      expect(humanizeTechnology("iron")).toBe("Iron Age");
    });
    it("falls back to raw value for unknown enums", () => {
      expect(humanizeSocialOrganization("unknown")).toBe("unknown");
    });
  });

  describe("escapeHtml", () => {
    it("escapes dangerous characters", () => {
      expect(escapeHtml('<script>alert("x")</script>')).toBe(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
      );
    });
    it("escapes ampersands and single quotes", () => {
      expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
    });
  });

  describe("buildReportFilename", () => {
    it("produces a slug-based filename", () => {
      expect(buildReportFilename(SAMPLE_PROFILE)).toBe(
        "culture-profile-roman-culture.html",
      );
    });
    it("sanitizes non-slug characters", () => {
      const profile: CultureProfile = { ...SAMPLE_PROFILE, id: "Culture With Spaces!" };
      expect(buildReportFilename(profile)).toBe(
        "culture-profile-culture-with-spaces-.html",
      );
    });
  });
});

describe("buildCultureProfileReportHtml", () => {
  it("returns a complete HTML document with doctype", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });

  it("sets the document title to the culture name", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("<title>Roman \u2014 Culture Profile Report</title>");
  });

  it("includes the cover page with culture name, region, and time period", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain(">Roman<");
    expect(html).toContain("Mediterranean");
    expect(html).toContain("753 BCE \u2013 476 CE");
    expect(html).toContain("Iron Age");
  });

  it("includes the summary description", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("A Mediterranean empire centered on the city of Rome");
  });

  it("escapes ampersands in descriptions", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("law, engineering, &amp; warfare");
    expect(html).not.toContain("engineering, & warfare");
  });

  it("renders the stat grid with all four overview stats", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain(">Population<");
    expect(html).toContain(">70 million<");
    expect(html).toContain(">Metropolis<");
    expect(html).toContain(">Agricultural<");
  });

  it("renders associated language ids when no socio-cultural names are provided", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain(">latin<");
    expect(html).toContain(">greek<");
  });

  it("prefers resolved socio-cultural names when provided", () => {
    const html = buildCultureProfileReportHtml({
      profile: SAMPLE_PROFILE,
      socioCultural: {
        languages: [
          { id: "latin", name: "Classical Latin" },
          { id: "greek", name: "Koine Greek" },
        ],
      },
    });
    expect(html).toContain("Classical Latin");
    expect(html).toContain("Koine Greek");
    expect(html).not.toMatch(/<li>latin<\/li>/);
  });

  it("renders notable settlements", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("Rome");
    expect(html).toContain("Pompeii");
    expect(html).toContain("Constantinople");
  });

  it("renders gallery when media assets are provided", () => {
    const html = buildCultureProfileReportHtml({
      profile: SAMPLE_PROFILE,
      media: [
        {
          id: "m1",
          title: "Colosseum",
          sourceUrl: "https://example.org/colosseum.jpg",
          attribution: "Wikimedia Commons",
        },
      ],
    });
    expect(html).toContain("<h2>Gallery</h2>");
    expect(html).toContain("https://example.org/colosseum.jpg");
    expect(html).toContain("Colosseum");
    expect(html).toContain("Wikimedia Commons");
  });

  it("omits gallery section entirely when no media is supplied", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).not.toContain("<h2>Gallery</h2>");
  });

  it("renders a share URL footer link when supplied", () => {
    const html = buildCultureProfileReportHtml({
      profile: SAMPLE_PROFILE,
      shareUrl: "https://app.test/culture-profile/roman-culture/report",
    });
    expect(html).toContain(
      "https://app.test/culture-profile/roman-culture/report",
    );
    expect(html).toContain("Shareable URL");
  });

  it("renders the sources section when sources exist", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("<h2>Sources</h2>");
    expect(html).toContain("wikipedia.org/wiki/Roman_Empire");
  });

  it("uses a fixed ISO date in the footer when provided", () => {
    const html = buildCultureProfileReportHtml({
      profile: SAMPLE_PROFILE,
      generatedAt: new Date("2026-04-16T12:00:00Z"),
    });
    expect(html).toContain("Generated 2026-04-16");
  });

  it("embeds the print-friendly stylesheet", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("@media print");
    expect(html).toContain("@page");
  });

  it("renders a historical-position timeline track with reasonable width", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("timeline-track");
    expect(html).toContain("timeline-fill");
  });

  it("renders alternate names subtitle when present", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("Also known as Romani, Latin");
  });

  it("omits alternate names subtitle when empty", () => {
    const profile: CultureProfile = { ...SAMPLE_PROFILE, alternateNames: [] };
    const html = buildCultureProfileReportHtml({ profile });
    expect(html).not.toContain("Also known as");
  });

  it("renders cuisine when present on profile", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain("<h3>Cuisine</h3>");
    expect(html).toContain("roman-cuisine");
  });

  it("prefers resolved cuisine name when provided", () => {
    const html = buildCultureProfileReportHtml({
      profile: SAMPLE_PROFILE,
      socioCultural: { cuisine: { id: "roman-cuisine", name: "Ancient Roman Cuisine" } },
    });
    expect(html).toContain("Ancient Roman Cuisine");
  });

  it("exposes REPORT_CSS as a non-empty stylesheet string", () => {
    expect(typeof REPORT_CSS).toBe("string");
    expect(REPORT_CSS.length).toBeGreaterThan(100);
    expect(REPORT_CSS).toContain(".report");
  });

  it("exposes the culture id as a data attribute", () => {
    const html = buildCultureProfileReportHtml({ profile: SAMPLE_PROFILE });
    expect(html).toContain('data-culture-id="roman-culture"');
  });
});
