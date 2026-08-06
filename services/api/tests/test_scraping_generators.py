"""The two Gemini TSV generators — `POST /api/scraping/{families,mythology}`.

No fixture in `contracts/parity/` records a body for either route, so this file
is the grading. Every expectation in it came out of a live diff against the
Express app run in two rounds: the two route responses and the job ledger with
no `$GEMINI_API_KEY` (the normal state of a checkout), and then both generators
driven end to end over a stubbed `globalThis.fetch` — **eight model request
bodies, both progress logs, both returned record sets and all four written TSV
files compared byte for byte**, plus the failure, degrade and empty-input paths.
Zero unaccepted differences; the accepted ones are the millisecond in a job id
and two headers (`x-goog-api-client`, which is the SDK identifying itself, and
the engine client's `User-Agent`).

`conftest.py`'s autouse `reset_tsv_generators` releases the two concurrency
guards, `reset_scraping_jobs` empties the ledger, `reset_ingest_clients` drops
the memoised HTTP client, and `isolated_data_trees` points
`$PINAKES_LEXICONS_DIR` at a temp tree — **which is what keeps these tests from
overwriting the real corpus, since that is exactly what a successful run does.**
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pinakes_engine.acquire.http import HttpClient, HttpResponse

from pinakes.ingest import family_scraper, generation, jobs, mythology_scraper
from pinakes.ingest import http as ingest_http
from pinakes.lexicons import storage, writer


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


@pytest.fixture
def keyed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(generation.GEMINI_API_KEY_ENV, "stub-key")
    monkeypatch.setenv(generation.GEMINI_MODEL_ENV, "gemini-test")


class Replay:
    """A transport answering canned model payloads and recording the requests."""

    def __init__(self, answers: list[Any]) -> None:
        self.answers = list(answers)
        self.calls: list[dict[str, Any]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
        body: str | None = None,
    ) -> HttpResponse:
        self.calls.append(
            {
                "url": url,
                "headers": dict(headers),
                "body": json.loads(body) if body else None,
            }
        )
        envelope = {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [{"text": json.dumps(self.answers.pop(0))}],
                    }
                }
            ]
        }
        return HttpResponse(
            url=url, status_code=200, text=json.dumps(envelope), headers={}
        )


def install(tmp_path: Path, answers: list[Any]) -> Replay:
    transport = Replay(answers)
    ingest_http.configure(
        ingest_http.GOOGLE,
        HttpClient(
            cache_dir=tmp_path / "http-cache",
            min_interval=0.0,
            transport=transport,
            sleep=lambda _seconds: None,
        ),
    )
    return transport


# ── The two routes ───────────────────────────────────────────────────────────


def test_the_family_route_answers_a_job_id_not_a_result(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """A 200 naming a pending job; the work happens after the response."""
    response = unbuilt_client.post("/api/scraping/families", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Language family scraping started"
    assert body["status"] == "pending"
    assert body["jobId"].startswith("job_")


def test_the_mythology_route_answers_a_job_id_not_a_result(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.post("/api/scraping/mythology", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "Mythology scraping started"
    assert body["status"] == "pending"
    assert body["jobId"].startswith("job_")


@pytest.mark.parametrize(
    ("url", "language_id"),
    [
        ("/api/scraping/families", "language-families"),
        ("/api/scraping/mythology", "mythology"),
    ],
)
def test_a_checkout_with_no_key_fails_the_job_and_never_started_it(
    unbuilt_client: TestClient,
    corpus: Path,
    monkeypatch: pytest.MonkeyPatch,
    url: str,
    language_id: str,
) -> None:
    """The normal state of a checkout, and the diff's first five requests.

    The key check runs **before** the generator's own try/catch, so nothing
    stamps `startedAt` and no progress message is ever reported — the only trace
    is the route's `.catch`, which is where `errorMessage` comes from. The job
    is opened either way, because the route opens it before dispatching.
    """
    monkeypatch.delenv(generation.GEMINI_API_KEY_ENV, raising=False)

    job_id = unbuilt_client.post(url, json={}).json()["jobId"]

    job = jobs.get_job(job_id)
    assert job is not None
    assert job["languageId"] == language_id
    assert job["dataSource"] == "gemini"
    assert job["totalWords"] == 100
    assert job["status"] == "failed"
    assert job["startedAt"] is None
    assert job["completedAt"] is not None
    assert (
        job["errorMessage"]
        == "GEMINI_API_KEY environment variable is required for scraping"
    )
    assert "statusMessage" not in job


def test_the_family_route_500s_when_the_corpus_cannot_be_read(
    unbuilt_client: TestClient, corpus: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Its one failure mode that is not reported through a job.

    `storage.getLanguageFamilies()` is awaited *before* `createJob`, so a corpus
    this service cannot read answers 500 and leaves nothing in the ledger. The
    mythology route reads nothing and has no such path.

    The loader is patched on **`pinakes.lexicons.storage`**, not through the
    router's own reference to it: strict mypy rejects reaching for a re-exported
    attribute, and the router resolves the name at call time either way — the
    trap the publication slice named.
    """

    def explode(_directory: Path) -> Any:
        raise RuntimeError("corpus is on fire")

    monkeypatch.setattr(storage, "language_families_with_counts", explode)

    response = unbuilt_client.post("/api/scraping/families", json={})

    assert response.status_code == 500
    assert response.json() == {
        "message": "Failed to start scraping",
        "error": "corpus is on fire",
    }
    assert jobs.all_jobs() == []


