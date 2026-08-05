"""The retirement table: what each deleted TypeScript scraper is now acquired by.

pinakes:70 US-1 folded ``server/services/*-scraper.ts`` and ``*-enrichment.ts``
— twenty-seven files, ~13.4k lines — into this package, so the project has one
fetch layer, one rate limiter, one cache and one set of adapters
(``docs/UNIFIED-PROJECT-PLAN.md`` §6). Deleting the files is the easy half. The
half worth proving is that **no domain went with them**, and that is what this
module is: one row per retired file, naming the domain it covered and the
category spec (or Python module) that covers it now.

It is a table rather than a paragraph because a paragraph cannot be tested.
``tests/test_scraper_migration.py`` asserts that every :data:`RETIRED_SCRAPERS`
row names categories that exist under ``inputs/categories/``, that each of those
loads and builds its adapter, and that no retired module has crept back into
``server/``.

## What the migration actually found

The story's instruction was to *deduplicate against existing engine adapters
rather than port 1:1*, and the dedup turned out to be most of the work. Roughly
two thirds of the retired files never scraped anything: they asked Gemini to
invent rows and appended them to a lexicon TSV. For the majority of those
domains this side already had **real** acquisition from a better source —
battles, religions, musical instruments, writing systems, polities, dishes,
art movements and buildings are all acquired from Wikidata by class, and WALS,
PHOIBLE, Glottolog, Lexibank and Wiktionary from their own published datasets.
Those rows are :data:`Coverage.EXISTING` and cost no new code at all.

What was genuinely uncovered fell into three mechanisms, which is why exactly
three adapters were added rather than twenty-seven:

* :mod:`~pinakes_engine.acquire.rest` — a JSON REST endpoint with a field map
  (Seshat, Wikimedia Commons, the MediaWiki API);
* :mod:`~pinakes_engine.acquire.remote` — a published dataset downloaded rather
  than dumped (WALS/Grambank CLDF, UniMorph, CLDR);
* :mod:`~pinakes_engine.acquire.generate` — a model asked for rows in a schema
  derived from the target's own columns (the long tail with no structured source
  at all: kinship terminologies, contact events, daily life).

## The two rows that are neither

``archaeological-site-scraper.ts`` and ``incremental-scraper.ts`` are
:data:`Coverage.MODULE`: their capability had already been ported into Python
before this story, by pinakes:64 US-2 and by the dump-diff work respectively.
They are listed anyway — a retirement table with holes in it is not a statement
about anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path

#: Where category specs live, relative to the package root (``engine/``).
CATEGORY_DIR = Path("inputs") / "categories"


class Coverage(Enum):
    """How a retired scraper's domain is acquired now."""

    EXISTING = "existing-category"
    """A category that predates this migration already acquired the domain,
    generally from a better source than the TypeScript used."""

    NEW = "new-category"
    """A category added by this migration, on one of the three new adapters."""

    MODULE = "engine-module"
    """Already ported into Python code by an earlier story, not as a category."""


@dataclass(frozen=True)
class RetiredScraper:
    """One deleted TypeScript module and the acquisition that replaced it.

    Attributes:
        module: Path of the deleted file, relative to the repository root.
        domain: What it acquired, in one phrase.
        targets: The ``data/source/lexicons/*.tsv`` files it wrote, if any.
        coverage: How that domain is acquired now.
        categories: Category ids under ``inputs/categories/`` that carry it.
            Empty only for :data:`Coverage.MODULE`.
        replacement: For :data:`Coverage.MODULE`, the Python module that
            carries it; otherwise ``""``.
        note: Why the coverage is what it is — the dedup, or the gap.
    """

    module: str
    domain: str
    targets: tuple[str, ...]
    coverage: Coverage
    categories: tuple[str, ...]
    replacement: str
    note: str


def _row(
    module: str,
    domain: str,
    targets: str,
    coverage: Coverage,
    categories: str,
    note: str,
    replacement: str = "",
) -> RetiredScraper:
    return RetiredScraper(
        module=f"server/services/{module}",
        domain=domain,
        targets=tuple(t for t in targets.split() if t),
        coverage=coverage,
        categories=tuple(c for c in categories.split() if c),
        replacement=replacement,
        note=note,
    )


