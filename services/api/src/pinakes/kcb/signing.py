"""Ed25519 signing for the served capability manifest (KCB §5).

Ported off `server/services/manifest-signing.ts`, and the two rules that make it
work across the cutover come with it:

* **The signature covers everything but itself.**
  :func:`canonical_signing_input` rebuilds ``signing`` as ``{key_id, alg}`` —
  dropping ``signature`` — before serializing, so the signed bytes bind the key
  id and algorithm to the manifest yet can never sign over their own value.
* **Optional-env degrade**, the ``GEONAMES_USERNAME`` shape. With no
  ``PINAKES_SIGNING_PRIVATE_KEY`` the manifest is served as authored
  (``signing.key_id: null``) and nothing raises — §5 signing is a SHOULD. A key
  that is set but unusable logs and degrades the same way, because failing to
  serve the manifest is strictly worse than serving it unsigned.

Only the halves the service actually needs are here: sign, verify, and derive a
key id. `generateSigningKeyPair` is an operator convenience with no route behind
it and stays on the TypeScript side.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from pinakes.kcb.manifest import canonical_json

logger = logging.getLogger("pinakes.kcb")

#: The signature algorithm — fixed to match `signing.alg` in the manifest.
SIGNING_ALG = "ed25519"

#: Env var holding the PEM (or base64 PKCS#8 DER) Ed25519 private key.
PRIVATE_KEY_ENV = "PINAKES_SIGNING_PRIVATE_KEY"
#: Env var holding the key id to publish; derived from the public key if unset.
KEY_ID_ENV = "PINAKES_SIGNING_KEY_ID"


class SigningKeyError(ValueError):
    """The configured key material could not be read as an Ed25519 private key."""


def canonical_signing_input(manifest: dict[str, Any]) -> str:
    """The byte string the signature is computed over.

    The whole manifest with ``signing`` reduced to ``{key_id, alg}``, serialized
    with the shared deterministic :func:`~pinakes.kcb.manifest.canonical_json`.
    Sign and verify both go through here, so the bytes are identical on both
    sides — and on both backends.
    """
    signing = manifest.get("signing", {})
    payload = dict(manifest)
    payload["signing"] = {"key_id": signing.get("key_id"), "alg": signing.get("alg")}
    return canonical_json(payload)


def _load_private_key(raw: str) -> Ed25519PrivateKey:
    """Coerce PEM or base64 PKCS#8 DER material into a private key."""
    try:
        if "BEGIN" in raw:
            # A key pasted into a `.env` file usually arrives with literal `\n`.
            pem = raw.replace("\\n", "\n").encode("utf-8")
            key = serialization.load_pem_private_key(pem, password=None)
        else:
            key = serialization.load_der_private_key(
                base64.b64decode(raw, validate=True), password=None
            )
    except Exception as exc:  # noqa: BLE001 - any parse failure is one condition
        raise SigningKeyError(str(exc)) from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise SigningKeyError(
            f"{PRIVATE_KEY_ENV} is not an Ed25519 key ({type(key).__name__})"
        )
    return key


def _load_public_key(
    raw: str | Ed25519PublicKey | Ed25519PrivateKey,
) -> Ed25519PublicKey:
    """Coerce PEM/DER material (or a private key) into a public key."""
    if isinstance(raw, Ed25519PrivateKey):
        return raw.public_key()
    if isinstance(raw, Ed25519PublicKey):
        return raw
    try:
        if "BEGIN" in raw:
            key = serialization.load_pem_public_key(
                raw.replace("\\n", "\n").encode("utf-8")
            )
        else:
            key = serialization.load_der_public_key(
                base64.b64decode(raw, validate=True)
            )
    except Exception as exc:  # noqa: BLE001 - any parse failure is one condition
        raise SigningKeyError(str(exc)) from exc
    if not isinstance(key, Ed25519PublicKey):
        raise SigningKeyError(f"not an Ed25519 public key ({type(key).__name__})")
    return key


