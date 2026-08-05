"""The general corpus reader, against fixtures and against the live corpus.

`server/tsv-storage.ts` is graded two ways here, the same shape
`test_data_quality.py` uses. The synthetic half pins the dialect decisions a
whole-corpus count can never see — a short row, a blank cell, a `"null"`
sentinel, an unparseable JSON array — one case per decision. The live half is
the strong one: it asserts the row counts the repo already documents, so the
port goes red if either the reader or the corpus drifts.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pinakes_contracts import contracts_dir

from pinakes.analytics import tsv
from pinakes.lexicons import storage

#: The live corpus, located through the contracts package rather than a
#: `parents[n]` walk. `conftest.py` redirects the *env* to a temp tree, so every
#: reader here is handed this path explicitly and nothing writes.
LIVE_LEXICONS = contracts_dir().parent / "data" / "source" / "lexicons"


def write(lexicons: Path, filename: str, *lines: str) -> Path:
    lexicons.mkdir(parents=True, exist_ok=True)
    path = lexicons / filename
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


# ── An absent file is an empty domain ────────────────────────────────────────


@pytest.mark.parametrize(
    "load",
    [
        storage.load_languages,
        storage.load_language_families,
        storage.load_religions,
        storage.load_battles,
        storage.load_cuisines,
        storage.load_deities,
        storage.load_trade_goods,
        storage.load_writing_systems,
        storage.load_culture_profiles,
        storage.load_innovations,
        storage.load_urheimat_hypotheses,
        storage.load_civilizations,
        storage.load_archaeological_sites,
    ],
)
def test_a_missing_file_is_an_empty_domain_not_an_error(
    tmp_path: Path, load: object
) -> None:
    """`readFileIfExists` returning null is how the loaders spell "not here"."""
    assert load(tmp_path) == []  # type: ignore[operator]


# ── The two language loaders ─────────────────────────────────────────────────


def test_a_language_without_a_family_is_not_a_language(tmp_path: Path) -> None:
    """`id`, `name` *and* `family_id` are all required to survive the loader."""
    write(
        tmp_path,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus",
        "eng\tEnglish\tindo_european\tliving",
        "orphan\tOrphan\t\tliving",
        "\tNameless\tindo_european\tliving",
    )
    assert [row["id"] for row in storage.load_languages(tmp_path)] == ["eng"]


def test_a_broken_language_file_is_empty_rather_than_an_error(tmp_path: Path) -> None:
    """`loadScrapedLanguages` catches its own `getIdx` — a warn, then `[]`."""
    write(tmp_path, "languages.tsv", "id\tname", "eng\tEnglish")
    assert storage.load_languages(tmp_path) == []


def test_a_blank_status_stays_blank_but_a_short_row_is_living(
    tmp_path: Path,
) -> None:
    """`r[idx] ?? "living"` is nullish: only an *absent* cell takes the default."""
    write(
        tmp_path,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus",
        "a\tA\tf\t",
        "b\tB\tf",
    )
    declared, short = storage.load_languages(tmp_path)
    assert declared["status"] == ""
    assert short["status"] == "living"


def test_coordinates_need_both_halves_to_be_numbers(tmp_path: Path) -> None:
    """A language is the one domain whose coordinate can be genuinely absent.

    But "absent" means **not a number**, not "blank": `Number("")` is `0`, so a
    row with a latitude and an empty longitude lands on the prime meridian
    rather than dropping out. That is the TypeScript, and it is why the null
    case has to be tested with a word rather than with a blank.
    """
    write(
        tmp_path,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus\tlatitude\tlongitude",
        "a\tA\tf\tliving\t51.5\t-0.1",
        "b\tB\tf\tliving\t51.5\t",
        "c\tC\tf\tliving\tnorth\t-0.1",
        "d\tD\tf\tliving\t\t",
    )
    a, b, c, d = storage.load_languages(tmp_path)
    assert a["coordinates"] == {"lat": 51.5, "lng": -0.1}
    assert b["coordinates"] == {"lat": 51.5, "lng": 0.0}
    assert c["coordinates"] is None
    assert d["coordinates"] == {"lat": 0.0, "lng": 0.0}


def test_a_zero_speaker_count_reads_as_unknown(tmp_path: Path) -> None:
    """`Number(cell) || null` — a zero is indistinguishable from unstated."""
    write(
        tmp_path,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus\ttotal_speakers",
        "a\tA\tf\tliving\t0",
        "b\tB\tf\tliving\t1200",
    )
    zero, some = storage.load_languages(tmp_path)
    assert zero["totalSpeakers"] is None
    assert some["totalSpeakers"] == 1200


def test_family_language_counts_are_recomputed_over_descendants(
    tmp_path: Path,
) -> None:
    """The corpus's own `language_count` cell is advisory; the served one is derived."""
    write(
        tmp_path,
        "families.tsv",
        "id\tname\tparent_id\ttaxonomic_level\tlanguage_count",
        "root\tRoot\t\tfamily\t999",
        "branch\tBranch\troot\tbranch\t999",
        "leaf\tLeaf\tbranch\tsubgroup\t999",
    )
    write(
        tmp_path,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus",
        "one\tOne\tleaf\tliving",
        "two\tTwo\tbranch\tliving",
    )
    counts = {
        family["id"]: family["languageCount"]
        for family in storage.language_families_with_counts(tmp_path)
    }
    assert counts == {"root": 2, "branch": 2, "leaf": 1}


