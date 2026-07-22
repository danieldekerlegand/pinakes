# Pinakes on the KGP knowledge plane (grounding packs)

`koine/specs/grounding-pack.md` §8 names Pinakes **producer + authority** on the Koine
knowledge data plane: *"Emits `grounding-only`/`horn-safe` snapshots + deltas of consensus
reality."* This document describes the pack Pinakes emits and the two normative rules it
implements.

**This is a retarget, not a new exporter.** `scripts/export-entity-grounding.ts` was built
and merged for the Analyzer bridge (`the media-bridge mapping spec` §4.2, commit `17f0713`); US-PKA3
wrapped its existing payload in the KGP envelope. The entity records — csid, entity type,
aliases, reconciliation keys, provenance, SPDX licence — are **byte-for-byte the same
content**; what changed is the envelope around them, and the assertions minted from the
reconciliation keys they already carried.

## The pack

| | |
|---|---|
| Emitted by | `scripts/export-entity-grounding.ts` (`npm run entity-grounding`) |
| Contract module | `shared/kgp.ts` (claim + pack normalization; typed by `shared/kgp.test.ts`) |
| Live output | `export/culturescrape/entity-grounding/snapshot.json` (gitignored) |
| Committed fixture | `scripts/data/entity-grounding-snapshot.json` (from `scripts/data/entity-grounding-fixture/`) |
| KGP version | 0.4.0 |

```jsonc
{
  "kgp_version": "0.4.0",
  "pack_id": "sha256-073a9b…",                    // content address (§2.1)
  "producer": "pinakes",                          // KINP namespace
  "worlds":   ["pinakes:world:consensus-reality"], // KINP §5 — real-world consensus reality
  "kind":     "snapshot",                          // "snapshot" | "delta"  (§6)
  "basis":    null,                                // a delta names the pack it applies against
  "dialect":  "grounding-only",                    // portability tier (§5)

  "contractVersion": "2.0.0",                      // the pinakes envelope a consumer pins
  "generatedAt": "…", "source": "pinakes",
  "licenseClasses": ["CC0", "CC-BY"], "domains": [], "count": 3,

  "entities":   [ /* unchanged: csid, entityType, name, aliases, reconciliation, provenance, license */ ],
  "assertions": [ /* one exact_match anchor per QID-bearing entity, claim-id-sorted */ ],
  "links":      [],
  "manifest":   { "counts": {…}, "created": "…", "signing": {…}, "license_policy": {…} }
}
```

`contractVersion` went **1.0.0 → 2.0.0**: the envelope is a breaking change for a consumer
that pinned the old one, the entity records are not.

## Assertions are the reconciliation anchors

Each QID-bearing entity yields one claim:

```
exact_match(pinakes:ent:language.q150, wikidata:ent:Q150)  @ pinakes:world:consensus-reality
```

- **`exact_match`** comes from the shared relation registry (koine `registry/relations.tsv`,
  vendored as `KGP_CORE_RELATIONS` so pinakes can mint conformant ids offline). It is
  `grounding-only` tier, so it may travel in a `grounding-only` pack;
  `assertRelationAllowed` refuses to put a `horn-safe` relation (`part_of`, `located_in`, …)
  in one.
- **The subject is the csid as a KINP entity CURIE** — `cs:language:Q150` →
  `pinakes:ent:language.q150`, derived exactly as [§3.1 of the canonical-schema
  doc](canonical-schema.md) specifies. The verbatim `csid` still travels on the entity
  record, because that derivation is one-way by design.
- **The object keeps Wikidata's own case** (`wikidata:ent:Q150`): KGP §3.2 rule 3 lowercases
  the namespace and kind of a CURIE, never an external authority's local id.
- **`links` stays empty.** KINP's reserved equivalence/lifecycle relations
  (`same_as`/`based_on`/`retracts`/…) are what a pack's `links` carry; an external-authority
  anchor is not one of them, and a snapshot retracts nothing.

### Claim ids (KGP §3, NORMATIVE)

`claim_id = "sha256-" · lowerhex(SHA-256(world · "|" · relation · "(" · args · ")"))`, with
symmetric relations sorting their operands so `exact_match(a,b)` and `exact_match(b,a)` are
one claim. Confidence, provenance and licence are **excluded from the hash** — that is the
whole point: the same anchor asserted by Analyzer or Insimul mints the *same* claim id and
merges, while both provenance records survive. `shared/kgp.ts` implements the rule set
(identifier args, string/integer/decimal/boolean/datetime literals) and
`shared/kgp.test.ts` pins it.

## Determinism

- Entities are csid-sorted, assertions claim-id-sorted, neither carries a wall-clock.
- `pack_id` hashes the identity-bearing manifest ⊕ the id-sorted contents, **excluding
  `manifest.created` and `manifest.signing`** — emission metadata, the same way §3.1 excludes
  `prov` from a claim id. So the same corpus exported twice yields the same `pack_id`, and a
  changed entity set, filter, world, kind or dialect yields a different one.
- The committed fixture pack pins the whole shape; regenerate it with
  `npm run entity-grounding -- --emit-fixture` after any change and a test asserts it is in
  sync.

## Licence policy (KGP §7.1)

The `--license-classes CC0,CC-BY` filter (SPDX *families*, version-independent) is applied
per record **and** republished as `manifest.license_policy`, so a consumer can see what was
admitted rather than inferring it:

| pinakes SPDX family | KGP §7.1 class |
|---|---|
| `CC0` | `public-domain` |
| `CC-BY` | `attribution` |
| `CC-BY-SA` | `share-alike` |
| `CC-BY-NC*` | `non-commercial` |
| `MIT`/`Apache`/`BSD`/… | `permissive` |
| anything else | `proprietary` |

KGP 0.3.0 adopted this policy **from** pinakes/insimul (ADR-0002 reverse flow), so this is a
name alignment, not a second policy: the default `CC0`+`CC-BY` filter is exactly the spec's
default allowlist minus the permissive families this corpus does not carry. `on_violation`
is `reject-with-report` — a consumer rejects an out-of-policy record with a report, never
silently drops it.

## Snapshot vs delta (KGP §6)

`kind`/`basis` are enforced, not decorative: a delta must name the `basis` pack id it
applies against, and a snapshot must not carry one (`buildGroundingPack` throws either way).
The exporter emits **snapshots** today; delta production (diffing two packs and emitting
`retracts`/`supersedes` lifecycle links) is the follow-up that makes the subscription
direction of §6 real, and it is a producer-side change only — the envelope already carries
the fields.

## Related

- [`docs/capability-bus.md`](capability-bus.md) — the KCB manifest that publishes this pack
  as a `grounding-pack` knowledge port on `pinakes:world:consensus-reality`.
- [`docs/canonical-schema.md`](canonical-schema.md) §3.1 — `csid` as a KINP entity CURIE.
- `the media-bridge mapping spec` §4.2 — the consumer this pack was originally built for.
