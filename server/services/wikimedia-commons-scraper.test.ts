import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { WikimediaCommonsScraper } from "./wikimedia-commons-scraper";

// The scraper resolves its output path lazily from `WIKIMEDIA_COMMONS_TSV`, so pointing it at
// a temp file here is enough. It must NOT write into the real `lexicons/` tree: that races
// `shared/lexicon-mapping.test.ts` (which reads the live directory and fails on an unmapped
// file) and puts a unit test one bug away from clobbering curated data.
const TEST_TSV_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wikimedia-commons-")),
  "wikimedia-commons-images.tsv",
);
process.env.WIKIMEDIA_COMMONS_TSV = TEST_TSV_PATH;

function cleanupTestFiles(): void {
  for (const f of [TEST_TSV_PATH, `${TEST_TSV_PATH}.tmp`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("WikimediaCommonsScraper", () => {
  let scraper: WikimediaCommonsScraper;

  beforeEach(() => {
    scraper = new WikimediaCommonsScraper();
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  describe("getCategoryMembers", () => {
    it("fetches category members from the API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            categorymembers: [
              { pageid: 1001, title: "File:Temple_of_Athena.jpg" },
              { pageid: 1002, title: "File:Angkor_Wat.jpg" },
            ],
          },
        }),
      });

      const members = await scraper.getCategoryMembers("Temples", 10);

      expect(members).toHaveLength(2);
      expect(members[0].pageid).toBe(1001);
      expect(members[0].title).toBe("File:Temple_of_Athena.jpg");
      expect(members[1].pageid).toBe(1002);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("categorymembers");
      expect(calledUrl).toContain("Category%3ATemples");
    });

    it("handles pagination with continue token", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [
                { pageid: 1, title: "File:A.jpg" },
                { pageid: 2, title: "File:B.jpg" },
              ],
            },
            continue: { cmcontinue: "page2token" },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [
                { pageid: 3, title: "File:C.jpg" },
              ],
            },
          }),
        });

      const members = await scraper.getCategoryMembers("Test", 10);

      expect(members).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondUrl = mockFetch.mock.calls[1][0] as string;
      expect(secondUrl).toContain("cmcontinue=page2token");
    });

    it("respects the limit parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            categorymembers: [
              { pageid: 1, title: "File:A.jpg" },
              { pageid: 2, title: "File:B.jpg" },
              { pageid: 3, title: "File:C.jpg" },
            ],
          },
          continue: { cmcontinue: "more" },
        }),
      });

      const members = await scraper.getCategoryMembers("Test", 2);

      expect(members).toHaveLength(2);
    });

    it("handles HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(scraper.getCategoryMembers("Test")).rejects.toThrow(
        "HTTP 500"
      );
    });
  });

  describe("getImageInfo", () => {
    it("fetches image info and extracts metadata", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1001": {
                pageid: 1001,
                title: "File:Egyptian_temple.jpg",
                imageinfo: [
                  {
                    url: "https://upload.wikimedia.org/full/egyptian_temple.jpg",
                    thumburl: "https://upload.wikimedia.org/thumb/egyptian_temple.jpg",
                    extmetadata: {
                      ImageDescription: { value: "Ancient Egyptian temple at Luxor" },
                      Artist: { value: "John Doe" },
                      LicenseShortName: { value: "CC BY-SA 4.0" },
                      DateTimeOriginal: { value: "2020-01-15" },
                    },
                    timestamp: "2020-01-15T12:00:00Z",
                  },
                ],
                categories: [
                  { title: "Category:Temples_in_Egypt" },
                  { title: "Category:Ancient_Egyptian_architecture" },
                ],
                coordinates: [{ lat: 25.7, lon: 32.65 }],
              },
            },
          },
        }),
      });

      const images = await scraper.getImageInfo([1001]);

      expect(images).toHaveLength(1);
      const img = images[0];
      expect(img.id).toBe("egyptian_temple");
      expect(img.title).toBe("Egyptian_temple.jpg");
      expect(img.description).toContain("Egyptian temple");
      expect(img.imageUrl).toContain("full/egyptian_temple.jpg");
      expect(img.thumbUrl).toContain("thumb/egyptian_temple.jpg");
      expect(img.artist).toBe("John Doe");
      expect(img.license).toBe("CC BY-SA 4.0");
      expect(img.categories).toContain("Temples_in_Egypt");
      expect(img.coordinates).toEqual({ lat: 25.7, lng: 32.65 });
      expect(img.dateCreated).toBe("2020-01-15");
      expect(img.associatedCulture).toBe("Ancient Egyptian");
      expect(img.region).toBe("North Africa");
      expect(img.artifactType).toBe("temple");
      expect(img.source).toContain("commons.wikimedia.org");
    });

    it("handles images without coordinates", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "2001": {
                pageid: 2001,
                title: "File:Greek_pottery.jpg",
                imageinfo: [
                  {
                    url: "https://upload.wikimedia.org/full/greek_pottery.jpg",
                    extmetadata: {
                      ImageDescription: { value: "Greek pottery from Athens" },
                      Artist: { value: "Unknown" },
                    },
                    timestamp: "2019-05-20T00:00:00Z",
                  },
                ],
                categories: [{ title: "Category:Greek_pottery" }],
              },
            },
          },
        }),
      });

      const images = await scraper.getImageInfo([2001]);

      expect(images).toHaveLength(1);
      expect(images[0].coordinates).toBeNull();
      expect(images[0].artifactType).toBe("pottery");
      expect(images[0].associatedCulture).toBe("Ancient Greek");
    });

    it("handles empty page IDs", async () => {
      const images = await scraper.getImageInfo([]);
      expect(images).toHaveLength(0);
    });

    it("batches requests for large page ID lists", async () => {
      const pageIds = Array.from({ length: 25 }, (_, i) => i + 1);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              pages: Object.fromEntries(
                pageIds.slice(0, 20).map((id) => [
                  String(id),
                  {
                    pageid: id,
                    title: `File:Image_${id}.jpg`,
                    imageinfo: [
                      {
                        url: `https://example.com/${id}.jpg`,
                        extmetadata: {},
                        timestamp: "2020-01-01",
                      },
                    ],
                    categories: [],
                  },
                ])
              ),
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              pages: Object.fromEntries(
                pageIds.slice(20).map((id) => [
                  String(id),
                  {
                    pageid: id,
                    title: `File:Image_${id}.jpg`,
                    imageinfo: [
                      {
                        url: `https://example.com/${id}.jpg`,
                        extmetadata: {},
                        timestamp: "2020-01-01",
                      },
                    ],
                    categories: [],
                  },
                ])
              ),
            },
          }),
        });

      const images = await scraper.getImageInfo(pageIds);

      expect(images).toHaveLength(25);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("scrapeImages", () => {
    it("scrapes images from categories and writes TSV", async () => {
      // Mock category members
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [
                { pageid: 100, title: "File:Mosque_of_Cordoba.jpg" },
              ],
            },
          }),
        })
        // Mock image info
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                "100": {
                  pageid: 100,
                  title: "File:Mosque_of_Cordoba.jpg",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/full/mosque.jpg",
                      thumburl: "https://upload.wikimedia.org/thumb/mosque.jpg",
                      extmetadata: {
                        ImageDescription: { value: "Great Mosque of Cordoba" },
                        Artist: { value: "Photographer" },
                        LicenseShortName: { value: "CC BY 2.0" },
                      },
                      timestamp: "2021-06-01T00:00:00Z",
                    },
                  ],
                  categories: [{ title: "Category:Mosques_in_Spain" }],
                  coordinates: [{ lat: 37.88, lon: -4.78 }],
                },
              },
            },
          }),
        });

      const progressMessages: string[] = [];
      const result = await scraper.scrapeImages({
        categories: ["Mosques"],
        maxPerCategory: 5,
        progressCallback: (_type, message) => {
          progressMessages.push(message);
        },
      });

      expect(result.count).toBe(1);
      expect(result.images).toHaveLength(1);
      expect(result.images[0].title).toBe("Mosque_of_Cordoba.jpg");
      expect(result.images[0].artifactType).toBe("mosque");

      // Verify TSV was written
      const tsvPath = TEST_TSV_PATH;
      expect(fs.existsSync(tsvPath)).toBe(true);

      const content = fs.readFileSync(tsvPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      expect(lines.length).toBe(2); // header + 1 row
      expect(lines[0]).toContain("id\ttitle\t");
      expect(lines[1]).toContain("mosque_of_cordoba");

      // Cleanup
      fs.unlinkSync(tsvPath);

      // Verify progress was reported
      expect(progressMessages.some((m) => m.includes("Mosques"))).toBe(true);
    });

    it("skips already-scraped images", async () => {
      // Pre-populate TSV with an existing image
      const tsvPath = TEST_TSV_PATH;
      const headers = "id\ttitle\tdescription\timage_url\tthumb_url\tartist\tlicense\tcategories\tcoordinates\tdate_created\tassociated_culture\tassociated_language_ids\tartifact_type\tregion\tsource\n";
      const row = "existing_image\tExisting.jpg\tTest\thttps://example.com/img.jpg\thttps://example.com/thumb.jpg\tArtist\tCC BY\t[]\t\t2020-01-01\t\t[]\tcultural_artifact\t\thttps://commons.wikimedia.org/wiki/File:Existing.jpg\n";
      fs.writeFileSync(tsvPath, headers + row, "utf8");

      // Mock API responses returning the same image
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [
                { pageid: 999, title: "File:Existing_image.jpg" },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                "999": {
                  pageid: 999,
                  title: "File:Existing_image.jpg",
                  imageinfo: [
                    {
                      url: "https://example.com/existing.jpg",
                      extmetadata: {},
                      timestamp: "2020-01-01",
                    },
                  ],
                  categories: [],
                },
              },
            },
          }),
        });

      const result = await scraper.scrapeImages({
        categories: ["Test"],
        maxPerCategory: 5,
      });

      // The existing image should be skipped (same slugified ID)
      expect(result.count).toBe(0);

      // Cleanup
      fs.unlinkSync(tsvPath);
    });

    it("prevents concurrent scraping", async () => {
      // Start a long-running scrape
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({ query: { categorymembers: [] } }),
                }),
              100
            )
          )
      );

      const first = scraper.scrapeImages({
        categories: ["Test1"],
        maxPerCategory: 1,
      });

      // Attempt second scrape should fail
      await expect(
        scraper.scrapeImages({ categories: ["Test2"], maxPerCategory: 1 })
      ).rejects.toThrow("already in progress");

      await first;
    });

    it("handles API failures gracefully per category", async () => {
      mockFetch
        // First category fails
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        })
        // Second category succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [
                { pageid: 200, title: "File:Castle.jpg" },
              ],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                "200": {
                  pageid: 200,
                  title: "File:Castle.jpg",
                  imageinfo: [
                    {
                      url: "https://example.com/castle.jpg",
                      extmetadata: {
                        ImageDescription: { value: "Medieval castle" },
                      },
                      timestamp: "2021-01-01",
                    },
                  ],
                  categories: [{ title: "Category:Castles" }],
                },
              },
            },
          }),
        });

      const warnings: string[] = [];
      const result = await scraper.scrapeImages({
        categories: ["FailCategory", "Castles"],
        maxPerCategory: 5,
        progressCallback: (type, message) => {
          if (type === "warning") warnings.push(message);
        },
      });

      // Should still get result from second category
      expect(result.count).toBe(1);
      expect(result.images[0].artifactType).toBe("castle");
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("FailCategory");

      // Cleanup
      const tsvPath = TEST_TSV_PATH;
      if (fs.existsSync(tsvPath)) fs.unlinkSync(tsvPath);
    });
  });

  describe("cultural metadata inference", () => {
    it("infers culture from title keywords", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "5001": {
                pageid: 5001,
                title: "File:Japanese_pagoda_Kyoto.jpg",
                imageinfo: [
                  {
                    url: "https://example.com/pagoda.jpg",
                    extmetadata: {
                      ImageDescription: { value: "A traditional Japanese pagoda in Kyoto" },
                    },
                    timestamp: "2022-03-01",
                  },
                ],
                categories: [{ title: "Category:Pagodas_in_Japan" }],
              },
            },
          },
        }),
      });

      const images = await scraper.getImageInfo([5001]);

      expect(images[0].associatedCulture).toBe("Japanese");
      expect(images[0].region).toBe("East Asia");
      expect(images[0].associatedLanguageIds).toContain("ja");
      expect(images[0].artifactType).toBe("pagoda");
    });

    it("identifies artifact types from description", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "5002": {
                pageid: 5002,
                title: "File:Ancient_manuscript.jpg",
                imageinfo: [
                  {
                    url: "https://example.com/manuscript.jpg",
                    extmetadata: {
                      ImageDescription: { value: "An ancient Persian manuscript" },
                    },
                    timestamp: "2022-03-01",
                  },
                ],
                categories: [],
              },
            },
          },
        }),
      });

      const images = await scraper.getImageInfo([5002]);

      expect(images[0].artifactType).toBe("manuscript");
      expect(images[0].associatedCulture).toBe("Persian");
    });
  });

  describe("HTML cleaning", () => {
    it("strips HTML tags and decodes entities", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "6001": {
                pageid: 6001,
                title: "File:Test_image.jpg",
                imageinfo: [
                  {
                    url: "https://example.com/test.jpg",
                    extmetadata: {
                      ImageDescription: {
                        value: '<span class="description">Temple &amp; <b>Palace</b> &quot;Complex&quot;</span>',
                      },
                      Artist: {
                        value: '<a href="/wiki/User:JDoe">J. Doe</a>',
                      },
                    },
                    timestamp: "2023-01-01",
                  },
                ],
                categories: [],
              },
            },
          },
        }),
      });

      const images = await scraper.getImageInfo([6001]);

      expect(images[0].description).toBe('Temple & Palace "Complex"');
      expect(images[0].artist).toBe("J. Doe");
    });
  });
});