# ── The two id rules ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("Indo-European", "indo_european"),
        ("Ainu (isolate)", "ainu_isolate"),
        ("Ítalo-Celtic", "italo_celtic"),
        # Fullwidth G folds to a lowercase fullwidth G and then NFKD-decomposes
        # to an ASCII one; every other non-alphanumeric run is one underscore.
        ("Ｇ|ui — Kx'a", "g_ui_kx_a"),
        # A no-break space is not `[a-z0-9]`, so a trailing one is an underscore
        # that the edge trim then removes.
        ("Gaulish ", "gaulish"),
        # Nothing ASCII survives, so the slug is empty rather than transliterated.
        ("日本語", ""),
    ],
)
def test_slugify_matches_the_typescript(value: str, expected: str) -> None:
    assert generation.slugify(value) == expected


def test_normalize_keeps_punctuation_where_slugify_drops_it() -> None:
    """It is a subfamily-lookup key, so `Ítalo-Celtic` must match `Italo-Celtic`."""
    assert generation.normalize("Ítalo-Celtic") == "italo-celtic"
    assert generation.normalize("  Indo 　 European ") == "indo european"


# ── The prompts and the request the model receives ───────────────────────────


def test_the_discovery_prompt_lists_at_most_fifty_existing_families() -> None:
    """Fifty is a prompt-size bound, not a corpus bound — see the module note."""
    names = [{"name": f"Family{index}"} for index in range(60)]
    prompt = family_scraper.build_discovery_prompt(names)
    assert "IMPORTANT: DO NOT include the following families" in prompt
    assert "family49" in prompt
    assert "family50" not in prompt
    assert prompt.startswith(
        "You are a professional historical linguist. Generate a list of the 40 "
    )


def test_the_discovery_prompt_omits_the_note_entirely_with_no_families() -> None:
    prompt = family_scraper.build_discovery_prompt([])
    assert "DO NOT include" not in prompt
    assert "in the world.\n\nGuidelines:" in prompt


def test_the_tree_prompt_carries_real_tabs_in_its_format_lines() -> None:
    """The two TSV format lines are tab-separated, which is the point of them."""
    prompt = family_scraper.build_tree_prompt("Uralic")
    assert "comprehensive hierarchical tree for the Uralic language family" in prompt
    assert "\nid\tname\tparent_id\tdescription\t" in prompt
    assert "\nuralic\tUralic\t\tUralic language family\tfamily\t" in prompt


def test_the_request_body_is_the_sdks_own_shape(
    tmp_path: Path, keyed: None
) -> None:
    """Three keys in the SDK's order, the schema lower case, the key a header."""
    transport = install(tmp_path, [{"families": []}])

    generation.generate_json("hello", {"type": "object"}, "stub-key")

    call = transport.calls[0]
    assert call["url"].endswith("/gemini-test:generateContent")
    assert call["headers"]["x-goog-api-key"] == "stub-key"
    assert "stub-key" not in call["url"]
    assert list(call["body"]) == ["generationConfig", "safetySettings", "contents"]
    assert call["body"]["safetySettings"] == []
    assert call["body"]["generationConfig"] == {
        "responseMimeType": "application/json",
        "responseSchema": {"type": "object"},
    }
    assert call["body"]["contents"] == [
        {"role": "user", "parts": [{"text": "hello"}]}
    ]


