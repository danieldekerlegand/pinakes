/**
 * OpenAPI spec for the public contribution API (US-011)
 *
 * A hand-authored OpenAPI 3.0 document covering the contribution write endpoints
 * (secured — require an API key when `CONTRIBUTION_API_KEYS` is configured) and
 * the read endpoints (open). Served at `GET /api/openapi.json`; a committed
 * snapshot lives at `docs/openapi.json`.
 *
 * `buildOpenApiSpec()` is pure (no env / no clock) so the served spec and the
 * committed snapshot are byte-identical and a test can assert they match.
 */

export function buildOpenApiSpec(): Record<string, unknown> {
  const contributionSchema = {
    type: "object",
    required: ["entityType", "action", "entityData", "sources"],
    properties: {
      entityType: {
        type: "string",
        description: "The kind of entity this contribution concerns.",
        example: "civilization",
      },
      action: { type: "string", enum: ["add", "edit", "flag"] },
      entityId: {
        type: "string",
        description: "Existing entity id — required for 'edit' and 'flag' actions.",
      },
      entityData: {
        type: "object",
        description: "Entity fields (required fields depend on entityType).",
        additionalProperties: true,
      },
      sources: {
        type: "array",
        minItems: 1,
        description: "At least one source citation is required (except for flags).",
        items: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            url: { type: "string", format: "uri" },
            author: { type: "string" },
            year: { type: "integer" },
            license: { type: "string" },
          },
        },
      },
      confidence: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      contributorName: { type: "string" },
      contributorEmail: { type: "string", format: "email" },
      notes: { type: "string" },
    },
  };

  const errorSchema = {
    type: "object",
    properties: {
      message: { type: "string" },
      errors: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
    },
  };

  const datasetReleaseMetadataSchema = {
    type: "object",
    description:
      "Metadata for a versioned dataset release: semver version, DOI, license, and row counts.",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      version: {
        type: "string",
        description: "Semver version of this release.",
        example: "1.0.0",
      },
      releaseDate: { type: "string", format: "date-time" },
      doi: {
        type: "string",
        nullable: true,
        description: "Minted DOI (null when DOI minting is disabled).",
      },
      doiUrl: { type: "string", nullable: true, format: "uri" },
      license: { type: "string", example: "CC-BY-4.0" },
      source: { type: "string" },
      format: { type: "string", enum: ["cldf", "csv", "tsv", "json"] },
      fileCount: { type: "integer" },
      totalRows: { type: "integer" },
      datasets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            fileCount: { type: "integer" },
            totalRows: { type: "integer" },
          },
        },
      },
    },
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "LinguaScrape Public API",
      version: "1.1.0",
      description:
        "Programmatic contribution + read API plus a versioned public dataset API. " +
        "Contribution write endpoints require an API key (via the 'X-API-Key' header " +
        "or 'Authorization: Bearer <key>') when the server is configured with " +
        "CONTRIBUTION_API_KEYS, and are rate-limited per key. Read endpoints are open. " +
        "Submitted contributions enter a review queue; they are never written to the " +
        "live dataset unreviewed. The dataset API exposes citable, versioned snapshots " +
        "(semver + optional DOI) and a full-dataset download endpoint.",
    },
    servers: [{ url: "/", description: "This LinguaScrape instance" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "A contribution API key.",
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A contribution API key passed as a bearer token.",
        },
      },
      schemas: {
        ContributionInput: contributionSchema,
        DatasetReleaseMetadata: datasetReleaseMetadataSchema,
        Error: errorSchema,
      },
    },
    paths: {
      "/api/dataset/release": {
        get: {
          summary: "Current dataset release metadata (version, DOI, license, row counts).",
          tags: ["Dataset"],
          security: [],
          parameters: [
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["cldf", "csv", "tsv", "json"] },
            },
            {
              name: "datasets",
              in: "query",
              description: "Comma-separated dataset profile ids (default: all).",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Release metadata.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DatasetReleaseMetadata" },
                },
              },
            },
            "400": {
              description: "Invalid request.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
        post: {
          summary: "Mint a new versioned dataset release (semver + changelog + DOI).",
          tags: ["Dataset"],
          security: [],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    version: {
                      type: "string",
                      description: "Explicit semver; overrides changelog-derived versioning.",
                    },
                    previousVersion: { type: "string" },
                    format: { type: "string", enum: ["cldf", "csv", "tsv", "json"] },
                    datasets: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "The minted release metadata.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DatasetReleaseMetadata" },
                },
              },
            },
            "400": {
              description: "Invalid request.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
      },
      "/api/dataset/full": {
        get: {
          summary: "Download the full dataset (all profiles + release metadata).",
          tags: ["Dataset"],
          security: [],
          parameters: [
            {
              name: "format",
              in: "query",
              schema: { type: "string", enum: ["cldf", "csv", "tsv", "json"] },
            },
            {
              name: "datasets",
              in: "query",
              description: "Comma-separated dataset profile ids (default: all).",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "A downloadable JSON bundle: { metadata, files[] }.",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": {
              description: "Invalid request.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
      },
      "/api/openapi.json": {
        get: {
          summary: "This OpenAPI document.",
          tags: ["Meta"],
          security: [],
          responses: { "200": { description: "The OpenAPI 3.0 spec." } },
        },
      },
      "/api/contributions": {
        post: {
          summary: "Submit a new contribution (enters the review queue).",
          tags: ["Contributions"],
          security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContributionInput" },
              },
            },
          },
          responses: {
            "201": { description: "Contribution queued for review." },
            "400": {
              description: "Validation failed.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
            "401": { description: "API key required (no key presented)." },
            "403": { description: "Invalid API key." },
            "429": { description: "Rate limit exceeded." },
          },
        },
        get: {
          summary: "List contributions (filterable, paginated).",
          tags: ["Contributions"],
          security: [],
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "rejected"] } },
            { name: "entityType", in: "query", schema: { type: "string" } },
            { name: "action", in: "query", schema: { type: "string", enum: ["add", "edit", "flag"] } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "A page of contributions." } },
        },
      },
      "/api/contributions/{id}": {
        get: {
          summary: "Get a single contribution.",
          tags: ["Contributions"],
          security: [],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The contribution." },
            "404": { description: "Not found." },
          },
        },
      },
      "/api/contributions/{id}/review": {
        patch: {
          summary: "Approve or reject a contribution (moderation).",
          tags: ["Contributions"],
          security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["decision"],
                  properties: {
                    decision: { type: "string", enum: ["approved", "rejected"] },
                    note: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "The reviewed contribution." },
            "400": { description: "Invalid decision." },
            "401": { description: "API key required." },
            "403": { description: "Invalid API key." },
            "404": { description: "Not found." },
            "429": { description: "Rate limit exceeded." },
          },
        },
      },
      "/api/contributions/stats": {
        get: {
          summary: "Contribution summary statistics.",
          tags: ["Contributions"],
          security: [],
          responses: { "200": { description: "Aggregate counts." } },
        },
      },
      "/api/contributions/entity/{entityType}/{entityId}": {
        get: {
          summary: "Approved contributions for a specific entity.",
          tags: ["Contributions"],
          security: [],
          parameters: [
            { name: "entityType", in: "path", required: true, schema: { type: "string" } },
            { name: "entityId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Approved contributions." } },
        },
      },
      "/api/contributions/export": {
        get: {
          summary: "Export all contributions as CSV.",
          tags: ["Contributions"],
          security: [],
          responses: {
            "200": {
              description: "CSV export.",
              content: { "text/csv": { schema: { type: "string" } } },
            },
          },
        },
      },
    },
  };
}
