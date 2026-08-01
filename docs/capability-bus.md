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
| KCB version | 0.2.0 (manifest revision `x_pinakes.manifestVersion` — `0.2.0` when the MCP/A2A fronts + signing landed, `0.3.0` when the specialized KFT `finetune` capability joined) |
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

`consumes` — grounding-only knowledge from peer producers (media-analysis extraction deltas,
Insimul world facts downshifted for export) and entity references to resolve. Inbound knowledge lands
in the contribution review queue, never as a live write — the KCB §5 merge-review linkage.

### Capabilities

| Capability | Grant | Primary surface | Implemented by (already merged) |
|---|---|---|---|
| `resolve` | `invoke:resolve` | `GET /api/graph/resolve` | `server/services/graph-resolver.ts` |
| `reconcile` | `invoke:reconcile` | `POST /api/scraping/culturescrape` | `core/src/culturescrape/schema/reconcile.py` |
| `query` | `invoke:query` | `POST /api/graph/datalog` | `server/routes/graph.ts`, `server/services/graph-store.ts` |
| `finetune` | `invoke:finetune` | MCP tools `finetune` / `finetune_subscribe` (`POST /mcp`) | `ml/src/pinakes_ml/train_slm.py` (+ `kft.py`/`kft_run.py`), fronted by `server/services/finetune-provider.ts` |

Each capability carries an `x_surfaces` array — every built route behind it, first entry
primary. `GET /api/kcb/capabilities` returns that directory in invocation-ready form.

### `finetune` — the specialized, local-only KFT provider

`koine/specs/fine-tuning.md` (KFT) is deliberately **multi-provider** (§9, FT-K): agora hosts
the *general* trainer and Pinakes runs its **own narrow** provider over the already-built `ml/`
QLoRA pipeline. Both accept `text-generation`, so the manifest carries the tiebreak signal
explicitly, in `x_specialization`:

| Field | Value | Why |
|---|---|---|
| `provider_class` | `specialized` | KCB §3 prefers the more specialized matching provider (FT-K). |
| `modality` / `methods` | `text-generation` / `sft`, `lora`, `qlora` | Exactly what `ml/src/pinakes_ml/kft.py` admits — advertising wider would route jobs here that admission then refuses. |
| `egress` | `local-only` | The SLM corpora are `synthetic`/`proprietary`/`personal` tier, so the §4.2 gate resolves local-only and a cross-boundary `compute.class` is **refused with a report** before any compute. |
| `domains` | `slm-rule-authoring`, `neurosymbolic` | What the provider is specialized *for* — the routing signal. |
| `general_provider` | `agora:agent:trainer` | Where a non-matching job belongs. |

Ports span three planes (KFT §2): a KINP `model` entity in (`base-model`) plus a
`grounding-only` knowledge training-set port; a KINP `model` entity out
(`finetuned-model`) plus the **only media port Pinakes publishes** — the KMI weight/export
assets (`application/vnd.koine.model+safetensors`, `…+gguf`, KFT §5.3). `cost` is metered in
`gpu-seconds` so a caller can gate spend *before* invoking (KFT §7).

`model` is a KINP entity type from koine's `registry/entity-types.tsv`, **not** a canonical
csid node type, so it is allowlisted in `KINP_ENTITY_TYPES` rather than resolved through
`canonical-schema.json`. `assertValidCapabilityManifest` enforces every row of that table plus
the port shape — the advertisement cannot drift from what `ml/` admits without failing the gate.

**The surface is a wrapper, like every other one here.** `server/services/finetune-provider.ts`
shells out to the already-built console script

```sh
uv run --project ml pinakes-train-slm --kft-job <manifest> --output-dir <run> --no-mlflow --no-doc
```

and reads back what it writes: `kft-telemetry.jsonl` (the KFT §6 training-telemetry stream) and
`kft-run.json` (the §5 minted model + weight assets). No training logic exists on the TS side;
`ml/` stays the sole trainer and the sole admission gate. The runner's exit codes are the
contract — **0** ran, **2** refused at admission with a machine-readable report on stdout (no
compute committed), anything else the runner itself is unusable.

`finetune` and `finetune_subscribe` are KFT §6's async pair: `invoke` returns a run handle
immediately, `subscribe` streams the telemetry to the terminal event (which carries the minted
model entity id and its weight asset ids). Events are addressed by
`eventId` = `<job>#<kind>:<step>` and are idempotent under redelivery, so a reconnecting
consumer may replay from any index.

| Env var | Default | Meaning |
|---|---|---|
| `PINAKES_FINETUNE_ENABLED` | on | `0`/`false` ⇒ the capability is still **advertised** but an invoke answers with an actionable error. |
| `PINAKES_ML_DIR` | `<repo>/ml` | The uv workspace the console script lives in. |
| `PINAKES_FINETUNE_UV` | `uv` | The uv binary. Missing ⇒ an actionable "runner unreachable" error, never a crash. |
| `PINAKES_FINETUNE_STUB` | off | Default `--stub` (the injectable model seam — the whole pipeline, no training stack, no GPU). |
| `PINAKES_FINETUNE_ARTIFACTS` | `ml/artifacts/kcb` | Where run dirs are created (git-ignored). |

Degrade is the `GEONAMES_USERNAME` shape: the heavy `trl`/`peft`/`accelerate` stack is
deliberately **undeclared** in `ml/` (see `ml/CLAUDE.md`), so with it absent the capability
stays on the manifest and in `list_tools`, and only the invoke returns the
`require_finetune_deps` install message.

