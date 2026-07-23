/**
 * Re-vendor the koine relation registry into pinakes — deterministically (US-1,
 * 40-registry-mirror-autoregen).
 *
 * Pinakes keeps TWO on-disk mirrors of koine's authoritative registry, and both used to
 * drift silently when koine bumped `registryVersion`:
 *
 *   1. `shared/predicate-mapping.json` — a byte copy of koine
 *      `registry/predicate-mapping.json` (the file declares this in its own
 *      `canonicalHome`/`mirrors` blocks), historically kept in sync by a MANUAL `cp`;
 *   2. the vendored relation vocabulary in `shared/kgp.ts` (`KGP_CORE_RELATIONS` +
 *      `KGP_DOMAIN_RELATIONS`) — a second, hand-transcribed mirror of koine
 *      `registry/relations.tsv` + `registry/relations/{cinematography,media,social}.tsv`.
 *
 * This script regenerates BOTH from the koine checkout so they can no longer diverge.
 * The koine registry is the sole authority (koine ADR-0001/ADR-0002): a correction is
 * upstreamed there, `registryVersion` bumped, then re-vendored — never hand-edited here.
 *
 * Pure core (`parseRelationsTsv` / `renderEntries` / `regenerateKgpSource` / `buildRegen`)
 * over the koine sources + a thin `writeRegen`/`runRegen` fs wrapper, the same shape as
 * the other `scripts/` tooling — so a test drives the transforms with fixtures.
 *
 * Run: `npm run regen:registry-mirror` (or `npx tsx scripts/regen-registry-mirror.ts`).
 * Resolves the koine checkout from `KOINE_ROOT`, else `~/Development/koine` — the SAME
 * resolution `shared/predicate-mapping.test.ts` uses.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The koine checkout holding the authoritative registry (`KOINE_ROOT` overrides). */
export const DEFAULT_KOINE_ROOT = join(homedir(), "Development", "koine");

/** Resolve the koine checkout exactly as `shared/predicate-mapping.test.ts` does. */
export function resolveKoineRoot(): string {
  return process.env.KOINE_ROOT ?? DEFAULT_KOINE_ROOT;
}

/** The authoritative JSON mirror inside koine. */
export const KOINE_REGISTRY_REL = "registry/predicate-mapping.json";
/** The core (unqualified) relation vocabulary inside koine. */
export const KOINE_CORE_TSV_REL = "registry/relations.tsv";
/** The domain-extension TSVs pinakes speaks, in vocabulary (vendored) order. */
export const KOINE_DOMAIN_TSV_RELS: readonly string[] = [
  "registry/relations/cinematography.tsv",
  "registry/relations/media.tsv",
  "registry/relations/social.tsv",
];

/** Every koine source file this script reads — the five that feed the two mirrors. */
export const KOINE_SOURCE_RELS: readonly string[] = [
  KOINE_REGISTRY_REL,
  KOINE_CORE_TSV_REL,
  ...KOINE_DOMAIN_TSV_RELS,
];

/** Repo-relative paths of the two mirrors this script regenerates. */
export const KGP_PATH = resolve(import.meta.dirname, "..", "shared", "kgp.ts");
export const PREDICATE_MAPPING_PATH = resolve(
  import.meta.dirname,
  "..",
  "shared",
  "predicate-mapping.json",
);

// The marker-delimited generated blocks inside `shared/kgp.ts`. The script replaces the
// text BETWEEN each begin/end pair; everything else in the file (JSDoc, the const
// declarations, the accessors) is hand-authored and preserved verbatim.
export const CORE_BEGIN =
  "  // @generated:begin core-relations - koine registry/relations.tsv - regen: npm run regen:registry-mirror; do not hand-edit";
export const CORE_END = "  // @generated:end core-relations";
export const DOMAIN_BEGIN =
  "  // @generated:begin domain-relations - koine registry/relations/{cinematography,media,social}.tsv - regen: npm run regen:registry-mirror; do not hand-edit";
export const DOMAIN_END = "  // @generated:end domain-relations";

/** The three dialect tiers a relation may declare (koine registry `signaturePolicy`). */
const DIALECT_TIERS = new Set(["grounding-only", "horn-safe", "full-prolog"]);

/** A parsed registry relation: its qualified name + immutable signature. */
export interface RelationEntry {
  readonly name: string;
  readonly signature: {
    readonly arity: number;
    readonly argRoles: readonly string[];
    readonly symmetric: boolean;
    readonly tier: string;
  };
}

/**
 * The qualified relation name: a core row keeps its unqualified name; a domain row is
 * prefixed with the TSV's `domain` column — NOT the file stem
 * (`relations/cinematography.tsv` declares `cine:`, so its rows key on `cine:`).
 */
