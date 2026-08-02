/**
 * Ed25519 signing for the KCB capability manifest (`koine/specs/capability-bus.md` §5:
 * a provider's manifest SHOULD be signed so a consumer can attribute its provenance —
 * KINP §7 `prov.agent`).
 *
 * **Server-only, by the same rule that keeps `contracts/kgp.ts` hasher-injected.** The
 * signature is Ed25519 over a deterministic canonical serialization, so it needs
 * `node:crypto`; `contracts/` must stay client-safe and node-builtin-free, so the crypto
 * lives here in `server/` while the manifest *shape* (`ManifestSigning.signature`) and
 * the canonical serializer (`canonicalJson`) stay in `contracts/`. This mirrors how
 * `contracts/kgp.ts` defines the byte-exact hash input and the caller supplies the hasher.
 *
 * **Optional-env degrade, like `GEONAMES_USERNAME` / `KCB_REGISTRY_URL`.** With no
 * `PINAKES_SIGNING_PRIVATE_KEY` configured the manifest is served unsigned
 * (`signing.key_id: null`) and nothing throws — KCB §5 signing is a SHOULD, not a MUST.
 * Configure a key and the served manifest gains a populated `signing.key_id` +
 * `signature`, and `isManifestSigned()` (shared) reads `true`.
 *
 * **The signature covers everything but itself.** {@link canonicalSigningInput} rebuilds
 * `signing` as `{key_id, alg}` — dropping `signature` — before serializing, so the
 * signed bytes bind the key id and algorithm to the manifest yet the signature can never
 * sign over its own value. This is the same exclusion `contracts/kgp.ts` applies when it
 * leaves `signing` out of a pack's content hash.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createHash,
  type KeyObject,
} from "node:crypto";

import { canonicalJson } from "@contracts/kgp";
import type { CapabilityManifest, ManifestSigning } from "@contracts/capability-manifest";

/** The signature algorithm — fixed to match `signing.alg` in the manifest. */
export const SIGNING_ALG = "ed25519";

/** Env var holding the PEM (or base64-DER PKCS8) Ed25519 private key. */
export const PRIVATE_KEY_ENV = "PINAKES_SIGNING_PRIVATE_KEY";
/** Env var holding the key id to publish as `signing.key_id` (optional — derived if unset). */
export const KEY_ID_ENV = "PINAKES_SIGNING_KEY_ID";

/** A key accepted for signing/verifying — a `KeyObject` or its PEM/DER material. */
export type KeyLike = KeyObject | string | Buffer;

/** A loaded signing key: the id to publish plus the private key to sign with. */
export interface SigningKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
}

/**
 * The canonical byte string the signature is computed over: the whole manifest with
 * `signing` reduced to `{key_id, alg}` (the `signature` field excluded), serialized with
 * the shared deterministic {@link canonicalJson}. Sign and verify both go through here,
 * so the bytes are identical on both sides.
 */
export function canonicalSigningInput(manifest: CapabilityManifest): string {
  const signing: ManifestSigning = { key_id: manifest.signing.key_id, alg: manifest.signing.alg };
  return canonicalJson({ ...manifest, signing });
}

/** Coerce PEM/DER material into a private `KeyObject` (already a `KeyObject` passes through). */
function toPrivateKey(key: KeyLike): KeyObject {
  if (typeof key === "object" && !Buffer.isBuffer(key)) return key;
  if (Buffer.isBuffer(key)) return createPrivateKey({ key, format: "der", type: "pkcs8" });
  const pem = key.includes("BEGIN") ? key.replace(/\\n/g, "\n") : null;
  if (pem) return createPrivateKey({ key: pem, format: "pem" });
  return createPrivateKey({ key: Buffer.from(key, "base64"), format: "der", type: "pkcs8" });
}

/** Coerce PEM/DER material (or a private key) into a public `KeyObject`. */
function toPublicKey(key: KeyLike): KeyObject {
  if (typeof key === "object" && !Buffer.isBuffer(key)) {
    return key.type === "private" ? createPublicKey(key) : key;
  }
  if (Buffer.isBuffer(key)) return createPublicKey({ key, format: "der", type: "spki" });
  const pem = key.includes("BEGIN") ? key.replace(/\\n/g, "\n") : null;
  if (pem) return createPublicKey(pem);
  return createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
}