def test_a_self_parenting_family_terminates(tmp_path: Path) -> None:
    """The TypeScript's recursion has no cycle guard; a finite answer is better."""
    write(
        tmp_path,
        "families.tsv",
        "id\tname\tparent_id\ttaxonomic_level",
        "loop\tLoop\tloop\tfamily",
    )
    header = "id\tname\tfamily_id\tstatus"
    write(tmp_path, "languages.tsv", header, "a\tA\tloop\tliving")
    assert storage.language_families_with_counts(tmp_path)[0]["languageCount"] == 1


# ── The GeoJSON layers ───────────────────────────────────────────────────────


def test_a_site_without_parseable_coordinates_does_not_exist(tmp_path: Path) -> None:
    """The loader filters it out, so its URL and its citation are both 404s."""
    write(
        tmp_path,
        "archaeological-sites.tsv",
        "id\tname\tcoordinates\tsite_type",
        'good\tGood\t{"lat": 1, "lng": 2}\tsettlement',
        "blank\tBlank\t\tsettlement",
        "broken\tBroken\t{oops\tsettlement",
    )
    sites = storage.load_archaeological_sites(tmp_path)
    assert [site["id"] for site in sites] == ["good"]
    # GeoJSON is `[lng, lat]`; the corpus cell is `{lat, lng}`.
    assert sites[0]["geometry"]["coordinates"] == [2, 1]


def test_a_site_defaults_importance_and_confidence_to_fifty(tmp_path: Path) -> None:
    write(
        tmp_path,
        "archaeological-sites.tsv",
        "id\tname\tcoordinates\tsite_type\timportance\tconfidence",
        'a\tA\t{"lat": 1, "lng": 2}\tsettlement\t\t80',
        'b\tB\t{"lat": 1, "lng": 2}\tsettlement\t10\t',
    )
    a, b = storage.load_archaeological_sites(tmp_path)
    assert (a["properties"]["importance"], a["properties"]["confidence"]) == (50, 80)
    assert (b["properties"]["importance"], b["properties"]["confidence"]) == (10, 50)


def test_a_civilization_without_a_boundary_gets_a_placeholder(tmp_path: Path) -> None:
    """Every feature in the layer has a geometry, so the map never drops one."""
    write(tmp_path, "civilizations.tsv", "id\tname", "nowhere\tNowhere")
    feature = storage.load_civilizations(tmp_path)[0]
    assert feature["geometry"] == {
        "type": "Polygon",
        "coordinates": storage.PLACEHOLDER_RING,
    }
    assert feature["properties"]["timePeriod"] == {"start": 0, "end": None, "label": ""}


def test_a_civilization_inherits_its_boundary_time_period(tmp_path: Path) -> None:
    """A blank `time_period_start` falls through to the boundary row's."""
    write(
        tmp_path,
        "civilizations.tsv",
        "id\tname\ttime_period_start\ttime_period_end",
        "rome\tRome\t\t",
    )
    write(
        tmp_path,
        "civilization-boundaries.tsv",
        "civilization_id\tgeometry\ttime_period_start\ttime_period_end\ttime_period_label",
        'rome\t{"type": "Point", "coordinates": [12, 41]}\t-753\t476\tRoman',
    )
    feature = storage.load_civilizations(tmp_path)[0]
    assert feature["geometry"] == {"type": "Point", "coordinates": [12, 41]}
    assert feature["properties"]["timePeriod"] == {
        "start": -753,
        "end": 476,
        "label": "Roman",
    }


def test_a_blank_label_column_does_not_fall_through_to_the_boundary(
    tmp_path: Path,
) -> None:
    """`row[labelIdx] || ""` — the boundary label backs a missing *column* only."""
    write(
        tmp_path,
        "civilizations.tsv",
        "id\tname\ttime_period_label",
        "rome\tRome\t",
    )
    write(
        tmp_path,
        "civilization-boundaries.tsv",
        "civilization_id\tgeometry\ttime_period_label",
        'rome\t{"type": "Point", "coordinates": [12, 41]}\tRoman',
    )
    assert storage.load_civilizations(tmp_path)[0]["properties"]["timePeriod"][
        "label"
    ] == ""


def test_undefined_civilization_properties_are_omitted_not_nulled(
    tmp_path: Path,
) -> None:
    """`JSON.stringify` drops an `undefined` key; a null one is a different record."""
    write(tmp_path, "civilizations.tsv", "id\tname\tcapital", "rome\tRome\t")
    properties = storage.load_civilizations(tmp_path)[0]["properties"]
    assert "capital" not in properties
    assert "nativeName" not in properties


def test_a_zero_confidence_survives_the_finiteness_test(tmp_path: Path) -> None:
    """`Number.isFinite(0)` is true — the one place a zero is not "missing"."""
    write(tmp_path, "civilizations.tsv", "id\tname\tconfidence", "rome\tRome\t0")
    assert storage.load_civilizations(tmp_path)[0]["properties"]["confidence"] == 0