function relationKey(relation: string, domain: string, core: boolean): string {
  if (core) return relation;
  const local = relation.includes(":") ? relation.slice(relation.indexOf(":") + 1) : relation;
  return `${domain}:${local}`;
}

/**
 * Parse a koine relations TSV (`relation / arity / arg_roles / symmetric / tier / domain
 * / inverse / description`) into ordered {@link RelationEntry} rows. `arg_roles` is
 * pipe-split into the ordered `argRoles`; `symmetric`/`tier` are typed. `core` selects the
 * unqualified vs domain-prefixed naming rule.
 */
export function parseRelationsTsv(text: string, opts: { core: boolean }): RelationEntry[] {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("regen-registry-mirror: empty relations TSV");
  const header = lines[0].split("\t");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`regen-registry-mirror: relations TSV is missing the '${name}' column`);
    return i;
  };
  const iRelation = col("relation");
  const iArity = col("arity");
  const iRoles = col("arg_roles");
  const iSymmetric = col("symmetric");
  const iTier = col("tier");
  const iDomain = col("domain");

  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const relation = cells[iRelation];
    const arity = Number(cells[iArity]);
    if (!Number.isInteger(arity) || arity < 1) {
      throw new Error(`regen-registry-mirror: relation '${relation}' has non-integer arity '${cells[iArity]}'`);
    }
    const symmetricCell = cells[iSymmetric];
    if (symmetricCell !== "true" && symmetricCell !== "false") {
      throw new Error(`regen-registry-mirror: relation '${relation}' has non-boolean symmetric '${symmetricCell}'`);
    }
    const tier = cells[iTier];
    if (!DIALECT_TIERS.has(tier)) {
      throw new Error(`regen-registry-mirror: relation '${relation}' has unknown tier '${tier}'`);
    }
    return {
      name: relationKey(relation, cells[iDomain], opts.core),
      signature: {
        arity,
        argRoles: cells[iRoles].split("|"),
        symmetric: symmetricCell === "true",
        tier,
      },
    };
  });
}

/** Render one signature object literal, byte-matching the hand-authored `kgp.ts` style. */
function renderSignature(signature: RelationEntry["signature"]): string {
  const roles = signature.argRoles.map((role) => JSON.stringify(role)).join(", ");
  return `{ arity: ${signature.arity}, argRoles: [${roles}], symmetric: ${signature.symmetric}, tier: ${JSON.stringify(signature.tier)} }`;
}

/** Render one `Record` entry line (`  key: { ... },`), quoting a key that isn't a bare id. */
function renderEntry(entry: RelationEntry): string {
  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry.name) ? entry.name : JSON.stringify(entry.name);
  return `  ${key}: ${renderSignature(entry.signature)},`;
}

/** Render a whole block body — the entry lines, in vocabulary order. */
export function renderEntries(entries: readonly RelationEntry[]): string {
  return entries.map(renderEntry).join("\n");
}

/** Replace the text between a begin/end marker pair with `body`, preserving the markers. */
function applyGeneratedBlock(source: string, begin: string, end: string, body: string): string {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end);
  if (start === -1 || stop === -1) {
    throw new Error(
      `regen-registry-mirror: generated marker ${start === -1 ? begin.trim() : end.trim()} not found in shared/kgp.ts`,
    );
  }
  return `${source.slice(0, start)}${begin}\n${body}\n${end}${source.slice(stop + end.length)}`;
}

/**
 * Regenerate the two marker-delimited vocabulary blocks in a `kgp.ts` source string from
 * the parsed koine entries. Pure — the caller supplies the current source.
 */
export function regenerateKgpSource(
  source: string,
  coreEntries: readonly RelationEntry[],
  domainEntries: readonly RelationEntry[],
): string {
  const withCore = applyGeneratedBlock(source, CORE_BEGIN, CORE_END, renderEntries(coreEntries));
  return applyGeneratedBlock(withCore, DOMAIN_BEGIN, DOMAIN_END, renderEntries(domainEntries));
}

/** Read a required koine source file, failing fast (naming the path + `KOINE_ROOT`) when absent. */
export function readKoineSource(koineRoot: string, relPath: string): string {
  const abs = join(koineRoot, relPath);
  if (!existsSync(abs)) {
    const isDefault = koineRoot === DEFAULT_KOINE_ROOT;
    throw new Error(
      `regen-registry-mirror: koine source file not found: ${abs}\n` +
        `Point KOINE_ROOT at your koine checkout (currently ${isDefault ? "the default " : ""}${koineRoot}). ` +
        `Both mirrors are regenerated from koine ${KOINE_REGISTRY_REL} + ${KOINE_CORE_TSV_REL} + registry/relations/<domain>.tsv — ` +
        `nothing was written (the mirror is never left one-sided).`,
    );
  }
  return readFileSync(abs, "utf8");
}