#: Every retired file, in the order ``ls server/services/*-scraper.ts`` gave.
RETIRED_SCRAPERS: tuple[RetiredScraper, ...] = (
    _row(
        "archaeological-site-scraper.ts",
        "archaeological sites from Open Context, tDAR, Pleiades and UNESCO",
        "archaeological-sites.tsv",
        Coverage.MODULE,
        "archaeological-sites",
        "The Open Context / tDAR half was ported by pinakes:64 US-2 and already "
        "runs on this package's HttpClient; the Pleiades half is the "
        "PleiadesDumpAdapter, and the UNESCO list was a hard-coded array of "
        "twenty sites, which is data rather than a scraper.",
        replacement="services/api/src/pinakes/ingest/archaeology.py",
    ),
    _row(
        "architectural-styles-scraper.ts",
        "architectural styles and building typology",
        "architectural-styles.tsv building-types.tsv",
        Coverage.NEW,
        "architectural-styles building-types",
        "The buildings themselves were never this file's contribution — "
        "castles, cathedrals, mosques, synagogues, palaces, bridges, aqueducts, "
        "lighthouses, windmills, monasteries and fortresses are each acquired "
        "from Wikidata by their own category. The styles are what had no source.",
    ),
    _row(
        "art-tradition-scraper.ts",
        "art traditions and the transitions between them",
        "art-traditions.tsv art-style-evolutions.tsv",
        Coverage.NEW,
        "art-style-evolutions",
        "`art-movements` and its siblings (frescoes, mosaics, sculptures, "
        "tapestries, icons, triptychs, ...) already acquire the traditions from "
        "Wikidata. Only the transitions between them were uncovered.",
    ),
    _row(
        "battle-scraper.ts",
        "historically significant battles",
        "battles.tsv",
        Coverage.EXISTING,
        "battles naval-battles sieges us-civil-war-battles wars",
        "Four era prompts asking a model to invent battles, against five "
        "categories that acquire real ones from Wikidata with coordinates, "
        "dates and participants. Nothing here was worth carrying.",
    ),
    _row(
        "cuisine-scraper.ts",
        "cuisines, dishes, cooking techniques and ingredient origins",
        "cuisines.tsv cuisine-items.tsv cooking-techniques.tsv "
        "ingredient-origins.tsv",
        Coverage.NEW,
        "cuisines cuisine-items cooking-techniques ingredient-origins",
        "Fifteen `Dish;CulturalArtifact` categories already acquire the dishes "
        "from Wikidata; what they lacked is the cuisine each belongs to and the "
        "technique and ingredient tables that hang off it.",
    ),
    _row(
        "ethnographic-scraper.ts",
        "kinship terminologies and social organization",
        "kinship-systems.tsv social-organization.tsv",
        Coverage.NEW,
        "kinship-systems social-organization",
        "The ethnographic record has no queryable open endpoint, so this is one "
        "of the domains a model genuinely is the only available source for.",
    ),
    _row(
        "glottolog-scraper.ts",
        "the Glottolog languoid tree",
        "glottolog-families.tsv glottolog-languages.tsv",
        Coverage.EXISTING,
        "glottolog",
        "It walked the per-languoid JSON API recursively, one HTTP call per "
        "node, to ten levels. The `glottolog` category reads the same catalogue "
        "out of the CLDF release in one file, genealogy included.",
    ),
    _row(
        "grammar-wals-grambank-scraper.ts",
        "WALS and Grambank typological feature values",
        "grammar-features-wals-grambank.tsv",
        Coverage.NEW,
        "wals-cldf grambank-cldf",
        "`wals` already read this dataset off disk; the new pair fetches both "
        "CLDF releases through the shared cached client, so Grambank is covered "
        "at all and neither needs a manual download.",
    ),
    _row(
        "incremental-scraper.ts",
        "content-hash change detection between acquisition runs",
        "",
        Coverage.MODULE,
        "",
        "Never a scraper: it hashed rows to decide what changed. The engine "
        "does that over dumps with content fingerprints and drives the upsert "
        "from the result.",
        replacement="engine/src/pinakes_engine/acquire/wikidata_diff.py",
    ),
    _row(
        "language-contact-scraper.ts",
        "language-contact events and transferred features",
        "language-contacts.tsv",
        Coverage.NEW,
        "language-contacts",
        "Contact events are asserted in the literature rather than coded in a "
        "database; no open dataset covers them.",
    ),
    _row(
        "music-scraper.ts",
        "musical traditions and instruments",
        "music-traditions.tsv musical-instruments.tsv",
        Coverage.NEW,
        "music-traditions",
        "`musical-instruments` and `percussion-instruments` already acquire the "
        "instruments from Wikidata. The traditions that play them did not exist "
        "as a class there.",
    ),
    _row(
        "polity-scraper.ts",
        "Seshat polities, enriched from Wikipedia",
        "civilizations.tsv",
        Coverage.NEW,
        "seshat-polities",
        "Its forty-four hard-coded polity ids are gone — `city-states`, "
        "`kingdoms`, `empires`, `dynasties`, `realms` and `historical-countries` "
        "acquire polities from Wikidata by class. What was worth keeping is "
        "Seshat's own coded record, which nothing else has.",
    ),
    _row(
        "religion-scraper.ts",
        "religions, their texts, pantheons and practices",
        "religions.tsv",
        Coverage.EXISTING,
        "religions religious-texts religious-organizations deities mythologies",
        "Five categories acquire this domain from Wikidata, including the "
        "deities and sacred texts the generated rows only named in a cell.",
    ),
    _row(
        "settlements-scraper.ts",
        "historical settlements",
        "settlements.tsv",
        Coverage.NEW,
        "settlements",
        "Reached by no route even before this story. Kept because the "
        "settlements table is what city-layouts and the map layers join against.",
    ),
    _row(
        "sound-change-scraper.ts",
        "regular sound changes, per language family",
        "sound-changes.tsv",
        Coverage.NEW,
        "sound-changes",
        "Its sixteen per-family briefs came across verbatim as the category's "
        "`prompt.*` passes; they are the coverage. The sixteen copies of the "
        "boilerplate around them did not.",
    ),
    _row(
        "trade-goods-scraper.ts",
        "traded commodities and the routes they travelled",
        "trade-goods.tsv trade-routes.tsv",
        Coverage.NEW,
        "trade-goods trade-routes",
        "`materials`, `textiles`, `currency` and `crafts` acquire many of the "
        "commodities from Wikidata, but neither the trade relation nor the "
        "route geometry exists there as a class.",
    ),
    _row(
        "underrepresented-vocab-scraper.ts",
        "core vocabulary for under-documented languages",
        "words.tsv",
        Coverage.NEW,
        "underrepresented-vocab",
        "`kaikki` and `lexibank-abvd` acquire real lexical data. Neither can "
        "reach a language with no dictionary, which is the only reason this "
        "pass survives at all — and the brief now says to skip a language that "
        "does have one.",
    ),
    _row(
        "verb-paradigm-scraper.ts",
        "inflected verb paradigms from UniMorph and Wiktionary",
        "verb-paradigms.tsv",
        Coverage.NEW,
        "verb-paradigms",
        "UniMorph publishes headerless lemma/form/features triples per language "
        "repository; `source.params.columns` is what lets the shared tabular "
        "reader take them.",
    ),
    _row(
        "wikimedia-commons-scraper.ts",
        "Commons category members with licence and author metadata",
        "wikimedia-commons-images.tsv",
        Coverage.NEW,
        "commons-images",
        "MediaWiki paginates on an opaque continuation token rather than a "
        "next-page URL, which is what the REST adapter's `next_param` is for.",
    ),
    _row(
        "wiktionary-phonology-scraper.ts",
        "pronunciation sections parsed out of Wiktionary",
        "phonological-inventories.tsv",
        Coverage.NEW,
        "wiktionary-phonology",
        "`phoible` already acquires coded phoneme inventories; Wiktionary is "
        "the long tail it does not reach.",
    ),
    _row(
        "word-list-scraper.ts",
        "Swadesh-style concept word lists",
        "words.tsv",
        Coverage.EXISTING,
        "kaikki lexibank-abvd underrepresented-vocab",
        "Two categories acquire real wordlists from published datasets, and the "
        "under-documented tail has its own pass.",
    ),
    _row(
        "writing-system-scraper.ts",
        "writing systems, from CLDR script metadata plus a model",
        "writing-systems.tsv",
        Coverage.NEW,
        "cldr-scripts",
        "`writing-systems` and `alphabets` already acquire the systems "
        "themselves from Wikidata; CLDR's per-script metadata (direction, "
        "density, sample character) is the part that was only reachable here.",
    ),
    _row(
        "batch-enrichment.ts",
        "generic top-up of any under-populated lexicon file",
        "",
        Coverage.MODULE,
        "",
        "This one was already the generalisation the other seventeen wanted: it "
        "derived both its prompt and its response schema from the target file's "
        "own header row. That idea is now the whole generation adapter, which is "
        "why there are three new adapters and not twenty-seven.",
        replacement="engine/src/pinakes_engine/acquire/generate.py",
    ),
    _row(
        "culture-profile-enrichment.ts",
        "culture profiles and their daily-life, layout and structure tables",
        "culture-profiles.tsv city-layouts.tsv daily-life.tsv "
        "social-structures.tsv",
        Coverage.NEW,
        "culture-profiles city-layouts daily-life social-structures",
        "Four tables, one per generated shape. `dialects` and `civilizations` "
        "supply the cultures themselves; what is generated is what a culture "
        "was like to live in, which no database holds.",
    ),
    _row(
        "grammar-enrichment.ts",
        "per-language grammatical profiles",
        "grammar-features.tsv",
        Coverage.NEW,
        "grammar-features",
        "Fills the gaps WALS and Grambank leave. Those two are acquired as real "
        "coded data by `wals-cldf` and `grambank-cldf`, and the category's brief "
        "says so — a generated profile must never overwrite a coded one.",
    ),
    _row(
        "language-enrichment.ts",
        "language records — speakers, status, classification",
        "languages.tsv",
        Coverage.EXISTING,
        "languages dialects language-families glottolog",
        "Four categories acquire this from Wikidata and Glottolog, with the "
        "genealogy the generated rows could only approximate.",
    ),
    _row(
        "phonology-enrichment.ts",
        "phoneme inventories per language",
        "phonological-inventories.tsv",
        Coverage.EXISTING,
        "phoible wiktionary-phonology",
        "PHOIBLE is the field's reference inventory dataset and was already "
        "acquired here; Wiktionary covers what it omits.",
    ),
)


class UnknownRetiredScraperError(KeyError):
    """Raised when a module name is not in the retirement table."""


def coverage_for(module: str) -> RetiredScraper:
    """Return the retirement row for *module*.

    *module* may be the full repository-relative path or just the file name.

    Raises:
        UnknownRetiredScraperError: If no row names it.
    """
    for row in RETIRED_SCRAPERS:
        if row.module == module or row.module.rsplit("/", 1)[-1] == module:
            return row
    raise UnknownRetiredScraperError(
        f"{module!r} is not a retired scraper; known: "
        + ", ".join(sorted(r.module.rsplit("/", 1)[-1] for r in RETIRED_SCRAPERS))
    )


def migrated_category_ids() -> frozenset[str]:
    """Every category id the retirement table depends on."""
    return frozenset(
        category for row in RETIRED_SCRAPERS for category in row.categories
    )


def category_path(category_id: str, *, root: Path | None = None) -> Path:
    """Where *category_id*'s spec lives, relative to the package root.

    *root* defaults to the package root (``engine/``), computed from this
    file's location — ``src/pinakes_engine/acquire/`` is three levels down.
    """
    base = root if root is not None else Path(__file__).resolve().parents[3]
    return base / CATEGORY_DIR / f"{category_id}.yml"
