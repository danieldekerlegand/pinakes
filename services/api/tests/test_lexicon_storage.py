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
        storage.load_myth_motifs,
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
        storage.load_music_traditions,
        storage.load_musical_instruments,
        storage.load_cuisine_items,
        storage.load_migration_routes,
        storage.load_art_traditions,
        storage.load_architectural_styles,
        storage.load_kinship_systems,
        storage.load_foodway_events,
        storage.load_settlements,
        # The pinakes:80 US-1 slice-four loaders.
        storage.load_haplogroups,
        storage.load_dance_traditions,
        storage.load_ingredient_origins,
        storage.load_cooking_techniques,
        storage.load_sample_texts,
        storage.load_phonological_inventories,
        storage.load_etymology_relations,
        storage.load_grammar_features,
        storage.load_verb_paradigms,
        storage.load_language_contacts,
        storage.load_sound_changes,
        storage.load_style_evolutions,
        storage.load_building_types,
        storage.load_city_layouts,
        storage.load_social_organization,
        storage.load_social_structures,
        storage.load_narratives,
        storage.load_cultural_lineages,
        storage.load_literary_traditions,
        storage.load_literary_works,
        storage.load_rivers_and_waters,
        storage.load_daily_life,
        storage.load_culture_events,
        storage.load_wikimedia_commons_images,
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
        (storage.load_myth_motifs, 61),
        (storage.load_religions, 20),
        (storage.load_cuisines, 101),
        (storage.load_culture_profiles, 170),
        # The ten pinakes:63 US-2 loaders, each checked against the same
        # `storage.get*()` call on the live corpus before being pinned here.
        (storage.load_base_words, 1016),
        (storage.load_music_traditions, 20),
        (storage.load_musical_instruments, 25),
        (storage.load_cuisine_items, 2097),
        (storage.load_migration_routes, 104),
        (storage.load_art_traditions, 35),
        (storage.load_architectural_styles, 90),
        (storage.load_kinship_systems, 30),
        (storage.load_foodway_events, 51),
        (storage.load_settlements, 642),
        # The eight pinakes:80 US-1 geospatial loaders, likewise diffed against
        # the live Express app before being pinned. `load_empires_timeline` has
        # no entry because it *raises* on this corpus — see
        # `test_the_empires_timeline_feature_loader_raises_on_the_live_corpus`.
        (storage.load_language_ranges, 8),
        (storage.load_language_range_polygons, 133),
        (storage.load_historical_routes, 104),
        (storage.load_material_cultures, 45),
        (storage.load_archaeological_cultures, 277),
        (storage.load_trade_routes, 39),
        (storage.load_empire_timeline, 115),
        # The twenty-three pinakes:80 US-1 slice-four loaders, each proved
        # byte-identical to the live Express app over 341 requests before being
        # pinned here. `load_ingredient_origins` has no entry because it
        # *raises* on this corpus — see
        # `test_the_ingredient_origin_loader_raises_on_the_live_corpus`, and
        # `wikimedia-commons-images.tsv` does not exist at all, which is the
        # empty payload both backends answer with.
        (storage.load_haplogroups, 62),
        (storage.load_dance_traditions, 92),
        (storage.load_cooking_techniques, 92),
        (storage.load_sample_texts, 150),
        (storage.load_phonological_inventories, 1077),
        (storage.load_etymology_relations, 5180),
        (storage.load_grammar_features, 1091),
        (storage.load_verb_paradigms, 94),
        (storage.load_language_contacts, 95),
        (storage.load_sound_changes, 48),
        (storage.load_style_evolutions, 4),
        (storage.load_building_types, 57),
        (storage.load_city_layouts, 15),
        (storage.load_social_organization, 5),
        (storage.load_social_structures, 310),
        (storage.load_narratives, 21),
        (storage.load_cultural_lineages, 95),
        (storage.load_literary_traditions, 62),
        (storage.load_literary_works, 22),
        (storage.load_rivers_and_waters, 21),
        (storage.load_daily_life, 520),
        (storage.load_culture_events, 78),
        (storage.load_wikimedia_commons_images, 0),
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
            ("myth-motifs", storage.load_myth_motifs),
            ("religions", storage.load_religions),
            ("cuisines", storage.load_cuisines),
            ("battles", storage.load_battles),
            ("trade-goods", storage.load_trade_goods),
            ("writing-systems", storage.load_writing_systems),
            ("culture-profiles", storage.load_culture_profiles),
            ("innovations", storage.load_innovations),
            ("urheimat-hypotheses", storage.load_urheimat_hypotheses),
            ("words-base", storage.load_base_words),
            ("music-traditions", storage.load_music_traditions),
            ("musical-instruments", storage.load_musical_instruments),
            ("cuisine-items", storage.load_cuisine_items),
            ("migration-routes", storage.load_migration_routes),
            ("art-traditions", storage.load_art_traditions),
            ("architectural-styles", storage.load_architectural_styles),
            ("kinship-systems", storage.load_kinship_systems),
            ("foodway-events", storage.load_foodway_events),
            ("settlements", storage.load_settlements),
            ("language-ranges", storage.load_language_ranges),
            ("language-range-polygons", storage.load_language_range_polygons),
            ("historical-routes", storage.load_historical_routes),
            ("material-culture", storage.load_material_cultures),
            ("archaeological-cultures", storage.load_archaeological_cultures),
            ("trade-routes", storage.load_trade_routes),
            ("empire-timeline", storage.load_empire_timeline),
            ("haplogroups", storage.load_haplogroups),
            ("dance-traditions", storage.load_dance_traditions),
            ("cooking-techniques", storage.load_cooking_techniques),
            ("sample-texts", storage.load_sample_texts),
            ("phonological-inventories", storage.load_phonological_inventories),
            ("etymology-relations", storage.load_etymology_relations),
            ("grammar-features", storage.load_grammar_features),
            ("verb-paradigms", storage.load_verb_paradigms),
            ("language-contacts", storage.load_language_contacts),
            ("sound-changes", storage.load_sound_changes),
            ("art-style-evolutions", storage.load_style_evolutions),
            ("building-types", storage.load_building_types),
            ("city-layouts", storage.load_city_layouts),
            ("social-organization", storage.load_social_organization),
            ("social-structures", storage.load_social_structures),
            ("narratives", storage.load_narratives),
            ("cultural-lineages", storage.load_cultural_lineages),
            ("literary-traditions", storage.load_literary_traditions),
            ("literary-works", storage.load_literary_works),
            ("rivers-and-waters", storage.load_rivers_and_waters),
            ("daily-life", storage.load_daily_life),
            ("culture-events", storage.load_culture_events),
        )
        if not load(LIVE_LEXICONS)
    ]
    assert not empty, f"loaded nothing for {empty}"