### Multi-provider routing (KFT §8/§9, FT-K)

Fine-tuning is deliberately **not single-home**. FT-K states the tiebreak the discovery
registry applies when more than one provider matches a job: prefer the more **specialized**
matching provider, then lower `cost` (KCB §3); a job MAY name a target provider explicitly;
an unbroken tie is **surfaced to the caller**, not resolved silently.

That registry is agora's, not ours. `server/services/finetune-routing.ts` is the **provider
side** of the contract — a pure, executable reading of the rule that proves Pinakes's
advertisement carries enough signal to be routed to correctly, and goes red if the manifest
ever widens past what `ml/src/pinakes_ml/kft.py` admits. It keeps two things apart that are
easy to conflate:

- **Admissibility** — would this provider refuse the job at the door? The rejection codes are
  `kft.py`'s own (`unsupported-modality` / `unsupported-method` / `unsupported-dataset-plane`),
  so a refusal at routing reads the same as a refusal at admission.
- **Preference** — of the providers that *would* accept, which should the registry pick? A
  narrow provider with no matching signal ranks `fallback`: it would run the job, but the
  general trainer should get it. That is how a generic `text-generation` job is left to agora
  without ever claiming Pinakes would have refused it — and why an explicit target of Pinakes
  is still honoured for such a job.

**Where the signal comes from.** `finetune-job.schema.json` (KFT 0.3.0) is
`additionalProperties: false` and has no `domain` or `provider` field, so a job states its
specialization through its *data*: the dataset's `header.datasetKind` (koine's
`dataset-jsonl-header` — `rule-sft`, `lore-qa`, …), which `DATASET_KIND_DOMAINS` maps onto the
`x_specialization.domains` vocabulary. FT-K's explicit target likewise has no home in the
schema, so it rides **out of band** on the invoke envelope rather than being smuggled in as an
unknown key (which admission would reject). Both are worth proposing upstream as KFT §3
additions.

#### The sibling providers — recorded here, built elsewhere

Per the koine program map (`koine/tasks/chief/README.md`, Tranche D), ratifying KFT handed
three runtime tasklists to three repos. **Only the Pinakes one is built here**; the other two
are named so a reader of this document knows what is deliberately missing rather than lost:

| Tasklist | Repo | Role | Status here |
|---|---|---|---|
| `90-finetune-trainer` | **agora** | The **general** `finetune` provider — engine ladder LLaMA-Factory / Unsloth / Axolotl / diffusers, SkyPilot placement under the §4.2 egress gate, **cloud-capable**. | Not built here. Stubbed as a fixture manifest in `server/services/finetune-routing.test.ts`; named on our manifest as `x_specialization.general_provider`. |
| `90-finetune-provider` | **pinakes** | This provider — the `ml/` TRL+PEFT SLM path, **local-only** by data tier. | This repo. |
| `90-finetune-client` | **orchestrator** | The KCB **client** that replaces `Runner::Stub` — discover → invoke → **subscribe** to the real §6 telemetry (deleting its fabricated loss curve), un-404 export (§5.3) and the registry (§8), and issue `invoke:finetune` grants (§7). | Not built here. It is the caller of the surface described above; Pinakes serves it, does not implement it. |

The two legs are **complements, not competitors**: agora's trainer can burst to rented GPU,
Pinakes's cannot and refuses to try (§4.2). A job over `synthetic`/`proprietary`/`personal`
data routes here and never leaves the tier; a generic or multimodal job routes there.

### Invocation fronts — MCP and A2A

KCB §4 names two ways to *invoke* a capability beyond plain HTTP, and Pinakes stands up both
as thin wrappers over the same `x_surfaces`:

| Front | Endpoint | Built by | What it exposes |
|---|---|---|---|
| **MCP** | `endpoints.mcp` = `/mcp` | `server/routes/mcp.ts` (`@modelcontextprotocol/sdk`) | Every capability as an MCP tool (`resolve`/`reconcile`/`query`, plus `finetune`/`finetune_subscribe`); `list_tools` = KCB describe, `CallTool` forwards to the built surface, a down backend degrades to an MCP tool error. |
| **A2A** | `endpoints.a2a` = `/.well-known/agent-card.json` | `server/routes/a2a.ts` (`@a2a-js/sdk`) | An A2A AgentCard advertising every capability as a skill (tags carry the `x_specialization` signal, so an FT-K tiebreak is readable from the card alone); the whole KCB §2 manifest rides as a `https://koine.dev/kcb/manifest/0.3` AgentCard extension, so a crawler pulling only the card recovers the manifest and the MCP tools url. |

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
  rotation, and spend ceilings live in the orchestrator's workforce governance (KCB §5). Pinakes's
  own HTTP surfaces keep enforcing `server/services/api-auth.ts` until a grant issuer exists.
- **KGP `subscribe` / `fetch` verbs.** `subscribe` exists only for `finetune` (the KFT §6
  telemetry stream). For the knowledge ports, only `describe` (the manifest) and `invoke` (the
  built endpoints) are surfaced; KGP §6 delta subscriptions come with the grounding-pack work.
- **Grant-gated spend ceilings for `finetune`.** `cost.meter`/`est_units` publish the figure a
  caller gates on (KFT §7), but Pinakes does not yet check a `budget_units` ceiling at admission
  — that needs the grant issuer above.