def _spki_der(public_key: Ed25519PublicKey) -> bytes:
    return public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def derive_key_id(public_key: str | Ed25519PublicKey | Ed25519PrivateKey) -> str:
    """``ed25519:<first-16-hex-of-sha256(spki-der)>``.

    So a configured key always publishes a stable, non-empty ``signing.key_id``
    even when the operator set no ``$PINAKES_SIGNING_KEY_ID`` — and the id the
    two backends derive for one key is the same id.
    """
    digest = hashlib.sha256(_spki_der(_load_public_key(public_key))).hexdigest()
    return f"{SIGNING_ALG}:{digest[:16]}"


def load_signing_key() -> tuple[str, Ed25519PrivateKey] | None:
    """``(key_id, private_key)`` from the environment, or ``None`` when unset.

    Raises :class:`SigningKeyError` only when a key IS configured but malformed —
    an operator misconfiguration, which :func:`sign_manifest_for_serving` then
    catches and degrades rather than failing to serve.
    """
    raw = os.environ.get(PRIVATE_KEY_ENV, "").strip()
    if not raw:
        return None
    private_key = _load_private_key(raw)
    key_id = os.environ.get(KEY_ID_ENV, "").strip() or derive_key_id(private_key)
    return key_id, private_key


def is_signing_configured() -> bool:
    """Whether a *usable* signing key is configured (absent or malformed ⇒ False)."""
    try:
        return load_signing_key() is not None
    except SigningKeyError:
        return False


def sign_manifest_with_key(
    manifest: dict[str, Any], key_id: str, private_key: Ed25519PrivateKey
) -> dict[str, Any]:
    """A copy of *manifest* whose ``signing`` carries *key_id* + a base64 signature."""
    signed = dict(manifest)
    signed["signing"] = {"key_id": key_id, "alg": SIGNING_ALG}
    signature = private_key.sign(canonical_signing_input(signed).encode("utf-8"))
    signed["signing"] = {
        "key_id": key_id,
        "alg": SIGNING_ALG,
        "signature": base64.b64encode(signature).decode("ascii"),
    }
    return signed


def sign_manifest_for_serving(manifest: dict[str, Any]) -> dict[str, Any]:
    """Sign with the env-configured key, else return the manifest as authored.

    **Never raises.** A missing key is the normal state; a malformed one logs and
    serves unsigned, because §5 signing is a SHOULD and an unserved manifest is
    the worse failure. Keeping this a pass-through when unconfigured is also what
    makes the served well-known document byte-identical to the contract on disk.
    """
    try:
        key = load_signing_key()
    except SigningKeyError as exc:
        logger.warning(
            "[kcb] %s is set but unusable (%s) — serving the manifest unsigned.",
            PRIVATE_KEY_ENV,
            exc,
        )
        return manifest
    if key is None:
        return manifest
    key_id, private_key = key
    try:
        return sign_manifest_with_key(manifest, key_id, private_key)
    except Exception as exc:  # noqa: BLE001 - serving beats signing, always
        logger.warning(
            "[kcb] failed to sign the manifest (%s) — serving it unsigned.", exc
        )
        return manifest


def is_manifest_signed(manifest: dict[str, Any]) -> bool:
    """Whether this document carries both a ``key_id`` and a ``signature``."""
    signing = manifest.get("signing", {})
    return bool(signing.get("key_id")) and bool(signing.get("signature"))


def verify_manifest_signature(
    manifest: dict[str, Any], public_key: str | Ed25519PublicKey | Ed25519PrivateKey
) -> bool:
    """Verify a served manifest against a public key.

    ``True`` only when it carries a ``signature`` + ``key_id`` and that signature
    validates over :func:`canonical_signing_input`. Tampering with any signed
    field — or a malformed signature/key — is ``False`` rather than a raise, so a
    consumer can make provenance attributable without a try/except.
    """
    signing = manifest.get("signing", {})
    signature = signing.get("signature")
    if not signature or not signing.get("key_id"):
        return False
    try:
        _load_public_key(public_key).verify(
            base64.b64decode(signature),
            canonical_signing_input(manifest).encode("utf-8"),
        )
    except (InvalidSignature, SigningKeyError, ValueError, TypeError):
        return False
    return True