def test_the_empires_timeline_feature_loader_raises_on_the_live_corpus() -> None:
    """Two loaders read `empires-timeline.tsv` and only one of them can.

    `loadEmpiresTimeline` asks for a `name` column with ``getIdx`` and the file
    carries the *event* vocabulary (`year`, `event_type`, `empire_name`), so
    `GET /api/map/empires-timeline` is a 500 on both backends. Asserting it here
    rather than treating it as a bug is deliberate: the day the corpus grows the
    phase vocabulary this test is the thing that says the layer just came alive.
    """
    with pytest.raises(tsv.MissingColumnError):
        storage.load_empires_timeline(LIVE_LEXICONS)


# ── The pinakes:63 US-2 loaders' own dialect decisions ───────────────────────


def test_words_base_is_the_one_loader_that_raises_on_a_missing_file(
    tmp_path: Path,
) -> None:
    """``readFileOrThrow``, not ``readFileIfExists`` — and it is load-bearing.

    Every other domain reads empty when its file is gone. The concept list is
    the vocabulary spine, and an empty one would make `/api/search` answer as if
    the corpus simply had no words rather than admitting it is broken.
    """
    with pytest.raises(FileNotFoundError):
        storage.load_base_words(tmp_path)


def test_base_words_drop_unusable_rows_and_sort_by_number(tmp_path: Path) -> None:
    """No id, no gloss, or a non-numeric `number` and the row is gone.

    The `number` cell is read with a comma swapped for a dot — the source list
    writes European decimals — and only the **first** comma, as `String.replace`
    with a string pattern does.
    """
    write(
        tmp_path,
        "words-base.tsv",
        "number\tid_nelex\tgloss_en",
        "3\tthree\tthree",
        "1,5\thalf\tone and a half",
        "2\t\tno id",
        "4\tno-gloss\t",
        "x\tnan\tnot a number",
    )
    words = storage.load_base_words(tmp_path)
    assert [(word["id"], word["position"]) for word in words] == [
        ("half", 1.5),
        ("three", 3),
    ]