# ── The flat domains ─────────────────────────────────────────────────────────


def test_a_deity_reads_either_column_spelling(tmp_path: Path) -> None:
    """`mythology` else `pantheon`, `equivalent_deity_ids` else `syncretism_links`."""
    write(
        tmp_path,
        "deities.tsv",
        "id\tname\tpantheon\tsyncretism_links",
        'zeus\tZeus\tGreek\t["jupiter"]',
    )
    deity = storage.load_deities(tmp_path)[0]
    assert deity["mythology"] == "Greek"
    assert deity["equivalentDeityIds"] == ["jupiter"]


def test_the_null_sentinel_is_read_by_name(tmp_path: Path) -> None:
    """Several columns were written by a serializer that stringified `null`."""
    write(
        tmp_path,
        "religions.tsv",
        "id\tname\ttime_origin\ttime_end",
        "a\tA\tnull\t400",
    )
    religion = storage.load_religions(tmp_path)[0]
    assert religion["timeOrigin"] is None
    assert religion["timeEnd"] == 400


def test_an_unparseable_json_array_is_empty_never_an_error(tmp_path: Path) -> None:
    """Half the corpus's array columns are hand-authored."""
    write(
        tmp_path,
        "religions.tsv",
        "id\tname\tsacred_texts",
        "a\tA\t[not json",
    )
    assert storage.load_religions(tmp_path)[0]["sacredTexts"] == []


def test_a_blank_coordinate_cell_is_the_origin(tmp_path: Path) -> None:
    """Reproduced, not fixed: such rows really do cluster at Null Island."""
    write(tmp_path, "cuisines.tsv", "id\tname\tcoordinates", "a\tA\t")
    assert storage.load_cuisines(tmp_path)[0]["coordinates"] == storage.ORIGIN


def test_trade_goods_require_every_column(tmp_path: Path) -> None:
    """This loader reads all nine with `getIdx` — stricter than its neighbours."""
    write(tmp_path, "trade-goods.tsv", "id\tname", "tg\tSilk")
    with pytest.raises(tsv.MissingColumnError):
        storage.load_trade_goods(tmp_path)


def test_a_zero_population_estimate_reads_as_unknown(tmp_path: Path) -> None:
    """`parseInt(cell, 10) || null` — the same shape as the speaker counts."""
    write(
        tmp_path,
        "culture-profiles.tsv",
        "id\tname\tpopulation_estimate",
        "a\tA\t0",
        "b\tB\t5000",
    )
    zero, some = storage.load_culture_profiles(tmp_path)
    assert zero["populationEstimate"] is None
    assert some["populationEstimate"] == 5000


def test_find_by_id_returns_the_first_match() -> None:
    records: list[storage.Record] = [
        {"id": "a", "n": 1},
        {"id": "b"},
        {"id": "a", "n": 2},
    ]
    assert storage.find_by_id(records, "a") == {"id": "a", "n": 1}
    assert storage.find_by_id(records, "z") is None


# ── The live corpus ──────────────────────────────────────────────────────────
#
# `server/CLAUDE.md`: assert on **counts**, not on a 200. A wrong lexicons path
# fails quietly — `readFileIfExists` returns null and the domain reads empty —
# so a count is the only assertion that catches it.


@pytest.mark.parametrize(
    ("load", "expected"),
    [
        # The first two are the counts `server/CLAUDE.md` names as the assertion
        # that catches a wrong lexicons path; the rest are this reader's own
        # answer against the committed corpus, pinned so a loader that starts
        # dropping rows says so.
        (storage.load_languages, 1099),
        (storage.language_families_with_counts, 543),
        (storage.load_civilizations, 170),
        (storage.load_archaeological_sites, 550),
        (storage.load_deities, 206),
        (storage.load_religions, 20),
        (storage.load_cuisines, 101),
        (storage.load_culture_profiles, 170),
    ],
)
def test_the_live_corpus_loads_the_row_counts_the_repo_documents(
    load: object, expected: int
) -> None:
    assert len(load(LIVE_LEXICONS)) == expected  # type: ignore[operator]


def test_every_live_domain_loads_at_least_one_row() -> None:
    """A loader that silently reads nothing is the failure mode to catch."""
    empty = [
        name
        for name, load in (
            ("languages", storage.load_languages),
            ("families", storage.load_language_families),
            ("civilizations", storage.load_civilizations),
            ("archaeological-sites", storage.load_archaeological_sites),
            ("deities", storage.load_deities),
            ("religions", storage.load_religions),
            ("cuisines", storage.load_cuisines),
            ("battles", storage.load_battles),
            ("trade-goods", storage.load_trade_goods),
            ("writing-systems", storage.load_writing_systems),
            ("culture-profiles", storage.load_culture_profiles),
            ("innovations", storage.load_innovations),
            ("urheimat-hypotheses", storage.load_urheimat_hypotheses),
        )
        if not load(LIVE_LEXICONS)
    ]
    assert not empty, f"loaded nothing for {empty}"
