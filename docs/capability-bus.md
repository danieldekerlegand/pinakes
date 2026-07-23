# Pinakes on the Koine capability bus (KCB)

`koine/specs/capability-bus.md` §6 names Pinakes **"the authority provider"** on the Koine
control plane: *"Expose `resolve`/`reconcile`/`query` and KGP snapshot/delta as capabilities."*
This document describes the manifest that does it.

**This layer is packaging, not implementation.** Every capability below is a pointer to code
that is already built and merged — the Wikidata OpenRefine reconciler, the csid resolver, the
graph query routes, the canonical-TSV and entity-grounding exporters. Nothing in the
capability-bus surface resolves, reconciles, or queries anything itself; it exists so a peer
project can *discover* those surfaces in KCB terms and dial them directly.

## The manifest

| | |
|---|---|
| Source of truth | `shared/capability-manifest.json` (typed accessors: `shared/capability-manifest.ts`) |
| Identity | `pinakes:agent:resolver` → `https://id.koine.example/agent/pinakes/resolver` |
| KCB version | 0.2.0 (manifest revision `x_pinakes.manifestVersion` — bumped to `0.2.0` when the MCP/A2A fronts + signing landed) |
| Served at | `GET /.well-known/kcb-manifest.json`, `GET /api/kcb/manifest` |
| Invocation fronts | `endpoints.mcp` = `/mcp` (MCP tools), `endpoints.a2a` = `/.well-known/agent-card.json` (A2A agent-card), `endpoints.http` = `/api/kcb` (plain HTTP) |

A capability provider is itself a fabric entity (KCB §2), so `pinakes:agent:resolver` is a KINP
agent id and can be grounded and reasoned about like any other node.

### Ports