def test_a_migration_route_with_no_waypoints_gets_an_object_not_a_list(
    tmp_path: Path,
) -> None:
    """The one JSON column here whose fallback is ``{}`` — it is a geometry."""
    write(
        tmp_path,
        "migration-routes.tsv",
        "id\tname\twaypoints\tpeoples",
        "r1\tRoute\tnot json\tnot json",
    )
    route = storage.load_migration_routes(tmp_path)[0]
    assert route["waypoints"] == {}
    assert route["peoples"] == []


def test_foodway_coordinates_are_pairs_and_art_coordinates_are_objects(
    tmp_path: Path,
) -> None:
    """Two shapes for "where", in two files, both corpus rather than slip."""
    write(
        tmp_path,
        "foodway-events.tsv",
        "id\tname\tfood_item\torigin_region\torigin_coordinates"
        "\tdestination_region\tdestination_coordinates\tdate",
        "f1\tMaize\tmaize\tMesoamerica\tbroken\tIberia\t\t1500",
    )
    write(
        tmp_path,
        "art-traditions.tsv",
        "id\tname\tcategory\tstyle_period\torigin_date\tend_date"
        "\torigin_coordinates\tdescription\tassociated_languages"
        "\tkey_features\tnotable_examples",
        "a1\tMinoan\tfresco\tBronze Age\t-2000\t-1400\tbroken\t\t[]\t[]\t[]",
    )
    event = storage.load_foodway_events(tmp_path)[0]
    assert event["originCoordinates"] == [0, 0]
    assert event["destinationCoordinates"] == [0, 0]
    assert storage.load_art_traditions(tmp_path)[0]["originCoordinates"] == {
        "lat": 0.0,
        "lng": 0.0,
    }


def test_a_settlement_with_a_blank_coordinate_sits_at_the_origin(
    tmp_path: Path,
) -> None:
    """``parseFloat(cell) || 0`` — and a peak population of 0 is *unknown*."""
    write(
        tmp_path,
        "settlements.tsv",
        "id\tname\tlatitude\tlongitude\tpeak_population\tfounded_year",
        "s1\tNowhere\t\tnot a number\t0\tnull",
    )
    settlement = storage.load_settlements(tmp_path)[0]
    assert (settlement["latitude"], settlement["longitude"]) == (0, 0)
    assert settlement["peakPopulation"] is None
    assert settlement["foundedYear"] is None


def test_a_kinship_system_has_no_name_column_at_all(tmp_path: Path) -> None:
    """Which is why global search displays it as ``"<system type> (<id>)"``."""
    write(
        tmp_path,
        "kinship-systems.tsv",
        "id\tsystem_type\tlanguage_ids\tterminology\tdescent_rule",
        "k1\tIroquois\t[]\t{}\tmatrilineal",
    )
    system = storage.load_kinship_systems(tmp_path)[0]
    assert "name" not in system
    assert system["systemType"] == "Iroquois"
    assert system["residenceRule"] == ""


# ── The pinakes:80 US-1 additions ────────────────────────────────────────────


def test_belligerents_are_objects_not_stringified_items(tmp_path: Path) -> None:
    """The one JSON column in this corpus whose items are not strings.

    It had been read with the string-array reader, which rendered each side as
    ``"{'name': …}"`` — so `/api/battles?civilization_id=` matched nothing and
    the response body was wrong wherever a battle appeared. `JSON.parse` kept
    the objects; found porting the route.
    """
    write(
        tmp_path,
        "battles.tsv",
        "id\tname\tdate\tbelligerents",
        'b1\tKadesh\t-1274\t[{"name":"Egypt","civilization_id":"egypt"}]',
        "b2\tUnparseable\t-1\tnot json",
    )
    battles = storage.load_battles(tmp_path)
    assert battles[0]["belligerents"] == [
        {"name": "Egypt", "civilization_id": "egypt"}
    ]
    assert battles[1]["belligerents"] == []


