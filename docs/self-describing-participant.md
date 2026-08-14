# Pinakes as a self-describing koine participant

Koine has no central config store. A participant publishes everything a peer needs in order to
trust and dial it **from its own repository and its own endpoints**
(`koine/docs/self-describing-participant.md`, ADR-0007) — nothing registers Pinakes on its
behalf, and no peer reads a config file out of this tree.

The consequence, and the claim this document makes: **Pinakes needs koine and agora to
participate, and nothing else.**

| | Supplies | Owns nothing of ours |
|---|---|---|
| **koine** | the *spec* — the KINP/KCB/KGP/KFT documents, the shared relation registry, and the JSON Schemas the shapes here validate against | it holds no Pinakes config; the registry mirror is re-vendored into this repo, never read live |
| **agora** | the *runtime* — the discovery registry a crawler populates, and the general KFT trainer the specialized one defers to | discovery is an index, never an authority: with every registry down, a peer that dials this deployment directly still gets the whole self-description |
| **pinakes** (this repo) | the participant's own four facets, below | — |

There is no third source. A deployment that has this checkout and can serve HTTP is a complete,
dialable participant.

## The four facets, and where each lives

| Facet | Where it lives | Enforced by |
|---|---|---|
| **Identity** — the `pinakes` namespace, sole minting authority for it, the kinds minted under it, the external authorities anchored to | [`contracts/participant.json`](../contracts/participant.json) `identity`; the id scheme itself is [`docs/canonical-schema.md`](canonical-schema.md) §3/§3.1 | `assertValidParticipant` |
| **Capability** — the served AgentCard and its `https://w3id.org/koine/kcb/manifest/0.3` extension | [`contracts/capability-manifest.json`](../contracts/capability-manifest.json), served by `server/routes/{a2a,capability-bus}.ts` — full contract in [`docs/capability-bus.md`](capability-bus.md) | `assertValidCapabilityManifest` |
| **Egress** — which record classes may leave, the licence allowlist, and the `grounding-only` dialect every knowledge port emits | [`contracts/egress-policy.json`](../contracts/egress-policy.json) | `assertValidEgressPolicy` |
| **Translation** — the bridge mappings, with per-entry dialect, egress and id-space rules | [`contracts/bridge-insimul.json`](../contracts/bridge-insimul.json) (Pinakes's own, for the one all-public integration) over [`contracts/predicate-mapping.json`](../contracts/predicate-mapping.json) (a re-vendored mirror of koine's registry — a mapping coins no relation name) | `assertValidBridgeMapping`, `assertValidPredicateMapping` |

### Identity, namespace, minting authority

`contracts/participant.json` declares the participant id `pinakes:agent:resolver`, the `pinakes`
namespace, and `minting_authority: true` — Pinakes is the **sole** authority for that prefix,
minting the kinds `ent` / `world` / `agent` / `model`. `wikidata`, `getty` and `pleiades` are
declared as **anchors**, authorities Pinakes references but never mints into (KINP §4.4). The
local-id scheme those ids are built from is `docs/canonical-schema.md` §3, and minting is
offline-first (KINP §6): nothing is asked of a peer, and a pre-reconciliation row carries a
`pinakes:local` provisional id until Wikidata reconciliation stamps a QID.

### Egress policy

`contracts/egress-policy.json` is the **source of truth** for what may leave and in what
dialect, not a restatement of it: `capability-manifest.ts` validates every published knowledge
port against `knowledgeDialect` (`grounding-only`), and `kgp.ts` takes its `DEFAULT_DIALECT`
from the same field. Four record classes are classified — the canonical corpus and entity
grounding packs are `exportable`; the contribution queue and the SLM training corpora are
`local-only` — under a CC0 + CC-BY licence allowlist, enforced at pack construction. Per-*relation*
egress is not duplicated here; the policy points at the `predicate-mapping.json` mirror that
carries it per entry.

### Public bridge mappings