def test_the_schemas_spell_their_types_the_way_schematype_does() -> None:
    """`SchemaType.OBJECT` is the string `"object"`; the SDK forwards it as-is."""
    assert family_scraper.DISCOVERY_SCHEMA["type"] == "object"
    assert family_scraper.TREE_SCHEMA["properties"]["languages"]["type"] == "array"
    assert mythology_scraper.DEITY_SCHEMA["properties"]["deities"]["items"][
        "properties"
    ]["timeOrigin"] == {"type": "number", "nullable": True}


# ── The family generator ─────────────────────────────────────────────────────

FAMILY_ANSWERS: list[Any] = [
    {
        "families": [
            {
                "name": "Indo-European",
                "region": "Eurasia",
                "description": "The big one.",
            },
            {"name": "Ainu (isolate)", "region": "Japan", "description": ""},
        ]
    },
    {
        "families": [
            {
                "name": "Germanic",
                "taxonomicLevel": "branch",
                "region": "N Europe",
                "description": "Gmc",
            },
            {"name": "Ítalo-Celtic", "region": "S Europe"},
        ],
        "languages": [
            {
                "name": "English",
                "nativeName": "English",
                "iso639_1": "en",
                "iso639_2": "eng",
                "subfamily": "Italo-Celtic",
                "region": "British Isles",
                "countries": ["UK", "US"],
                "nativeSpeakers": 0,
                "totalSpeakers": 1500000000,
                "status": "living",
                "writingSystem": "Latin",
            },
            {
                "name": "Gaulish",
                "subfamily": "Nope",
                "region": "Gaul",
                "countries": "FR",
                "status": "",
            },
        ],
    },
    {"families": None, "languages": None},
]