/** The regenerated content of both mirrors. */
export interface RegenOutput {
  /** The byte-for-byte koine `predicate-mapping.json`. */
  readonly predicateMappingJson: string;
  /** The regenerated `shared/kgp.ts` source. */
  readonly kgpSource: string;
}

/**
 * Read + validate ALL five koine sources, then regenerate both mirrors in memory. Every
 * read happens before any write in {@link writeRegen}, so a missing source aborts the run
 * without leaving a one-sided mirror (JSON updated without the TSV vocabulary, or v.v.).
 */
export function buildRegen(koineRoot: string = resolveKoineRoot()): RegenOutput {
  const predicateMappingJson = readKoineSource(koineRoot, KOINE_REGISTRY_REL);
  const coreTsv = readKoineSource(koineRoot, KOINE_CORE_TSV_REL);
  const domainTsvs = KOINE_DOMAIN_TSV_RELS.map((rel) => readKoineSource(koineRoot, rel));

  const coreEntries = parseRelationsTsv(coreTsv, { core: true });
  const domainEntries = domainTsvs.flatMap((tsv) => parseRelationsTsv(tsv, { core: false }));

  const kgpSource = regenerateKgpSource(readFileSync(KGP_PATH, "utf8"), coreEntries, domainEntries);
  return { predicateMappingJson, kgpSource };
}

/** Whether a regen would change each mirror (for the CLI summary + a `--check` mode). */
export interface RegenDiff {
  readonly jsonChanged: boolean;
  readonly kgpChanged: boolean;
}

/** Compute (but do not write) the diff a regen would produce against the vendored mirrors. */
export function diffRegen(koineRoot: string = resolveKoineRoot()): RegenDiff {
  const { predicateMappingJson, kgpSource } = buildRegen(koineRoot);
  const currentJson = existsSync(PREDICATE_MAPPING_PATH) ? readFileSync(PREDICATE_MAPPING_PATH, "utf8") : "";
  return {
    jsonChanged: currentJson !== predicateMappingJson,
    kgpChanged: readFileSync(KGP_PATH, "utf8") !== kgpSource,
  };
}

/** The one supported remedy every staleness message names — never "hand-edit the mirror". */
export const REGEN_REMEDY = "npm run regen:registry-mirror";

/** A minimal relation signature — the four immutable fields the registry `signaturePolicy` pins. */
interface SignatureLike {
  readonly arity: number;
  readonly argRoles: readonly string[];
  readonly symmetric: boolean;
  readonly tier: string;
}

/** One relation whose vendored `kgp.ts` signature disagrees with the live koine TSV. */
export interface SignatureDrift {
  /** The qualified relation name (`caused_by`, `cine:shows`, `soc:parent_of`, …). */
  readonly relation: string;
  /** What disagrees — missing / extra / arity / argRoles / symmetric / tier — human-readable. */
  readonly detail: string;
}

/**
 * Compare a vendored `kgp.ts` relation vocabulary (`KGP_CORE_RELATIONS` /
 * `KGP_DOMAIN_RELATIONS`) against the authoritative koine TSV entries, returning one
 * {@link SignatureDrift} per relation that is missing from the vendored copy, extra in it,
 * or disagrees on arity / ordered `argRoles` / symmetric / tier — the immutable-signature
 * policy of KGP §3.2 and the registry's `signaturePolicy` block. An empty result means the
 * mirror is in lockstep. Pure — the caller supplies both sides.
 */
export function diffVocabulary(
  vendored: Readonly<Record<string, SignatureLike>>,
  authoritative: readonly RelationEntry[],
): SignatureDrift[] {
  const drifts: SignatureDrift[] = [];
  const live = new Map(authoritative.map((entry) => [entry.name, entry.signature]));
  for (const entry of authoritative) {
    const have = vendored[entry.name];
    if (!have) {
      drifts.push({ relation: entry.name, detail: "missing from the vendored kgp.ts vocabulary" });
      continue;
    }
    const want = entry.signature;
    const reasons: string[] = [];
    if (have.arity !== want.arity) reasons.push(`arity ${have.arity} ≠ ${want.arity}`);
    if (JSON.stringify(have.argRoles) !== JSON.stringify(want.argRoles)) {
      reasons.push(`argRoles ${JSON.stringify(have.argRoles)} ≠ ${JSON.stringify(want.argRoles)}`);
    }
    if (have.symmetric !== want.symmetric) reasons.push(`symmetric ${have.symmetric} ≠ ${want.symmetric}`);
    if (have.tier !== want.tier) reasons.push(`tier ${JSON.stringify(have.tier)} ≠ ${JSON.stringify(want.tier)}`);
    if (reasons.length > 0) drifts.push({ relation: entry.name, detail: reasons.join("; ") });
  }
  for (const name of Object.keys(vendored)) {
    if (!live.has(name)) {
      drifts.push({ relation: name, detail: "extra in the vendored kgp.ts vocabulary (not in the koine TSV)" });
    }
  }
  return drifts;
}

