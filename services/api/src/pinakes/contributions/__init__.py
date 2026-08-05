"""The contribution review queue, ported off `server/services/*`.

Everything the `/api/contributions` and `/api/ai-review` route groups need,
below HTTP: the JSON-per-record queue (:mod:`.store`), the field-level AI-draft
review and its promotion into the lexicon TSVs (:mod:`.ai_review`), the
best-effort audit log an approved edit is written to (:mod:`.changelog`), and the
API-key check plus rate-limit counters guarding the write side (:mod:`.auth`).

Same division of labour as :mod:`pinakes.engine`: plain arguments in, JSON-ready
dicts out, no FastAPI import anywhere in here. A router is a thin adapter over
it, which is what lets the same call run from a job or a test with no HTTP.

The TypeScript originals — `contribution-service.ts`, `ai-review.ts`,
`changelog.ts` — are still on disk and still serve the route groups that have
not been ported yet, so these modules reproduce their **on-disk shapes exactly**
rather than improving them. Both implementations read one queue during the
cutover; a record written by either has to be legible to the other.
"""

from __future__ import annotations

from pinakes.contributions.ai_review import (
    AiReviewError,
    apply_field_reviews,
    is_ai_draft,
    is_promotable,
    project_draft,
    promote_contribution,
    validate_accepted_draft,
)
from pinakes.contributions.auth import (
    DEFAULT_RATE_LIMIT,
    ApiAuthConfig,
    ApiKeyRecord,
    AuthOk,
    AuthRejected,
    RateLimitConfig,
    RateLimiter,
    authenticate,
    extract_api_key,
    load_api_auth_config,
    parse_api_keys,
)
from pinakes.contributions.changelog import record_change
from pinakes.contributions.store import (
    Contribution,
    ContributionStore,
    ValidationResult,
    queue,
)

__all__ = [
    "DEFAULT_RATE_LIMIT",
    "AiReviewError",
    "ApiAuthConfig",
    "ApiKeyRecord",
    "AuthOk",
    "AuthRejected",
    "Contribution",
    "ContributionStore",
    "RateLimitConfig",
    "RateLimiter",
    "ValidationResult",
    "apply_field_reviews",
    "authenticate",
    "extract_api_key",
    "is_ai_draft",
    "is_promotable",
    "load_api_auth_config",
    "parse_api_keys",
    "project_draft",
    "promote_contribution",
    "queue",
    "record_change",
    "validate_accepted_draft",
]