`produces` — two **knowledge** ports, both `dialect: grounding-only` and scoped to the world
`pinakes:world:consensus-reality` (KINP §5's default world for real-world knowledge):

| Shape | Emitted by |
|---|---|
| `canonical-tsv` | `scripts/export-for-culturescrape.ts` — the typed, csid-keyed node/edge TSV bundle |
| `grounding-pack` | `scripts/export-entity-grounding.ts` — the entity-grounding pack in the KGP §2 envelope ([`docs/grounding-pack.md`](grounding-pack.md)) |

…plus one **entity** port: the canonical csid namespace. Its `types` list is *total* over
`shared/canonical-schema.json` `nodeTypes` — `assertValidCapabilityManifest` fails if a
canonical node type is added without being published here, because an entity that is not on
the port is an entity nobody on the bus can discover.

`consumes` — grounding-only knowledge from peer producers (Analyzer extraction deltas, Insimul
world facts downshifted for export) and entity references to resolve. Inbound knowledge lands
in the contribution review queue, never as a live write — the KCB §5 merge-review linkage.

### Capabilities

| Capability | Grant | Primary surface | Implemented by (already merged) |
|---|---|---|---|
| `resolve` | `invoke:resolve` | `GET /api/graph/resolve` | `server/services/graph-resolver.ts` |
| `reconcile` | `invoke:reconcile` | `POST /api/scraping/culturescrape` | `core/src/culturescrape/schema/reconcile.py` |
| `query` | `invoke:query` | `POST /api/graph/datalog` | `server/routes/graph.ts`, `server/services/graph-store.ts` |

Each capability carries an `x_surfaces` array — every built route behind it, first entry
primary. `GET /api/kcb/capabilities` returns that directory in invocation-ready form.

### Invocation fronts — MCP and A2A

KCB §4 names two ways to *invoke* a capability beyond plain HTTP, and Pinakes stands up both
as thin wrappers over the same `x_surfaces`:

| Front | Endpoint | Built by | What it exposes |
|---|---|---|---|
| **MCP** | `endpoints.mcp` = `/mcp` | `server/routes/mcp.ts` (`@modelcontextprotocol/sdk`) | The three capabilities as MCP tools (`resolve`/`reconcile`/`query`); `list_tools` = KCB describe, `CallTool` forwards to the built surface, a down backend degrades to an MCP tool error. |
| **A2A** | `endpoints.a2a` = `/.well-known/agent-card.json` | `server/routes/a2a.ts` (`@a2a-js/sdk`) | An A2A AgentCard advertising the three capabilities as skills; the whole KCB §2 manifest rides as a `https://koine.dev/kcb/manifest/0.3` AgentCard extension, so a crawler pulling only the card recovers the manifest and the MCP tools url. |

Both are authored as **server-relative paths** (validated: a non-null `endpoints.mcp`/`.a2a`
must lead with `/`) and are absolutized against the serving/publishing origin exactly like
`http`/`manifest`, so a registry entry lists dialable URLs for every front. Either may be
`null` until stood up.

## Signing (KCB §5)

The served and published manifest is **signed** so a consumer can attribute its provenance
(KCB §5 / KINP §7 `prov.agent`). Ed25519 lives in `server/services/manifest-signing.ts` (it
needs `node:crypto`, so it stays in `server/`, not client-safe `shared/`; the `signature` field
slot + the canonical serializer stay in `shared/`, mirroring `shared/kgp.ts`'s hasher injection).

- The signature is Ed25519 over the canonical serialization of the manifest **with the
  `signature` field excluded** (`{key_id, alg}` only), so the signed bytes bind the key id and
  algorithm yet the signature never signs its own value. `verifyManifestSignature(manifest,
  publicKey)` re-derives the same bytes and returns `false` (never throws) on any tamper.
- **Optional-env degrade** (same shape as `GEONAMES_USERNAME` / `KCB_REGISTRY_URL`): with no
  key configured the manifest is served unsigned (`signing.key_id: null`) and nothing throws —
  KCB §5 signing is a SHOULD, not a MUST. `GET /api/kcb/status` reports `signed: true` once a
  key is configured.

| Env var | Default | Meaning |
|---|---|---|
| `PINAKES_SIGNING_PRIVATE_KEY` | unset | PEM (or base64-DER PKCS8) Ed25519 private key. Unset ⇒ served unsigned. |
| `PINAKES_SIGNING_KEY_ID` | derived | `signing.key_id` to publish. Unset ⇒ derived from the public-key fingerprint (`ed25519:<hash>`) so a configured key always has a stable, non-empty id. |

## The registry is a cache, never a dependency

KCB §3 makes the discovery registry an index over the providers' own surfaces
(*"a provider's manifest is authoritative; the registry just makes it findable"*), and
ADR-0001 makes it route-by-lookup rather than proxy — peers connect **directly** to Pinakes
once they hold its address. Pinakes implements that literally:

- `server/services/capability-registry.ts` pushes the manifest to `KCB_REGISTRY_URL` once at
  startup, **best-effort**. It never throws; an absent, unreachable, or rejecting registry
  resolves to `registered: false` with the reason.
- Registration never gates serving. The manifest and the capability directory answer whether
  or not the push succeeded, and the capabilities are invoked at their own endpoints either
  way. `GET /api/kcb/status` reports the registration outcome alongside
  `servingDirectly: true`.

So the failure mode of a registry outage is "discovery falls back from *ask the registry* to
*read the provider*", not "Pinakes is off the bus".

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `KCB_REGISTRY_URL` | unset | Discovery registry base. Unset ⇒ no push at all (serving is unaffected). |
| `KCB_REGISTRY_TIMEOUT_MS` | `5000` | Publish timeout. |
| `PINAKES_PUBLIC_ORIGIN` | unset | Origin peers dial back on. Unset ⇒ the manifest is absolutized against the requesting origin. |

Endpoints and surfaces are absolutized against that origin when the manifest is served or
published, so a registry entry is directly dialable; a same-origin client asking for the
as-authored document gets server-relative paths.

## Not yet built

- **Grant enforcement.** `auth.grants_required` fixes the grant *shape* only; issuance,
  rotation, and spend ceilings live in Cuneiform's workforce governance (KCB §5). Pinakes's
  own HTTP surfaces keep enforcing `server/services/api-auth.ts` until a grant issuer exists.
- **`subscribe` / `fetch` verbs.** Only `describe` (the manifest) and `invoke` (the built
  endpoints) are surfaced. KGP §6 delta subscriptions come with the grounding-pack work.
