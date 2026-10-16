"""HMAC-SHA256 signing and verification for AI proposals."""

import hashlib
import hmac
import json


def design_hash(design: dict) -> str:
    """SHA-256 hex digest of the canonical JSON representation."""
    canonical = json.dumps(design, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _message(ops: list, base_revision: int, base_hash: str) -> bytes:
    payload = json.dumps(
        {"ops": ops, "baseRevision": base_revision, "baseHash": base_hash},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return payload.encode()


def sign_proposal(ops: list, base_revision: int, base_hash: str, key: str) -> str:
    return hmac.new(key.encode(), _message(ops, base_revision, base_hash), hashlib.sha256).hexdigest()


def verify_proposal(ops: list, base_revision: int, base_hash: str, signature: str, key: str) -> bool:
    expected = sign_proposal(ops, base_revision, base_hash, key)
    return hmac.compare_digest(expected, signature)