/**
 * A deterministic key id derived from the public key when the operator did not set one —
 * `ed25519:<first-16-hex-of-sha256(spki-der)>` — so a configured key always publishes a
 * stable, non-empty `signing.key_id`.
 */
export function deriveKeyId(publicKey: KeyLike): string {
  const der = toPublicKey(publicKey).export({ format: "der", type: "spki" });
  return `${SIGNING_ALG}:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
}

/**
 * Load the signing key from the environment. Returns `null` when no key is configured
 * (the manifest is then served unsigned). Throws only when a key IS configured but is
 * malformed — an operator misconfiguration; the serving path {@link signManifestForServing}
 * catches that and degrades rather than failing to serve.
 */
export function loadSigningKey(env: NodeJS.ProcessEnv = process.env): SigningKey | null {
  const raw = env[PRIVATE_KEY_ENV]?.trim();
  if (!raw) return null;
  const privateKey = toPrivateKey(raw);
  const keyId = env[KEY_ID_ENV]?.trim() || deriveKeyId(privateKey);
  return { keyId, privateKey };
}

/** Whether a usable signing key is configured (`false` on absent or malformed). */
export function isSigningConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return loadSigningKey(env) !== null;
  } catch {
    return false;
  }
}

/**
 * Sign `manifest` with an explicit key, returning a copy whose `signing` carries the
 * `key_id` and a base64 Ed25519 `signature` over {@link canonicalSigningInput}.
 */
export function signManifestWithKey(
  manifest: CapabilityManifest,
  keyId: string,
  privateKey: KeyLike,
): CapabilityManifest {
  const base: CapabilityManifest = { ...manifest, signing: { key_id: keyId, alg: SIGNING_ALG } };
  const signature = edSign(null, Buffer.from(canonicalSigningInput(base), "utf8"), toPrivateKey(privateKey));
  return { ...base, signing: { ...base.signing, signature: signature.toString("base64") } };
}

/**
 * The serving-facing signer: sign with the env-configured key, else return the manifest
 * as-authored (unsigned, `signing.key_id: null`). **Never throws** — a missing or
 * malformed key degrades to serving unsigned (KCB §5 signing is SHOULD).
 */
export function signManifestForServing(
  manifest: CapabilityManifest,
  env: NodeJS.ProcessEnv = process.env,
): CapabilityManifest {
  let key: SigningKey | null;
  try {
    key = loadSigningKey(env);
  } catch (error) {
    console.warn(
      `[kcb] ${PRIVATE_KEY_ENV} is set but unusable (${error instanceof Error ? error.message : String(error)}) — serving the manifest unsigned.`,
    );
    return manifest;
  }
  if (!key) return manifest;
  try {
    return signManifestWithKey(manifest, key.keyId, key.privateKey);
  } catch (error) {
    console.warn(
      `[kcb] failed to sign the manifest (${error instanceof Error ? error.message : String(error)}) — serving it unsigned.`,
    );
    return manifest;
  }
}

/**
 * Verify a served manifest against a public key (or the private key it derives from):
 * `true` only when the manifest carries a `signature` + `key_id` and the signature
 * validates over {@link canonicalSigningInput}. Any tampering with a signed field — or a
 * malformed signature/key — yields `false` rather than throwing, so a consumer can make
 * provenance cryptographically attributable (KCB §5 / KINP §7 `prov.agent`).
 */
export function verifyManifestSignature(manifest: CapabilityManifest, publicKey: KeyLike): boolean {
  const { signature, key_id } = manifest.signing;
  if (!signature || !key_id) return false;
  try {
    return edVerify(
      null,
      Buffer.from(canonicalSigningInput(manifest), "utf8"),
      toPublicKey(publicKey),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** Provision a fresh Ed25519 keypair as PEM strings — for operators standing up signing. */
export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string; keyId: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    keyId: deriveKeyId(publicKey),
  };
}