def test_the_family_generator_replaces_both_tables(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """The whole run, against the byte-identical output the live diff recorded."""
    (corpus / "families.tsv").write_text(
        "id\tname\nkeepme\tKeep Me\n", encoding="utf-8"
    )
    install(tmp_path, FAMILY_ANSWERS)

    result = family_scraper.scrape_language_families(
        corpus, existing_families=[{"name": "Uralic"}]
    )

    # Subfamilies first, then the top-level families appended at the end.
    assert [family["id"] for family in result["families"]] == [
        "indo_european__germanic",
        "indo_european__italo_celtic",
        "indo_european",
        "ainu_isolate",
    ]
    assert (corpus / "families.tsv").read_text(encoding="utf-8") == (
        "id\tname\tparent_id\tdescription\ttaxonomic_level\tregion\t"
        "total_speakers\tlanguage_count\n"
        "indo_european__germanic\tGermanic\tindo_european\tGmc\tbranch\t"
        "N Europe\t\t\n"
        "indo_european__italo_celtic\tÍtalo-Celtic\tindo_european\t\tsubfamily\t"
        "S Europe\t\t\n"
        "indo_european\tIndo-European\t\tThe big one.\tfamily\tEurasia\t\t\n"
        "ainu_isolate\tAinu (isolate)\t\t\tfamily\tJapan\t\t\n"
    )
    assert (corpus / "languages.tsv").read_text(encoding="utf-8") == (
        "id\tname\tnative_name\tiso639_1\tiso639_2\tfamily_id\t"
        "parent_language_id\tregion\tcountries\tnative_speakers\t"
        "total_speakers\tstatus\ttime_origin\ttime_end\tclassification\t"
        "writing_system\tis_historical_variant\tis_dialect\t"
        "chronological_order\thistorical_context\tlatitude\tlongitude\n"
        "eng\tEnglish\tEnglish\ten\teng\tindo_european__italo_celtic\t\t"
        "British Isles\tUK;US\t\t1500000000\tliving\t\t\t\tLatin\tfalse\t"
        "false\t0\t\t\t\n"
        "gaulish\tGaulish\t\t\t\tindo_european\t\tGaul\t\t\t\tliving\t\t\t\t\t"
        "false\tfalse\t0\t\t\t\n"
    )


def test_a_language_is_filed_under_a_subfamily_by_its_accent_folded_name(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """`Italo-Celtic` finds `Ítalo-Celtic`; an unmatched name keeps the parent."""
    install(tmp_path, FAMILY_ANSWERS)
    result = family_scraper.scrape_language_families(corpus)
    english, gaulish = result["languages"]
    assert english["familyId"] == "indo_european__italo_celtic"
    assert gaulish["familyId"] == "indo_european"


def test_a_language_id_falls_back_from_iso639_2_to_a_slug(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    install(tmp_path, FAMILY_ANSWERS)
    result = family_scraper.scrape_language_families(corpus)
    assert [language["id"] for language in result["languages"]] == ["eng", "gaulish"]


def test_a_native_speaker_count_of_zero_is_recorded_as_no_count_at_all(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """`lang.nativeSpeakers || null` is truthy, so a real zero is lost.

    `?? null` would have kept it, and the deity mapping in the sibling generator
    uses exactly that for `timeOrigin` — the two spellings sit five lines apart
    in the TypeScript and mean different things. Reproduced, not repaired.
    """
    install(tmp_path, FAMILY_ANSWERS)
    result = family_scraper.scrape_language_families(corpus)
    assert result["languages"][0]["nativeSpeakers"] is None
    assert result["languages"][0]["totalSpeakers"] == 1500000000


def test_a_family_filter_selects_one_subtree_and_sets_total_words(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """A filter narrows the *expansion*; discovery still runs in full."""
    install(tmp_path, FAMILY_ANSWERS[:2])
    job = jobs.create_job("language-families", 100, "gemini")

    family_scraper.scrape_language_families(
        corpus, family_filter="indo_european", job_id=job["id"]
    )

    settled = jobs.get_job(job["id"])
    assert settled is not None
    assert settled["status"] == "completed"
    assert settled["totalWords"] == 1
    assert settled["completedWords"] == 1
    assert settled["startedAt"] is not None


def test_a_subtree_the_model_botched_is_silently_empty(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """`scrapeFamilyTree` catches everything and answers `([], [])`.

    Not even a progress `error` is reported — the enclosing `try/catch` around
    it is therefore unreachable. The run still completes and still writes.
    """
    install(tmp_path, FAMILY_ANSWERS)
    reported: list[tuple[str, str]] = []

    result = family_scraper.scrape_language_families(
        corpus, progress=lambda t, m, d=None: reported.append((t, m))
    )

    assert [kind for kind, _ in reported] == ["progress"] * 5 + ["completed"]
    assert len(result["families"]) == 4  # two subfamilies + the two top-level


def test_the_progress_log_is_the_one_the_diff_recorded(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    install(tmp_path, FAMILY_ANSWERS)
    reported: list[list[Any]] = []

    family_scraper.scrape_language_families(
        corpus, progress=lambda t, m, d=None: reported.append([t, m])
    )

    assert reported == [
        ["progress", "Discovering language families..."],
        ["progress", "Discovered 2 language families"],
        ["progress", "Scraping family 1/2: Indo-European..."],
        ["progress", "Scraping family 2/2: Ainu (isolate)..."],
        ["progress", "Writing to TSV files..."],
        ["completed", "Scraping completed successfully!"],
    ]


def test_a_discovery_failure_fails_the_job_and_writes_nothing(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """The asymmetry: no tree at all is fatal where one missing branch is not."""
    install(tmp_path, [{"families": "not-an-array"}])
    job = jobs.create_job("language-families", 100, "gemini")

    with pytest.raises(family_scraper.FamilyScrapeError):
        family_scraper.scrape_language_families(corpus, job_id=job["id"])

    settled = jobs.get_job(job["id"])
    assert settled is not None
    assert settled["status"] == "failed"
    assert settled["errorMessage"] == "Invalid response structure from Gemini"
    assert not (corpus / "families.tsv").exists()


def test_a_second_run_is_refused_while_one_holds_the_guard(
    corpus: Path, keyed: None
) -> None:
    """The static `isScraping` flag, and it outlives the run that set it.

    Second in line: the key check runs first, so an unkeyed checkout never
    reaches this refusal at all.
    """
    family_scraper._scraping = True
    try:
        with pytest.raises(family_scraper.FamilyScrapeError) as raised:
            family_scraper.scrape_language_families(corpus)
        assert "already in progress" in str(raised.value)
    finally:
        family_scraper.reset()


# ── The mythology generator ──────────────────────────────────────────────────

MYTH_ANSWERS: list[Any] = [
    {
        "deities": [
            {
                "id": "Zeus!",
                "name": "Zeus",
                "nativeName": "Ζεύς",
                "domain": ["sky", "thunder"],
                "gender": "male",
                "associatedReligionIds": ["ancient-greek-religion"],
                "associatedLanguageIds": ["grc"],
                "timeOrigin": 0,
                "timeEnd": None,
                "lat": 37.9,
                "lng": 23.7,
                "description": "Sky father.",
                "sources": ["Burkert 1985"],
            },
            {
                "id": "",
                "name": "Héra of Argos",
                "domain": [],
                "gender": "",
                "timeOrigin": -1200,
                "lat": 37.6,
                "lng": None,
                "description": "",
                "sources": "not-an-array",
            },
        ]
    },
    {
        "deities": [
            {
                "id": "jupiter",
                "name": "Jupiter",
                "domain": ["sky"],
                "gender": "male",
                "timeEnd": -100,
                "description": "Roman sky god.",
            }
        ]
    },
    {
        "links": [
            {"deityId": "zeus", "equivalents": ["jupiter", "jupiter", "nobody"]},
            {"deityId": "ghost", "equivalents": ["zeus"]},
        ]
    },
    {
        "motifs": [
            {
                "id": "Flood Myth",
                "name": "Flood Myth",
                "motifType": "cataclysm",
                "atuIndex": None,
                "description": "A deluge.",
                "examples": [{"culture": "greek", "narrative": "Deucalion"}],
                "associatedReligionIds": [],
                "associatedDeityIds": ["zeus", "nobody"],
                "geographicDistribution": ["Global"],
                "timeDepth": -8000,
                "sources": ["Frazer"],
            }
        ]
    },
]


def test_the_mythology_generator_replaces_both_tables(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """The whole run, against the byte-identical output the live diff recorded."""
    install(tmp_path, MYTH_ANSWERS)

    result = mythology_scraper.scrape_mythology(
        corpus, pantheons=["greek", "roman"]
    )

    assert [deity["id"] for deity in result["deities"]] == [
        "zeus",
        "hera_of_argos",
        "jupiter",
    ]
    assert (corpus / "deities.tsv").read_text(encoding="utf-8") == (
        "id\tname\tnative_name\tpantheon\tdomain\tgender\tsyncretism_links\t"
        "associated_religion_ids\tassociated_language_ids\ttime_origin\t"
        "time_end\tcoordinates\tdescription\tsources\n"
        'zeus\tZeus\tΖεύς\tgreek\t["sky","thunder"]\tmale\t["jupiter"]\t'
        '["ancient-greek-religion"]\t["grc"]\t0\t\t{"lat":37.9,"lng":23.7}\t'
        'Sky father.\t["Burkert 1985"]\n'
        "hera_of_argos\tHéra of Argos\t\tgreek\t[]\tunknown\t[]\t[]\t[]\t"
        "-1200\t\t\t\t[]\n"
        'jupiter\tJupiter\t\troman\t["sky"]\tmale\t["zeus"]\t[]\t[]\t\t-100\t\t'
        "Roman sky god.\t[]\n"
    )
    assert (corpus / "myth-motifs.tsv").read_text(encoding="utf-8") == (
        "id\tname\tmotif_type\tatu_index\tdescription\texamples\t"
        "associated_religion_ids\tassociated_deity_ids\t"
        "geographic_distribution\ttime_depth\tsources\n"
        "flood-myth\tFlood Myth\tcataclysm\t\tA deluge.\t"
        '[{"culture":"greek","narrative":"Deucalion"}]\t[]\t["zeus"]\t'
        '["Global"]\t-8000\t["Frazer"]\n'
    )


def test_a_time_origin_of_zero_survives_where_a_blank_native_name_does_not(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """`?? null` on the years, `|| ""` on the text. Five lines apart, both live."""
    install(tmp_path, MYTH_ANSWERS)
    result = mythology_scraper.scrape_mythology(corpus, pantheons=["greek", "roman"])
    zeus, hera, _jupiter = result["deities"]
    assert zeus["timeOrigin"] == 0
    assert zeus["timeEnd"] is None
    assert hera["nativeName"] == ""
    assert hera["gender"] == "unknown"
    assert hera["sources"] == []


def test_coordinates_need_both_halves(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """A deity with a latitude and no longitude has no cult centre at all."""
    install(tmp_path, MYTH_ANSWERS)
    result = mythology_scraper.scrape_mythology(corpus, pantheons=["greek", "roman"])
    assert result["deities"][0]["coordinates"] == {"lat": 37.9, "lng": 23.7}
    assert result["deities"][1]["coordinates"] is None


def test_syncretism_links_are_bidirectional_deduped_and_filtered(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """Jupiter never named Zeus; the link is forced back the other way.

    `nobody` and `ghost` are both absent from the deity set and are dropped from
    either side, and the repeated `jupiter` collapses because the map is a Set.
    """
    install(tmp_path, MYTH_ANSWERS)
    result = mythology_scraper.scrape_mythology(corpus, pantheons=["greek", "roman"])
    links = {deity["id"]: deity["syncretismLinks"] for deity in result["deities"]}
    assert links == {
        "zeus": ["jupiter"],
        "hera_of_argos": [],
        "jupiter": ["zeus"],
    }


def test_a_motif_drops_deity_references_it_cannot_resolve(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    install(tmp_path, MYTH_ANSWERS)
    result = mythology_scraper.scrape_mythology(corpus, pantheons=["greek", "roman"])
    assert result["motifs"][0]["associatedDeityIds"] == ["zeus"]


def test_a_motif_id_is_the_slug_with_its_underscores_hyphenated(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """The one place `slugify`'s underscores are translated back."""
    install(tmp_path, MYTH_ANSWERS)
    result = mythology_scraper.scrape_mythology(corpus, pantheons=["greek", "roman"])
    assert result["motifs"][0]["id"] == "flood-myth"


def test_a_pantheon_the_model_botched_is_reported_and_still_counted(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """A lost pantheon is not a lost job, and `completedWords` says so.

    The stamp is *outside* the catch, so a failed pantheon advances the counter
    exactly as a successful one does.
    """
    install(
        tmp_path,
        [
            {"deities": None},
            {
                "deities": [
                    {
                        "id": "odin",
                        "name": "Odin",
                        "domain": ["war"],
                        "gender": "male",
                        "description": "Allfather",
                    }
                ]
            },
            {"links": []},
            {"motifs": []},
        ],
    )
    job = jobs.create_job("mythology", 100, "gemini")
    reported: list[list[Any]] = []

    result = mythology_scraper.scrape_mythology(
        corpus,
        pantheons=["greek", "norse"],
        job_id=job["id"],
        progress=lambda t, m, d=None: reported.append([t, m]),
    )

    assert [deity["id"] for deity in result["deities"]] == ["odin"]
    assert [
        "error",
        "Failed to scrape greek: Error: Invalid response structure for greek deities",
    ] in reported
    settled = jobs.get_job(job["id"])
    assert settled is not None
    assert settled["status"] == "completed"
    assert settled["totalWords"] == 3  # two pantheons plus the linking pass
    assert settled["completedWords"] == 3


def test_a_syncretism_answer_with_no_links_array_degrades(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """The one step that degrades: unlinked deities are still deities."""
    install(
        tmp_path,
        [
            {
                "deities": [
                    {
                        "id": "odin",
                        "name": "Odin",
                        "domain": ["war"],
                        "gender": "male",
                        "description": "Allfather",
                    }
                ]
            },
            {"links": "nope"},
            {"motifs": []},
        ],
    )

    result = mythology_scraper.scrape_mythology(corpus, pantheons=["norse"])

    assert result["deities"][0]["syncretismLinks"] == []
    assert (corpus / "deities.tsv").exists()


def test_a_motif_failure_fails_the_job_and_writes_neither_table(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """Deities without motifs is not a state this generator can leave behind."""
    install(
        tmp_path,
        [
            {
                "deities": [
                    {
                        "id": "ra",
                        "name": "Ra",
                        "domain": ["sun"],
                        "gender": "male",
                        "description": "Sun",
                    }
                ]
            },
            {"links": []},
            {"motifs": None},
        ],
    )
    job = jobs.create_job("mythology", 100, "gemini")

    with pytest.raises(mythology_scraper.MythologyScrapeError):
        mythology_scraper.scrape_mythology(
            corpus, pantheons=["egyptian"], job_id=job["id"]
        )

    settled = jobs.get_job(job["id"])
    assert settled is not None
    assert settled["status"] == "failed"
    assert settled["errorMessage"] == "Invalid response structure for myth motifs"
    assert not (corpus / "deities.tsv").exists()
    assert not (corpus / "myth-motifs.tsv").exists()


def test_an_empty_pantheon_list_scrapes_nothing_and_empties_the_corpus(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    """`[]` is **truthy** in JavaScript, so it is a request for no pantheons.

    Python's own truthiness would have substituted the eighteen defaults, which
    is the opposite answer — and this is the one body a client could plausibly
    send that turns "start scraping" into "delete the mythology corpus".
    """
    (corpus / "deities.tsv").write_text("id\tname\nzeus\tZeus\n", encoding="utf-8")
    install(tmp_path, [{"links": []}, {"motifs": []}])

    result = mythology_scraper.scrape_mythology(corpus, pantheons=[])

    assert result == {"deities": [], "motifs": []}
    assert (corpus / "deities.tsv").read_text(encoding="utf-8") == (
        "id\tname\tnative_name\tpantheon\tdomain\tgender\tsyncretism_links\t"
        "associated_religion_ids\tassociated_language_ids\ttime_origin\t"
        "time_end\tcoordinates\tdescription\tsources\n"
    )


def test_no_pantheons_at_all_means_the_eighteen_defaults(
    tmp_path: Path, corpus: Path, keyed: None
) -> None:
    assert len(mythology_scraper.DEFAULT_PANTHEONS) == 18
    install(tmp_path, [{"deities": []}] * 18 + [{"links": []}, {"motifs": []}])
    transport_calls = mythology_scraper.scrape_mythology(corpus)
    assert transport_calls == {"deities": [], "motifs": []}


def test_the_deity_prompt_carries_thirty_existing_ids(corpus: Path) -> None:
    prompt = mythology_scraper.build_deity_prompt(
        "greek", [f"id{index}" for index in range(40)]
    )
    assert "id29" in prompt
    assert "id30" not in prompt
    assert prompt.startswith(
        "You are a comparative mythology scholar. Generate a comprehensive list "
        "of deities from the greek mythology/religion."
    )


def test_existing_deity_ids_are_the_first_column_first_seen(corpus: Path) -> None:
    """A `Set` over there, so duplicates collapse and the order is file order."""
    (corpus / "deities.tsv").write_text(
        "id\tname\nzeus\tZeus\nhera\tHera\nzeus\tZeus again\n\t\n",
        encoding="utf-8",
    )
    assert mythology_scraper.load_existing_deity_ids(corpus) == ["zeus", "hera"]


def test_a_missing_deities_file_is_no_existing_ids(corpus: Path) -> None:
    assert mythology_scraper.load_existing_deity_ids(corpus) == []


# ── The writer ───────────────────────────────────────────────────────────────


def test_a_zero_row_table_is_a_header_line(tmp_path: Path) -> None:
    writer.write_tsv(tmp_path / "x.tsv", ["a", "b"], [])
    assert (tmp_path / "x.tsv").read_text(encoding="utf-8") == "a\tb\n"


def test_the_temp_file_does_not_survive_the_write(tmp_path: Path) -> None:
    """It lands beside the table, so a leaked one would be read as a sibling."""
    directory = tmp_path / "written"
    writer.write_tsv(directory / "x.tsv", ["a"], [["1"]])
    assert sorted(path.name for path in directory.iterdir()) == ["x.tsv"]


def test_the_writer_creates_missing_directories(tmp_path: Path) -> None:
    target = tmp_path / "deep" / "deeper" / "x.tsv"
    writer.write_tsv(target, ["a"], [["1"]])
    assert target.read_text(encoding="utf-8") == "a\n1\n"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, ""),
        (0, "0"),
        (1920.0, "1920"),  # `String(n)`, not `str(n)`
        (1920.5, "1920.5"),
        ("", ""),
        (True, "true"),
    ],
)
def test_a_cell_is_rendered_the_way_javascript_renders_it(
    value: Any, expected: str
) -> None:
    assert writer.cell(value) == expected


def test_a_cell_containing_a_tab_corrupts_the_row_and_is_not_escaped(
    tmp_path: Path,
) -> None:
    """There is no escaping here, and `media/images.escape_tsv_field` is not it.

    A model that answers a motif called `World\\tTree` really does write a row
    with an extra column on both backends. Pinned so a future "fix" is a
    deliberate divergence rather than an accident.
    """
    writer.write_tsv(tmp_path / "x.tsv", ["a", "b"], [["World\tTree", "y"]])
    assert (tmp_path / "x.tsv").read_text(encoding="utf-8") == (
        "a\tb\nWorld\tTree\ty\n"
    )
