import { describe, it, expect } from "vitest";
import { createPublicKey } from "node:crypto";

import { CAPABILITY_MANIFEST, isManifestSigned } from "@shared/capability-manifest";
import {
  SIGNING_ALG,
  PRIVATE_KEY_ENV,
  KEY_ID_ENV,
  canonicalSigningInput,
  deriveKeyId,
  loadSigningKey,
  isSigningConfigured,
  signManifestWithKey,
  signManifestForServing,
  verifyManifestSignature,
  generateSigningKeyPair,
} from "./manifest-signing";

/**
 * KCB §5: the manifest SHOULD be signed so a consumer can attribute its provenance
 * (KINP §7 `prov.agent`). These pin the round-trip (sign → verify), the tamper-evidence
 * that makes provenance cryptographically attributable, and the optional-env degrade
 * (no key ⇒ served unsigned, never throwing) that keeps §5 a SHOULD, not a MUST.
 */
describe("manifest-signing", () => {
  const { privateKeyPem, publicKeyPem, keyId } = generateSigningKeyPair();
  const publicKey = createPublicKey(publicKeyPem);

  it("signs then verifies a round-trip", () => {
    const signed = signManifestWithKey(CAPABILITY_MANIFEST, keyId, privateKeyPem);
    expect(signed.signing.key_id).toBe(keyId);
    expect(signed.signing.alg).toBe(SIGNING_ALG);
    expect(typeof signed.signing.signature).toBe("string");
    expect(signed.signing.signature).not.toBe("");
    expect(isManifestSigned(signed)).toBe(true);
    expect(verifyManifestSignature(signed, publicKey)).toBe(true);
    // A public key derived from the private key material also verifies.
    expect(verifyManifestSignature(signed, publicKeyPem)).toBe(true);
  });

  it("fails verification when the manifest is tampered with", () => {
    const signed = signManifestWithKey(CAPABILITY_MANIFEST, keyId, privateKeyPem);
    const tampered = { ...signed, identity: "attacker:agent:resolver" } as typeof signed;
    expect(verifyManifestSignature(tampered, publicKey)).toBe(false);

    // Tampering with the published key id (without re-signing) is also detected.
    const reKeyed = { ...signed, signing: { ...signed.signing, key_id: "ed25519:forged" } };
    expect(verifyManifestSignature(reKeyed, publicKey)).toBe(false);

    // A stripped signature is unverifiable, not a crash.
    const unsigned = { ...signed, signing: { key_id: signed.signing.key_id, alg: SIGNING_ALG } };
    expect(verifyManifestSignature(unsigned, publicKey)).toBe(false);
  });

  it("excludes the signature field from the signed bytes", () => {
    const signed = signManifestWithKey(CAPABILITY_MANIFEST, keyId, privateKeyPem);
    // The canonical input a verifier recomputes must not depend on the signature value:
    // a manifest with a garbage signature hashes the same input as the real one.
    const garbage = { ...signed, signing: { ...signed.signing, signature: "not-a-signature" } };
    expect(canonicalSigningInput(garbage)).toBe(canonicalSigningInput(signed));
    // …but it does bind key_id + alg.
    const reKeyed = { ...signed, signing: { ...signed.signing, key_id: "ed25519:other" } };
    expect(canonicalSigningInput(reKeyed)).not.toBe(canonicalSigningInput(signed));
  });

  it("derives a stable, non-empty key id from the public key", () => {
    expect(keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(deriveKeyId(publicKeyPem)).toBe(keyId);
    expect(deriveKeyId(privateKeyPem)).toBe(keyId);
  });

  describe("optional-env degrade", () => {
    it("serves unsigned with no key configured, and never throws", () => {
      const env = {} as NodeJS.ProcessEnv;
      expect(isSigningConfigured(env)).toBe(false);
      expect(loadSigningKey(env)).toBeNull();
      const served = signManifestForServing(CAPABILITY_MANIFEST, env);
      expect(served.signing.key_id).toBeNull();
      expect(served.signing.signature).toBeUndefined();
      expect(isManifestSigned(served)).toBe(false);
    });

    it("signs the served manifest when a key is configured", () => {
      const env = { [PRIVATE_KEY_ENV]: privateKeyPem } as NodeJS.ProcessEnv;
      expect(isSigningConfigured(env)).toBe(true);
      const served = signManifestForServing(CAPABILITY_MANIFEST, env);
      expect(served.signing.key_id).toBe(keyId);
      expect(isManifestSigned(served)).toBe(true);
      expect(verifyManifestSignature(served, publicKey)).toBe(true);
    });

    it("honors an explicit key id from the environment", () => {
      const env = {
        [PRIVATE_KEY_ENV]: privateKeyPem,
        [KEY_ID_ENV]: "pinakes-2026-key-1",
      } as NodeJS.ProcessEnv;
      const loaded = loadSigningKey(env);
      expect(loaded?.keyId).toBe("pinakes-2026-key-1");
      const served = signManifestForServing(CAPABILITY_MANIFEST, env);
      expect(served.signing.key_id).toBe("pinakes-2026-key-1");
      expect(verifyManifestSignature(served, publicKey)).toBe(true);
    });

    it("degrades to unsigned on a malformed key rather than throwing", () => {
      const env = { [PRIVATE_KEY_ENV]: "not a real key" } as NodeJS.ProcessEnv;
      expect(isSigningConfigured(env)).toBe(false);
      const served = signManifestForServing(CAPABILITY_MANIFEST, env);
      expect(served.signing.key_id).toBeNull();
      expect(isManifestSigned(served)).toBe(false);
    });
  });
});
