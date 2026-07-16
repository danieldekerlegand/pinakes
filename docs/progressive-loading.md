# Progressive summary/detail loading (US-004)

Pinakes's legacy entity list endpoints return **fully hydrated** records —
every field of every row. A client that only needs a name plus a couple of badge
fields to render a list or a collapsed card still pays for the whole payload
(descriptions, pantheons, sacred texts, diffusion paths, …). Progressive loading
splits this into two steps:

1. **Summary first** — `GET /api/summaries/:domain` returns lightweight rows (the
   summary contract below): fast to fetch, enough to render a list/card header.
2. **Detail on demand** — hydrate one entity's full record only when needed
   (e.g. a card is expanded) from the entity's detail endpoint.

The summary is always a strict **subset** of the detail record, so the two-step
load is lossless: no summary field is missing from the detail shape.

## Server surface

| Endpoint | Returns |
| --- | --- |
| `GET /api/summaries` | The machine-readable contract for every domain: `{ domains: [{ domain, detailEndpoint, fields }] }`. Self-documenting discovery. |
| `GET /api/summaries/:domain` | A bounded, paginated page of summary rows: `{ domain, fields, detailEndpoint, summaries, total, returned, offset, limit, hasMore }`. Query params: `offset` (default 0), `limit` (default: whole remainder). Unknown domain → 404. |
| `GET /api/summaries/:domain/:id` | The **full** record for one entity, in the uniform summaries namespace. Unknown domain/id → 404. Equivalent to the domain's canonical `detailEndpoint`. |

The projection + pagination is pure and unit-tested in
`server/services/entity-summary.ts` (`summarizeEntity`, `paginate`,
`summarizeList`); the route (`server/routes/summaries.ts`) only maps a domain to
its storage fetcher and parses query params. TSV remains the source of truth —
this is a read-light view over the same records the legacy list endpoints return.

## Summary contract per domain

Every summary leads with `id` + `name` (so it is always renderable and
hydratable) and is a subset of the detail record. Detail = the full entity from
the domain's `detailEndpoint`.

| Domain | Detail endpoint | Summary fields |
| --- | --- | --- |
| `languages` | `/api/languages/:id` | `id, name, nativeName, iso639_1, familyId, region, status` |
| `religions` | `/api/religions/:id` | `id, name, nativeName, religionType, originRegion, timeOrigin, timeEnd` |
| `battles` | `/api/battles/:id` | `id, name, date, warName, outcome` |
| `culture-profiles` | `/api/culture-profiles/:id` | `id, name, region, timePeriodStart, timePeriodEnd, socialOrganization, subsistenceType, urbanismLevel, technologyLevel` |
| `cuisines` | `/api/cuisines/:id` | `id, name, nativeName, region, timeOrigin, timeEnd` |
| `trade-goods` | `/api/trade-goods/:id` | `id, name, category, originRegion, timePeriod` |
| `innovations` | `/api/innovations/:id` | `id, name, category, yearInvented, regionOfOrigin` |

The contract is defined once in `SUMMARY_CONTRACTS` (`server/services/entity-summary.ts`);
add a domain by declaring its `fields`/`detailEndpoint` there and its storage
fetcher in `DOMAIN_FETCHERS` (`server/routes/summaries.ts`).

> Note: `civilizations` is intentionally excluded — it is served as GeoJSON and
> already loads progressively via the map viewport/bbox API (US-003), not as
> flat rows.

## Client wiring

`client/src/hooks/use-progressive-entity.ts`:

- `useEntitySummaries<TSummary>(domain, { enabled, offset, limit })` — fetches the
  summary list up front.
- `useEntityDetail<TDetail>(domain, id, { enabled })` — hydrates one entity's full
  record, gated by `enabled`. Pass `enabled: false` while a card is collapsed and
  it fetches nothing.

Query keys are built in `client/src/lib/progressive-loading.ts`
(`summaryListKey`, `detailKey`) and map straight to the fetch URLs via the shared
`getQueryFn` (string parts → path, object part → query params). `detailKey` uses
the canonical `/api/<domain>/<id>` endpoint, so it shares the React Query cache
with any existing per-entity detail query.

**Reference integration:** `client/src/components/culture-profile/religion-mythology-section.tsx`
renders collapsed cards from `/api/summaries/religions`, then hydrates each card's
heavy detail (description, pantheon, sacred texts, practices) from
`/api/religions/:id` on expand, behind a pulse skeleton.

## Cache invalidation

Summaries and details are static reference data (`STALE_TIMES.static`, 30 min).
Because `detailKey` targets the canonical detail endpoint, invalidating an
entity's detail query invalidates it everywhere. The summary list is a separate
cache entry (`/api/summaries/:domain`) and is invalidated independently.