def test_a_myth_motif_reads_every_optional_column_through_index_of(
    tmp_path: Path,
) -> None:
    """Only `id` and `name` are required; the live file spells half of the rest
    differently (`atu_index`, `geographic_distribution`) and simply reads blank."""
    write(
        tmp_path,
        "myth-motifs.tsv",
        "id\tname\tassociated_deity_ids\ttime_origin",
        'm1\tGreat Flood\t["zeus"]\tnull',
    )
    motif = storage.load_myth_motifs(tmp_path)[0]
    assert motif["associatedDeityIds"] == ["zeus"]
    assert motif["timeOrigin"] is None
    assert (motif["motifType"], motif["region"], motif["thompsonIndex"]) == ("", "", "")


# ── The pinakes:80 US-1 slice-four loaders' own dialect decisions ────────────


def test_the_ingredient_origin_loader_raises_on_the_live_corpus() -> None:
    """`ingredient-origins.tsv` has no `category` column, and never had one.

    `loadIngredientOrigins` asks for it with ``getIdx``, so both
    `/api/ingredient-origins` and its `{id}` sibling are a **500** on both
    backends against the committed corpus — the same shape as
    `test_the_empires_timeline_feature_loader_raises_on_the_live_corpus`, and
    kept for the same reason. The file carries `cuisine_id`; whichever way that
    is reconciled, this test is what will say the domain came alive.
    """
    with pytest.raises(tsv.MissingColumnError):
        storage.load_ingredient_origins(LIVE_LEXICONS)


def test_a_haplogroup_parent_of_the_string_null_is_a_root(tmp_path: Path) -> None:
    """`parent_id` is the one column tested against the literal ``"null"`` here,
    and it is what makes `?parentId=null` select the roots of the tree."""
    write(
        tmp_path,
        "haplogroups.tsv",
        "id\tname\tparent_id",
        "R\tR\tnull",
        "R1\tR1\tR",
        "R2\tR2\t",
    )
    root, child, blank = storage.load_haplogroups(tmp_path)
    assert root["parentId"] is None
    assert child["parentId"] == "R"
    assert blank["parentId"] is None
    assert root["haplogroupType"] == "Y-chromosome"


def test_phonological_tones_keep_null_and_the_empty_list_apart(
    tmp_path: Path,
) -> None:
    """A non-tonal language and a tonal one with no tones recorded are different
    claims, and `tones` is the only column in the corpus that carries both."""
    write(
        tmp_path,
        "phonological-inventories.tsv",
        "id\tlanguage_id\tconsonants\ttones",
        'p1\ta\t["p","t"]\t["high","low"]',
        "p2\tb\t[]\t[]",
        "p3\tc\t[]\tnull",
        "p4\td\t[]\t",
        "p5\te\t[]\tnot json",
    )
    tonal, empty, sentinel, blank, junk = storage.load_phonological_inventories(
        tmp_path
    )
    assert tonal["tones"] == ["high", "low"]
    assert empty["tones"] == []
    assert sentinel["tones"] is None
    assert blank["tones"] is None
    assert junk["tones"] is None


def test_a_river_reads_a_list_column_as_json_or_as_commas(tmp_path: Path) -> None:
    """`rivers-and-waters.tsv` is the only file whose reader sniffs its own cell.

    A value starting ``[`` is JSON; anything else is comma-separated. And
    `length_km` is ``parseInt(cell) || null``, so a river recorded as 0 km long
    reads as unmeasured rather than as zero.
    """
    write(
        tmp_path,
        "rivers-and-waters.tsv",
        "id\tname\talternate_names\tassociated_languages\tlength_km",
        'r1\tNile\t["Iteru","Hapi"]\takk, egy \t6650',
        "r2\tTigris\t[not json\t\t0",
    )
    nile, tigris = storage.load_rivers_and_waters(tmp_path)
    assert nile["alternateNames"] == ["Iteru", "Hapi"]
    assert nile["associatedLanguages"] == ["akk", "egy"]
    assert nile["lengthKm"] == 6650
    # A cell that *looks* like JSON and is not falls back to empty rather than
    # to a one-item comma split — only the leading `[` decides which rule runs.
    assert tigris["alternateNames"] == []
    assert tigris["lengthKm"] is None


