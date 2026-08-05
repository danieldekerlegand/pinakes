/**
 * **Pinakes participates with koine + agora only** (90-repatriate-koine-config US-3).
 *
 * The claim this file makes executable: everything a peer needs in order to discover,
 * trust and dial Pinakes is served by Pinakes from documents that live in *this*
 * repository — so joining the fabric needs koine (the spec) and agora (the runtime)
 * and no third, external config source. Three layers:
 *
 *  1. **Served** — the two well-known fronts answer with the in-repo documents:
 *     `/.well-known/kcb-manifest.json` is byte-identical to
 *     `contracts/capability-manifest.json` when served as-authored, and
 *     `/.well-known/agent-card.json` carries that same manifest as its KCB extension.
 *  2. **Resolvable** — the participant declaration and the public bridge mappings
 *     resolve from in-repo sources: every pointer they carry names a file that exists
 *     under this repo root, and none climbs out of it.
 *  3. **Self-contained** — the module graph behind those fronts reads nothing outside
 *     the repo. The closure is walked from the route modules and the two source
 *     documents, and every module in it is scanned for the ways a file *could* reach
 *     out (a sibling-checkout env var, `homedir()`, an absolute path literal, the
 *     filesystem at all). Then the same grep is run repo-wide, so the handful of files
 *     that legitimately do read a sibling checkout are enumerated with a reason and
 *     shown to be off the participation path.
 *
 * The scan is over **code, not prose**: comments are stripped first, because a doc
 * comment naming `KOINE_ROOT` (`contracts/predicate-mapping.ts` explains the
 * re-vendor flow that way) reads no config. Documenting the escape hatch is how a
 * reader learns it exists; using it on this path is what would break the claim.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, relative, resolve } from "node:path";

import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { CAPABILITY_MANIFEST } from "@contracts/capability-manifest";
import { EGRESS_POLICY_PATH } from "@contracts/egress-policy";
import {
  BRIDGE_INSIMUL,
  BRIDGE_INSIMUL_PATH,
  assertPublicBridge,
  assertValidBridgeMapping,
} from "@contracts/bridge-insimul";
import {
  MANIFEST_SOURCE_PATH,
  PARTICIPANT,
  PARTICIPANT_PATH,
  assertValidParticipant,
} from "@contracts/participant";
import { AGENT_CARD_ROUTE_PATH, KCB_MANIFEST_EXTENSION_URI, registerA2aRoutes } from "./a2a";
import { MANIFEST_WELL_KNOWN_PATH, registerCapabilityBusRoutes } from "./capability-bus";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** Read an in-repo JSON document straight off disk — the source, not the module. */
function readRepoJson(repoRelativePath: string): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, repoRelativePath), "utf8")) as unknown;
}

// --------------------------------------------------------------------------
// Layer 1 — the well-known fronts serve the in-repo documents
// --------------------------------------------------------------------------

/**
 * Env that would make the served documents diverge from the authored ones: a signing
 * key adds a `signing.signature`, and a configured origin absolutizes the endpoints.
 * Both are legitimate in deployment; here we want the as-authored comparison.
 */
