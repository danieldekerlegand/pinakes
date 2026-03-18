# Removed / Disabled Features (TSV Read-Only Mode)

This project is currently running in a **TSV-backed, read-only mode**. The PostgreSQL/Drizzle-backed features were removed or disabled to simplify initial usage and allow the app to run without `DATABASE_URL`.

## Supported API Endpoints

- `GET /api/languages`
- `GET /api/languages/:id`
- `GET /api/language-families`
- `GET /api/language-families/tree`
- `GET /api/base-words`
- `GET /api/stats`

## Removed / Disabled Server Features

- WebSocket scraping progress updates (`/ws`)
- Scraping jobs endpoints (`/api/scraping-jobs`)
- Database normalization endpoints
- Language family scraping endpoints
- Word translation write endpoints
- Word comparison endpoint
- Etymology / migration endpoints
- Language evolution timeline endpoints
- User contribution endpoints
- AI translation context generation endpoints
- Search filters endpoints

## Removed / Disabled Client Features

These UI panels/components were disabled for TSV mode (and excluded from TypeScript compilation for now):

- Advanced search filters UI
- AI translation context UI
- Database normalizer UI
- Language evolution timeline UI
- Language map UI
- User contribution UI

## How to Re-enable Later

Reintroducing the removed features will require:

- Restoring a real storage layer for writes (DB or a TSV/JSON write model)
- Re-adding endpoints in `server/routes.ts`
- Re-adding a concrete storage implementation that supports mutations
- Re-enabling the corresponding client components and wiring