def test_pipe_separated_lists_are_trimmed_for_layouts_and_not_for_structures(
    tmp_path: Path,
) -> None:
    """Two files store a list the same way and read it two different ways.

    `getCityLayouts` maps `trim` over the parts before dropping the empty ones;
    `getSocialStructures` only drops the empty ones. A cell written with spaces
    after the separators therefore keeps them in one domain and not the other.
    """
    write(
        tmp_path,
        "city-layouts.tsv",
        "id\tkey_features\testimated_area_hectares",
        "c1\tgrid | citadel |\tundetermined",
        "c2\t\t12.5",
    )
    write(
        tmp_path,
        "social-structures.tsv",
        "id\tculture_profile_id\tstructure_type\tname\tdescription\tkey_roles"
        "\tinheritance_pattern\tdecision_making\trelated_kinship_system_id"
        "\ttime_period_start\ttime_period_end\tsources",
        "s1\tcp\tclan\tClan\t-\telder | chief\t-\t-\t\t\t\t",
    )
    grid, blank = storage.load_city_layouts(tmp_path)
    assert grid["keyFeatures"] == ["grid", "citadel"]
    assert grid["estimatedAreaHectares"] is None
    assert blank["keyFeatures"] == []
    assert blank["estimatedAreaHectares"] == 12.5
    structure = storage.load_social_structures(tmp_path)[0]
    assert structure["keyRoles"] == ["elder ", " chief"]


def test_a_narrative_with_unusable_steps_loses_the_whole_column(
    tmp_path: Path,
) -> None:
    """``rawSteps.map`` throws on a non-array and the catch leaves `steps` empty
    — a partial reading was never on the table. Snake_case keys are renamed."""
    write(
        tmp_path,
        "narratives.tsv",
        "id\ttitle\tdescription\tsteps",
        'n1\tTour\t-\t[{"text":"Start","map_center":[10,20],"map_zoom":5}]',
        'n2\tBroken\t-\t{"text":"not an array"}',
        "n3\tJunk\t-\tnot json",
    )
    tour, broken, junk = storage.load_narratives(tmp_path)
    assert tour["steps"] == [
        {
            "text": "Start",
            "mapCenter": [10, 20],
            "mapZoom": 5,
            "timePoint": 0,
            "highlightedEntities": [],
            "layerConfig": {"layers": []},
        }
    ]
    assert broken["steps"] == []
    assert junk["steps"] == []


def test_a_verb_paradigm_is_irregular_only_for_the_exact_string_true(
    tmp_path: Path,
) -> None:
    """``cell === "true"`` — every other spelling is false, including ``"TRUE"``."""
    write(
        tmp_path,
        "verb-paradigms.tsv",
        "id\tlanguage_id\tirregular\tcomplexity_score",
        "v1\ta\ttrue\t7",
        "v2\tb\tTRUE\t",
        "v3\tc\t1\tnope",
    )
    yes, upper, one = storage.load_verb_paradigms(tmp_path)
    assert yes["irregular"] is True
    assert (upper["irregular"], one["irregular"]) == (False, False)
    assert (yes["complexityScore"], upper["complexityScore"]) == (7, 0)
    assert one["complexityScore"] == 0


def test_language_contacts_fall_back_to_three_empty_feature_buckets(
    tmp_path: Path,
) -> None:
    """The client indexes `phonological`/`lexical`/`grammatical` unconditionally,
    so a blank or unparseable cell is the three buckets and not ``{}``."""
    write(
        tmp_path,
        "language-contacts.tsv",
        "id\tsource_language_id\tfeatures_transferred",
        "c1\ta\t",
        "c2\tb\tnot json",
    )
    blank, junk = storage.load_language_contacts(tmp_path)
    empty: dict[str, list[str]] = {
        "phonological": [],
        "lexical": [],
        "grammatical": [],
    }
    assert blank["featuresTransferred"] == empty
    assert junk["featuresTransferred"] == empty


def test_the_commons_reader_treats_a_header_only_file_as_absent(
    tmp_path: Path,
) -> None:
    """`GET /api/wikimedia-commons-images` parses the file inline rather than
    through `tsv-storage.ts`, and ``lines.length <= 1`` is its own early exit."""
    write(tmp_path, "wikimedia-commons-images.tsv", "id\ttitle\timage_url")
    assert storage.load_wikimedia_commons_images(tmp_path) == []
    write(
        tmp_path,
        "wikimedia-commons-images.tsv",
        "id\ttitle\timage_url\tcategories\tcoordinates",
        'w1\tVase\thttps://x/v.jpg\t["pottery"]\t',
    )
    image = storage.load_wikimedia_commons_images(tmp_path)[0]
    assert image["categories"] == ["pottery"]
    assert image["coordinates"] is None
    assert image["artifactType"] == ""