const ENV_KEYS = [
  "PINAKES_SIGNING_PRIVATE_KEY",
  "PINAKES_SIGNING_KEY_ID",
  "PINAKES_PUBLIC_ORIGIN",
  "KCB_REGISTRY_URL",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  const app: Express = express();
  // `origin: null` asks both fronts for the as-authored, server-relative documents —
  // the same bytes a same-origin client gets, and the ones the repo holds.
  registerA2aRoutes(app, { origin: null });
  registerCapabilityBusRoutes(app, { origin: null, skipRegistration: true });
  await new Promise<void>((done) => {
    server = app.listen(0, "127.0.0.1", () => done());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await new Promise<void>((done) => server.close(() => done()));
});

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status, `${path} did not answer 200`).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe("the well-known fronts serve the in-repo documents", () => {
  it("serves contracts/capability-manifest.json verbatim at the KCB well-known path", async () => {
    const served = await getJson(MANIFEST_WELL_KNOWN_PATH);
    // Not "looks like the manifest" — IS the file on disk. Nothing is fetched, merged
    // or defaulted in from elsewhere on the way out.
    expect(served).toEqual(readRepoJson(MANIFEST_SOURCE_PATH));
    expect(MANIFEST_SOURCE_PATH).toBe("contracts/capability-manifest.json");
  });

  it("serves the agent-card carrying that same in-repo manifest as its KCB extension", async () => {
    const card = await getJson(AGENT_CARD_ROUTE_PATH);
    const manifest = readRepoJson(MANIFEST_SOURCE_PATH) as typeof CAPABILITY_MANIFEST;

    // The card's own agent id IS the declared participant identity (KCB §2).
    expect(card.name).toBe(manifest.identity);
    expect(card.name).toBe(PARTICIPANT.participant);

    const extensions = (card.capabilities as { extensions: { uri: string; params: unknown }[] })
      .extensions;
    const kcb = extensions.find((e) => e.uri === KCB_MANIFEST_EXTENSION_URI);
    expect(kcb, `no ${KCB_MANIFEST_EXTENSION_URI} extension on the card`).toBeDefined();
    const params = kcb!.params as Record<string, unknown>;
    expect(params.kcb_version).toBe(manifest.kcb_version);
    expect(params.capabilities).toEqual(manifest.capabilities);
    expect(params.produces).toEqual(manifest.produces);
    expect(params.consumes).toEqual(manifest.consumes);

    // Every capability in the in-repo document is advertised as a dialable A2A skill.
    const skills = card.skills as { id: string }[];
    expect(skills.map((s) => s.id).sort()).toEqual(manifest.capabilities.map((c) => c.name).sort());
  });

  it("answers both fronts with no registry, no signing key and no configured origin", async () => {
    // The degrade IS the claim: a deployment that can reach nothing still self-describes.
    for (const key of ENV_KEYS) expect(process.env[key]).toBeUndefined();
    expect((await getJson(MANIFEST_WELL_KNOWN_PATH)).identity).toBe(CAPABILITY_MANIFEST.identity);
    expect((await getJson(AGENT_CARD_ROUTE_PATH)).name).toBe(CAPABILITY_MANIFEST.identity);
  });
});

// --------------------------------------------------------------------------
// Layer 2 — the declaration and the public bridge mappings resolve in-repo
// --------------------------------------------------------------------------