/** The parsed live koine relation vocabulary — core (unqualified) + the domain extensions. */
export interface KoineVocabulary {
  readonly core: RelationEntry[];
  readonly domain: RelationEntry[];
}

/** Read + parse the four koine relation TSVs (core + `{cinematography,media,social}`). */
export function readKoineVocabulary(koineRoot: string = resolveKoineRoot()): KoineVocabulary {
  const core = parseRelationsTsv(readKoineSource(koineRoot, KOINE_CORE_TSV_REL), { core: true });
  const domain = KOINE_DOMAIN_TSV_RELS.flatMap((rel) =>
    parseRelationsTsv(readKoineSource(koineRoot, rel), { core: false }),
  );
  return { core, domain };
}

/**
 * Render {@link SignatureDrift}s into a one-string failure message that names the ONE
 * supported remedy (`npm run regen:registry-mirror`) and forbids hand-editing the mirror —
 * a signature is immutable (KGP §3.2 / the registry `signaturePolicy`), so a correction is
 * upstreamed to koine (`registryVersion` bumped) and re-vendored, never forked here.
 */
export function formatSignatureDrifts(drifts: readonly SignatureDrift[]): string {
  const lines = drifts.map((drift) => `  ${drift.relation}: ${drift.detail}`).join("\n");
  return (
    "kgp.ts vendored relation vocabulary is out of sync with the koine registry TSVs:\n" +
    `${lines}\n` +
    `Run \`${REGEN_REMEDY}\` to re-vendor both mirrors from the koine checkout. Never hand-edit ` +
    "the mirror — a published signature is immutable (KGP §3.2 / the registry signaturePolicy); " +
    "upstream the correction to koine, bump registryVersion, then regen."
  );
}

/** Regenerate both mirrors and write them (together — never one without the other). */
export function writeRegen(koineRoot: string = resolveKoineRoot()): RegenDiff {
  const { predicateMappingJson, kgpSource } = buildRegen(koineRoot);
  const jsonChanged = (existsSync(PREDICATE_MAPPING_PATH) ? readFileSync(PREDICATE_MAPPING_PATH, "utf8") : "") !== predicateMappingJson;
  const kgpChanged = readFileSync(KGP_PATH, "utf8") !== kgpSource;
  writeFileSync(PREDICATE_MAPPING_PATH, predicateMappingJson);
  writeFileSync(KGP_PATH, kgpSource);
  return { jsonChanged, kgpChanged };
}

/** CLI: regenerate both mirrors from the resolved koine checkout and print a summary. */
export function runRegen(): void {
  const koineRoot = resolveKoineRoot();
  const { jsonChanged, kgpChanged } = writeRegen(koineRoot);
  const changed = [
    jsonChanged ? "shared/predicate-mapping.json" : null,
    kgpChanged ? "shared/kgp.ts" : null,
  ].filter(Boolean);
  console.log(`regen-registry-mirror: re-vendored from ${koineRoot}`);
  console.log(
    changed.length === 0
      ? "  both mirrors already up to date (git status clean)."
      : `  updated: ${changed.join(", ")}`,
  );
}

/**
 * Read-only CLI (`--check` / `npm run check:registry-mirror`): report whether either
 * mirror is stale against the koine checkout WITHOUT writing anything, returning the
 * process exit code (`0` clean, `1` stale). A stale report names the ONE supported
 * remedy (`npm run regen:registry-mirror`) and forbids hand-editing — same discipline
 * as {@link formatSignatureDrifts} and the drift gates.
 */
export function runCheck(): number {
  const koineRoot = resolveKoineRoot();
  const { jsonChanged, kgpChanged } = diffRegen(koineRoot);
  const stale = [
    jsonChanged ? "shared/predicate-mapping.json" : null,
    kgpChanged ? "shared/kgp.ts" : null,
  ].filter(Boolean);
  if (stale.length === 0) {
    console.log(`check:registry-mirror: both mirrors up to date with ${koineRoot} (git status clean).`);
    return 0;
  }
  console.error(
    `check:registry-mirror: stale mirror(s): ${stale.join(", ")}.\n` +
      `Run \`${REGEN_REMEDY}\` to re-vendor both from the koine checkout. Never hand-edit the ` +
      "mirror — a published signature is immutable (KGP §3.2 / the registry signaturePolicy); " +
      "upstream the correction to koine, bump registryVersion, then regen.",
  );
  return 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) {
  try {
    const exitCode = process.argv.includes("--check") ? runCheck() : (runRegen(), 0);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