`contracts/bridge-insimul.json` is Pinakes's own mapping for the pinakes↔insimul bridge —
grounding packs and world seeds out, converted worlds and the datasets distilled from them back —
versioned beside the code that performs the crossing (`scripts/export-insimul-pack.ts` and
`engine/src/pinakes_engine/acquire/insimul.py`). It resolves every canonical type against
`contracts/canonical-schema.json` and reads its predicates *through* the vendored registry, so
it restates no vocabulary of its own.

**Only all-public bridges live here, and a non-public far endpoint is absent rather than
redacted** (`assertPublicBridge`) — a redacted section still discloses the shape of what it
hides. So the set of `contracts/bridge-*.json` files *is* the set of public integrations, and
there is no external file holding the rest.

## What a peer actually does

| Step | Surface |
|---|---|
| **discover** | a registry crawl (agora), *or* a direct fetch — the registry is optional by design |
| **describe** | `GET /.well-known/agent-card.json` (the A2A card; the whole KCB manifest rides as one extension) or `GET /.well-known/kcb-manifest.json` (the same payload standalone) |
| **invoke** | the MCP tools at `/mcp`, an A2A skill, or the plain HTTP endpoints each capability's `x_surfaces` names |
| **verify** | the manifest's `signing.key_id`, when a deployment configures a signing key |

Both well-known documents are served straight from the in-repo sources — with no configured
origin and no signing key, `/.well-known/kcb-manifest.json` is byte-identical to
`contracts/capability-manifest.json`. The declaration and the bridge mappings are not separate
HTTP surfaces: they are source documents that ship with the repository, and every pointer they
carry is repo-relative.

## How the claim is kept true

| Check | Where |
|---|---|
| the declaration is well-formed against koine's convention | `assertValidParticipant` (`contracts/participant.test.ts`) |
| it agrees with what is actually published — identity, namespace, kinds, both pointers, the served MCP/A2A fronts, every port's dialect | `assertParticipantManifestAgreement` |
| it validates against koine's own `schemas/participant-self-description.schema.json` | `contracts/participant.test.ts`, when a sibling koine checkout is present (`KOINE_ROOT`, else `~/Development/koine`) — skipped when it is not |
| the bridge mapping resolves against the in-repo schema + registry, and every referenced canonical type exists | `assertValidBridgeMapping` (`contracts/bridge-insimul.test.ts`) |
| the well-known fronts serve the in-repo documents, every declared pointer resolves in-repo, and **no module on the participation path reads outside this repo** | `server/routes/participation-self-sufficiency.test.ts` |

That last one is the executable form of the claim at the top. It walks the static import closure
of the two served fronts plus the two source documents and scans every module in it for the ways
a file could reach out — a sibling-checkout env var, `homedir()`, an absolute path literal, the
filesystem at all — then runs the same grep repo-wide so the handful of files that *do* read a
sibling checkout are enumerated with a reason and shown to be off that path. Today there are
three, none of them participation config:

- `contracts/koine-schema.ts` — test support; validates our documents against koine's schemas
  when a checkout is beside us, skipped when it is not.
- `server/services/finetune-provider.ts` — dispatches a KFT job to the lugh trainer. Capability
  *invocation*, and a deliberately transitional wrapper ([`docs/LUGH-EXTRACTION-PLAN.md`](LUGH-EXTRACTION-PLAN.md)).
- `scripts/regen-registry-mirror.ts` — the hand-run re-vendor tool. It reads koine in order to
  **write** the in-repo mirror, precisely so that serving never has to.

The scan reads code, not prose: comments are stripped first, because a doc comment naming
`KOINE_ROOT` reads no config. Documenting the escape hatch is how a reader learns it exists;
using it on this path is what would break the claim.

## The rule underneath all of it

**No participant reads another participant's repository.** Every pointer in the declaration is
relative to this repo's root, and both `assertValidParticipant` and `assertValidBridgeMapping`
reject one that is absolute or climbs out — a shared-checkout dependency wearing a pointer's
clothes is the exact failure the convention exists to prevent.
