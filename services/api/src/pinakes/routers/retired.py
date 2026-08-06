"""The retired acquisition routes — the scraping/enrichment surface that has no
replacement endpoint anywhere (pinakes:80 US-1).

pinakes:70 US-1 deleted the twenty-seven ``server/services/*-scraper.ts`` and
``*-enrichment.ts`` modules into :mod:`pinakes_engine.acquire`, and left their
thirty-one route paths registered on Express answering **501 ``retired``** —
``retiredToEngine`` in ``server/routes.ts``, the sibling of ``portedToPython``.
This module is the other end of that: the same thirty-one paths, the same body,
served here so the answer survives the deletion of ``server/``.

**This is a port, not a stub, and the distinction is the whole file.** Every
other module in this package moves a *capability* across; there is no capability
here to move, because acquisition is not an HTTP surface any more — it is
``pinakes_engine fetch inputs/categories/<id>.yml``. What a caller needs is
therefore not a handler but an accurate answer about where the domain went, and
that answer is data: :data:`RETIRED_ROUTES` pairs each path with the category
specs that cover it, exactly as the TypeScript table did.

Two things follow from that, and both are easy to get wrong:

* **These are not 501 ``not_ported`` stubs.** :mod:`pinakes.not_implemented`
  answers "the TypeScript backend still serves this", which for these routes is
  false in a way that matters — it would send a caller to a process that is
  being deleted, to be told the same thing again. Registering them here is what
  takes them out of that catalog, which is also why the coverage number moves.
* **The ``route`` field carries the Express spelling**
  (``GET /api/enrichment/jobs/:id``), not the OpenAPI one. It is prose naming
  the retired route, and it was recorded that way; the *registration* path is
  the ``{id}`` template, because that literal is what the parity diff matches.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import APIRouter
from fastapi.responses import JSONResponse

#: Where the acquisition these routes drove actually lives now. Not a Python
#: *route* — there is none, and that is the point.
ACQUISITION_RETIRED_TO = "engine/src/pinakes_engine/acquire"

#: The full retirement table, module by module, on the engine side.
MIGRATION_TABLE = "engine/src/pinakes_engine/acquire/migration.py"

#: Status. 501 rather than 404 or 410: the path stays in the API contract (the
#: parity baseline is harvested from Express's routing table), and a client that
#: finds it should be told where the capability went, not that it never existed.
RETIRED_STATUS = 501

#: ``error`` discriminator. Deliberately *not* ``ported``: a ported route is
#: served by another process at the same path, and these are served nowhere.
RETIRED_ERROR = "retired"


#: One row per retired route: ``(method, path, express_route, categories)``.
#:
#: ``path`` is the OpenAPI template the parity spec carries — what gets
#: registered. ``express_route`` is the ``"METHOD /path"`` string the TypeScript
#: handler was constructed with and echoed in its body, in Express's ``:param``
#: spelling. ``categories`` are ``engine/inputs/categories/<id>.yml`` ids; the
#: tuple is empty only for the generic top-up routes, whose replacement is the
#: generation adapter itself rather than any one category.
RETIRED_ROUTES: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    (
        "POST",
        "/api/architectural-styles/scrape",
        "POST /api/architectural-styles/scrape",
        ("architectural-styles", "building-types"),
    ),
    (
        "GET",
        "/api/building-types/categories",
        "GET /api/building-types/categories",
        ("building-types",),
    ),
    ("POST", "/api/enrichment/batch", "POST /api/enrichment/batch", ()),
    ("GET", "/api/enrichment/analyze", "GET /api/enrichment/analyze", ()),
    (
        "POST",
        "/api/enrichment/culture-profiles",
        "POST /api/enrichment/culture-profiles",
        ("culture-profiles", "city-layouts", "daily-life", "social-structures"),
    ),
    (
        "GET",
        "/api/enrichment/culture-profiles/jobs",
        "GET /api/enrichment/culture-profiles/jobs",
        ("culture-profiles", "city-layouts", "daily-life", "social-structures"),
    ),
    (
        "GET",
        "/api/enrichment/culture-profiles/jobs/{id}",
        "GET /api/enrichment/culture-profiles/jobs/:id",
        ("culture-profiles", "city-layouts", "daily-life", "social-structures"),
    ),
    (
        "POST",
        "/api/enrichment/grammar",
        "POST /api/enrichment/grammar",
        ("grammar-features", "wals-cldf", "grambank-cldf"),
    ),
    ("GET", "/api/enrichment/jobs", "GET /api/enrichment/jobs", ()),
    ("GET", "/api/enrichment/jobs/{id}", "GET /api/enrichment/jobs/:id", ()),
    (
        "POST",
        "/api/enrichment/languages",
        "POST /api/enrichment/languages",
        ("languages", "dialects", "language-families", "glottolog"),
    ),
    (
        "POST",
        "/api/enrichment/phonology",
        "POST /api/enrichment/phonology",
        ("phoible", "wiktionary-phonology"),
    ),
    (
        "POST",
        "/api/scrape-ethnographic",
        "POST /api/scrape-ethnographic",
        ("kinship-systems", "social-organization"),
    ),
    (
        "POST",
        "/api/scrape/art-traditions",
        "POST /api/scrape/art-traditions",
        ("art-movements", "art-style-evolutions"),
    ),
    (
        "POST",
        "/api/scrape/wikimedia-commons",
        "POST /api/scrape/wikimedia-commons",
        ("commons-images",),
    ),
    (
        "POST",
        "/api/scrape/wiktionary-phonology",
        "POST /api/scrape/wiktionary-phonology",
        ("wiktionary-phonology",),
    ),
    (
        "POST",
        "/api/scraping/battles",
        "POST /api/scraping/battles",
        ("battles", "naval-battles", "sieges", "wars"),
    ),
    (
        "POST",
        "/api/scraping/cuisines",
        "POST /api/scraping/cuisines",
        ("cuisines", "cuisine-items", "cooking-techniques", "ingredient-origins"),
    ),
    (
        "POST",
        "/api/scraping/glottolog",
        "POST /api/scraping/glottolog",
        ("glottolog",),
    ),
    (
        "POST",
        "/api/scraping/grammar-wals-grambank",
        "POST /api/scraping/grammar-wals-grambank",
        ("wals-cldf", "grambank-cldf"),
    ),
    (
        "POST",
        "/api/scraping/language-contacts",
        "POST /api/scraping/language-contacts",
        ("language-contacts",),
    ),
    (
        "POST",
        "/api/scraping/music",
        "POST /api/scraping/music",
        ("music-traditions", "musical-instruments"),
    ),
    (
        "POST",
        "/api/scraping/polities",
        "POST /api/scraping/polities",
        ("seshat-polities", "city-states", "kingdoms", "empires", "dynasties"),
    ),
    (
        "POST",
        "/api/scraping/religions",
        "POST /api/scraping/religions",
        ("religions", "religious-texts", "deities"),
    ),
    (
        "POST",
        "/api/scraping/sound-changes",
        "POST /api/scraping/sound-changes",
        ("sound-changes",),
    ),
    (
        "POST",
        "/api/scraping/trade-goods",
        "POST /api/scraping/trade-goods",
        ("trade-goods", "trade-routes"),
    ),
    (
        "GET",
        "/api/scraping/underrepresented-families",
        "GET /api/scraping/underrepresented-families",
        ("underrepresented-vocab",),
    ),
    (
        "POST",
        "/api/scraping/underrepresented-vocab",
        "POST /api/scraping/underrepresented-vocab",
        ("underrepresented-vocab",),
    ),
    (
        "POST",
        "/api/scraping/words",
        "POST /api/scraping/words",
        ("kaikki", "lexibank-abvd", "underrepresented-vocab"),
    ),
    (
        "POST",
        "/api/scraping/writing-systems",
        "POST /api/scraping/writing-systems",
        ("writing-systems", "alphabets", "cldr-scripts"),
    ),
    (
        "POST",
        "/api/verb-paradigms/scrape",
        "POST /api/verb-paradigms/scrape",
        ("verb-paradigms",),
    ),
)


def retired_body(express_route: str, categories: tuple[str, ...]) -> dict[str, object]:
    """The 501 payload for one retired route — field for field the TypeScript's.

    ``run`` is the actionable half: the category specs to fetch instead. With no
    categories the route was a generic top-up whose replacement is the generation
    adapter rather than any one spec, so the command is shown with a placeholder.
    """
    return {
        "error": RETIRED_ERROR,
        "message": (
            f"{express_route} has been retired. Its domain is acquired by the "
            f"Python engine now ({ACQUISITION_RETIRED_TO}); this backend no "
            f"longer scrapes."
        ),
        "route": express_route,
        "acquiredBy": ACQUISITION_RETIRED_TO,
        "categories": list(categories),
        "run": (
            [f"pinakes_engine fetch inputs/categories/{id}.yml" for id in categories]
            if categories
            else ["pinakes_engine fetch inputs/categories/<category>.yml"]
        ),
        "migrationTable": MIGRATION_TABLE,
    }


def _endpoint(
    express_route: str, categories: tuple[str, ...]
) -> Callable[[], Awaitable[JSONResponse]]:
    """Build one handler. It declares no parameters on purpose: the answer does
    not depend on what was asked, and a declared path/body parameter would make
    FastAPI validate it and turn this 501 into a 422 — the same reasoning
    :mod:`pinakes.not_implemented` documents for the catalog it replaces."""
    body = retired_body(express_route, categories)

    async def handler() -> JSONResponse:
        return JSONResponse(status_code=RETIRED_STATUS, content=body)

    return handler


router = APIRouter(tags=["retired"])

for _method, _path, _express_route, _categories in RETIRED_ROUTES:
    router.add_api_route(
        _path,
        _endpoint(_express_route, _categories),
        methods=[_method],
        include_in_schema=False,
        name=f"retired:{_method.lower()}:{_path}",
    )