/** Every repo-relative pointer the participant declaration carries. */
function declaredPointers(): string[] {
  const { identity, capability, egress, translation, discovery } = PARTICIPANT;
  return [
    PARTICIPANT_PATH,
    identity.minting_rules?.path,
    capability.agent_card.path,
    capability.manifest_source?.path,
    capability.mcp?.path,
    egress.policy.path,
    egress.license_policy?.path,
    ...(translation?.mappings ?? []).map((m) => m.location.path),
    ...(discovery?.registries ?? []).map((r) => r.path),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
}

describe("the participant declaration and public bridge mappings resolve in-repo", () => {
  it("validates, and every pointer it carries names a file that exists here", () => {
    expect(() => assertValidParticipant()).not.toThrow();
    const pointers = declaredPointers();
    // Guard the guard: a declaration that lost its pointers would pass vacuously.
    expect(pointers.length).toBeGreaterThanOrEqual(8);
    for (const pointer of pointers) {
      expect(pointer.startsWith("/"), `${pointer} is absolute`).toBe(false);
      expect(pointer.split("/").includes(".."), `${pointer} climbs out of the repo`).toBe(false);
      expect(existsSync(join(REPO_ROOT, pointer)), `${pointer} does not exist`).toBe(true);
    }
  });

  it("resolves the four facets to the documents that actually back them", () => {
    expect(declaredPointers()).toEqual(expect.arrayContaining([MANIFEST_SOURCE_PATH]));
    expect(PARTICIPANT.egress.policy.path).toBe(EGRESS_POLICY_PATH);
    const mappings = (PARTICIPANT.translation?.mappings ?? []).map((m) => m.location.path);
    expect(mappings).toEqual(expect.arrayContaining([BRIDGE_INSIMUL_PATH]));
  });

  it("resolves the public bridge mapping against in-repo documents only", () => {
    // Both the schema it resolves against and the registry that authorizes it are here.
    expect(() => assertValidBridgeMapping()).not.toThrow();
    expect(() => assertPublicBridge()).not.toThrow();
    for (const pointer of [
      BRIDGE_INSIMUL_PATH,
      BRIDGE_INSIMUL.canonicalSchema.path!,
      BRIDGE_INSIMUL.registry.path!,
    ]) {
      expect(existsSync(join(REPO_ROOT, pointer)), `${pointer} does not exist`).toBe(true);
    }
    // A non-public far endpoint is absent rather than redacted, so the set of in-repo
    // bridge mappings IS the set of public integrations — nothing waits in an external file.
    for (const participant of BRIDGE_INSIMUL.participants) {
      expect(participant.visibility).toBe("public");
    }
  });
});

// --------------------------------------------------------------------------
// The peer-facing map — docs/self-describing-participant.md
// --------------------------------------------------------------------------

const PARTICIPANT_DOC = "docs/self-describing-participant.md";

describe("the self-describing-participant surface is documented", () => {
  const doc = readFileSync(join(REPO_ROOT, PARTICIPANT_DOC), "utf8");

  it("says where each facet lives, by the path the code actually uses", () => {
    for (const path of [
      PARTICIPANT_PATH,
      MANIFEST_SOURCE_PATH,
      EGRESS_POLICY_PATH,
      BRIDGE_INSIMUL_PATH,
    ]) {
      expect(doc, `${PARTICIPANT_DOC} does not name ${path}`).toContain(path);
    }
  });

  it("states the namespace, the minting-authority claim, and the koine + agora bound", () => {
    expect(doc).toContain(PARTICIPANT.identity.namespace);
    expect(doc).toMatch(/minting authority/i);
    // The claim itself, not a particular sentence: koine + agora, and nothing more.
    expect(doc).toMatch(/needs koine and agora[\s\S]{0,40}participate/i);
    expect(doc).toMatch(/nothing else/i);
  });

  it("links only to files that exist", () => {
    const links = [...doc.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      if (/^[a-z]+:/.test(link)) continue; // an external URL, not our tree
      const target = resolve(REPO_ROOT, "docs", link);
      expect(existsSync(target), `${PARTICIPANT_DOC} links to a missing ${link}`).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// Layer 3 — nothing on the participation path reads outside the repo
// --------------------------------------------------------------------------

/**
 * The entry points of the participation path: the two served fronts, and the two
 * source documents a peer resolves once it has the card. The closure below is walked
 * from here, so adding an import to any of them extends what is scanned.
 */
const PARTICIPATION_ROOTS = [
  "server/routes/a2a.ts",
  "server/routes/capability-bus.ts",
  "contracts/participant.ts",
  "contracts/bridge-insimul.ts",
] as const;

/** `import x from "…"` / `export … from "…"` / `import("…")` — enough for this tree. */
const SPECIFIER_RES = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
];

/**
 * Strip comments so the scan reads code, not prose. The `[^:]` guard keeps a `//`
 * inside a `https://…` URL from truncating the rest of its line.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Resolve an in-repo specifier to its repo-relative file, or null for a bare package. */
function resolveInRepo(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@contracts/")) {
    base = join(REPO_ROOT, "contracts", specifier.slice("@contracts/".length));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(join(REPO_ROOT, fromFile)), specifier);
  } else {
    return null; // a package or a node builtin — not a file of ours
  }
  for (const candidate of [base, `${base}.ts`, `${base}.json`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(REPO_ROOT, candidate);
    }
  }
  // Unresolvable is a failure, never a silently smaller closure.
  throw new Error(`${fromFile}: cannot resolve in-repo import "${specifier}"`);
}

/** Every in-repo file reachable by static import from `roots`. */
function importClosure(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".ts")) continue; // JSON is data: it imports nothing
    const source = stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
    for (const re of SPECIFIER_RES) {
      for (const match of source.matchAll(re)) {
        const resolved = resolveInRepo(file, match[1]);
        if (resolved && !seen.has(resolved)) queue.push(resolved);
      }
    }
  }
  return [...seen].sort();
}

/** The ways a module could reach for config outside this repository. */
const OUTSIDE_THE_REPO: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /\b[A-Z]+_ROOT\b/, what: "a sibling-checkout root env var" },
  { pattern: /\bhomedir\s*\(/, what: "the user's home directory" },
  { pattern: /["'`](?:\/Users\/|\/home\/|~\/)/, what: "an absolute filesystem path" },
  { pattern: /from\s*["']node:fs["']|from\s*["']node:fs\/promises["']/, what: "the filesystem" },
];

/** The sibling checkouts anything here could resolve, named as their env overrides. */
const SIBLING_CHECKOUT = /\b(?:KOINE|AGORA|INSIMUL|LUGH)_ROOT\b/;

/** Directories with no hand-written source in them (or none of ours). */
const NOT_SOURCE = new Set(["node_modules", "dist", "build", "coverage", ".git", "data"]);

/** Every hand-written TypeScript file in the repo, repo-relative. */
function typeScriptFiles(dir = REPO_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || NOT_SOURCE.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...typeScriptFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(relative(REPO_ROOT, full));
  }
  return found;
}

/**
 * The non-test files that DO read a sibling checkout, each with the reason it is not
 * participation config. Tests are excused by shape (a `skipIf`-gated cross-repo probe
 * is the house pattern); files that merely *name* a sibling root in prose never reach
 * this list, since the scan strips comments first. A new entry here is a claim that
 * wants justifying — the assertion that none of them is in the participation closure
 * is what keeps the list honest.
 */
const SIBLING_CHECKOUT_READERS: Readonly<Record<string, string>> = {
  "contracts/koine-schema.ts":
    "test support — validates our documents against koine's schemas when a checkout is beside us, skipped when not",
  "server/services/finetune-provider.ts":
    "dispatches a KFT job to the lugh trainer — capability invocation, not participation config",
  "scripts/regen-registry-mirror.ts":
    "the hand-run re-vendor tool — it reads koine to WRITE the in-repo mirror, so that serving never has to",
};

describe("nothing on the participation path resolves config outside this repo", () => {
  const closure = importClosure(PARTICIPATION_ROOTS);

  it("walks a closure that actually covers the four facets", () => {
    // If the walker broke, the scan below would pass over an empty set.
    expect(closure).toEqual(
      expect.arrayContaining([
        ...PARTICIPATION_ROOTS,
        "contracts/capability-manifest.ts",
        "contracts/capability-manifest.json",
        "contracts/egress-policy.ts",
        "contracts/egress-policy.json",
        "contracts/participant.json",
        "contracts/bridge-insimul.json",
        "contracts/predicate-mapping.json",
        "contracts/canonical-schema.json",
        "server/services/capability-registry.ts",
      ]),
    );
  });

  it("scans with patterns that actually fire", () => {
    // A green scan means nothing unless the scanner would go red on the real thing.
    const violations = [
      'const root = process.env.KOINE_ROOT ?? "";',
      'const root = join(homedir(), "Development", "koine");',
      'const root = "/Users/someone/Development/koine";',
      'import { readFileSync } from "node:fs";',
    ];
    expect(violations).toHaveLength(OUTSIDE_THE_REPO.length);
    violations.forEach((sample, i) => {
      const { pattern, what } = OUTSIDE_THE_REPO[i];
      expect(pattern.test(sample), `the ${what} check missed ${sample}`).toBe(true);
    });
  });

  it("reads no path outside the repo — and touches the filesystem not at all", () => {
    for (const file of closure) {
      if (!file.endsWith(".ts")) continue;
      const code = stripComments(readFileSync(join(REPO_ROOT, file), "utf8"));
      for (const { pattern, what } of OUTSIDE_THE_REPO) {
        expect(pattern.test(code), `${file} reaches for ${what}`).toBe(false);
      }
    }
  });

  it("keeps every module-graph edge inside the repo", () => {
    for (const file of closure) {
      expect(file.startsWith(".."), `${file} lives outside the repo`).toBe(false);
      expect(existsSync(join(REPO_ROOT, file))).toBe(true);
    }
  });

  it("accounts for every file that does read a sibling checkout, and keeps them off the path", () => {
    const readers = typeScriptFiles().filter((file) =>
      SIBLING_CHECKOUT.test(stripComments(readFileSync(join(REPO_ROOT, file), "utf8"))),
    );
    // The grep has to find something, or it is proving nothing.
    expect(readers.length).toBeGreaterThan(0);

    for (const file of readers) {
      const excused = file.endsWith(".test.ts") || file in SIBLING_CHECKOUT_READERS;
      expect(excused, `${file} reads a sibling checkout with no recorded reason`).toBe(true);
      // The load-bearing half: whatever the reason, it is not on the participation path.
      expect(closure.includes(file), `${file} is on the participation path`).toBe(false);
    }
    // Every excuse still describes a real file (a stale entry would silently widen the rule).
    for (const file of Object.keys(SIBLING_CHECKOUT_READERS)) {
      expect(readers, `${file} no longer reads a sibling checkout`).toContain(file);
    }
  });
});
