"""The eight `/api/media-assets*` and `/api/media/*` routes.

Fixture-free routes, so this file is the grading. Every expectation below was
diffed against the live Express app over 47 requests — including the two written
files, compared byte for byte, which is what makes the writer a port rather than
a plausible rewrite.

Three families of case are here because a reimplementation gets them wrong
silently: the JavaScript coercions in `validate` (an explicit `null` width is a
400, a `true` width is a 400, a `"800"` width is a 400, a `1920.0` width is
fine), the two readers of one file disagreeing about a broken header, and the
round-trip through `writeAssets` — where a height of `0` comes back as `null`
and therefore writes as a blank cell the next time round.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.media import assets, images

HEADER = (
    "id\tentity_type\tentity_id\tmedia_type\turl\ttitle\tdescription\tsource\t"
    "license\tattribution\tmime_type\twidth\theight\ttags\tdate_added"
)

ROWS = (
    "media-001\tart_tradition\tart-001\timage\thttps://x/a.jpg\tPyramid\t"
    "A pyramid\tCommons\tCC BY-SA 4.0\tNina\timage/jpeg\t3072\t2304\t"
    '["architecture","egypt"]\t2026-04-16',
    "media-002\tart_tradition\tart-002\timage\thttps://x/b.jpg\tDiscobolus\t"
    "A discus thrower\tCommons\tCC BY 3.0\tLivio\timage/jpeg\t2448\t3264\t"
    '["sculpture","greek"]\t2026-04-16',
    "media-003\tdeity\tzeus\taudio\thttps://x/c.ogg\tHymn\t\t\t\t\t\t\t\t"
    '["greek"]\t2026-04-16',
)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    (lexicons / "media-assets.tsv").write_text(
        "\n".join([HEADER, *ROWS]) + "\n", encoding="utf-8"
    )
    return lexicons


def ids(payload: Any) -> list[str]:
    return [asset["id"] for asset in payload["assets"]]


# ── GET /api/media-assets ────────────────────────────────────────────────────


def test_the_list_carries_a_count_and_every_column(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/media-assets").json()
    assert body["count"] == 3
    assert body["assets"][0] == {
        "id": "media-001",
        "entityType": "art_tradition",
        "entityId": "art-001",
        "mediaType": "image",
        "url": "https://x/a.jpg",
        "title": "Pyramid",
        "description": "A pyramid",
        "source": "Commons",
        "license": "CC BY-SA 4.0",
        "attribution": "Nina",
        "mimeType": "image/jpeg",
        "width": 3072,
        "height": 2304,
        "tags": ["architecture", "egypt"],
        "dateAdded": "2026-04-16",
    }


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("", ["media-001", "media-002", "media-003"]),
        ("?entity_type=art_tradition", ["media-001", "media-002"]),
        ("?entity_type=", ["media-001", "media-002", "media-003"]),
        ("?entity_type=nope", []),
        ("?entity_id=art-001", ["media-001"]),
        ("?media_type=audio", ["media-003"]),
        ("?tag=egypt", ["media-001"]),
        ("?tag=Egypt", []),
        ("?tag=", ["media-001", "media-002", "media-003"]),
        ("?entity_type=art_tradition&media_type=audio", []),
    ],
)
def test_each_filter_is_exact_and_a_blank_one_is_no_filter(
    unbuilt_client: TestClient, corpus: Path, query: str, expected: list[str]
) -> None:
    """All four are `===`, and all four are guarded by truthiness.

    So `?tag=Egypt` finds nothing where `?tag=egypt` finds one — the tag match
    is `Array.includes`, not a case-folded search — and `?entity_type=` returns
    the whole table rather than the rows whose type is blank.
    """
    body = unbuilt_client.get("/api/media-assets" + query).json()
    assert ids(body) == expected
    assert body["count"] == len(expected)


def test_a_missing_corpus_file_is_an_empty_list_not_a_500(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`readFileIfExists` → null → `[]`. The house rule, and it applies here."""
    assert unbuilt_client.get("/api/media-assets").json() == {
        "assets": [],
        "count": 0,
    }


def test_a_header_missing_a_column_is_a_500_on_the_read_side(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The storage loader takes every column through `getIdx`, which throws.

    Its sibling reader in :mod:`pinakes.media.assets` does not — see
    :func:`test_the_write_side_tolerates_the_header_the_read_side_refuses`.
    """
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    (lexicons / "media-assets.tsv").write_text(
        "id\tentity_type\n" + "media-001\tdeity\n", encoding="utf-8"
    )
    response = unbuilt_client.get("/api/media-assets")
    assert response.status_code == 500
    assert response.json()["message"] == "Failed to fetch media assets"
    assert "entity_id" in response.json()["error"]


# ── GET /api/media-assets/{id} and the two static siblings ───────────────────


def test_the_detail_route_answers_the_bare_record(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    body = unbuilt_client.get("/api/media-assets/media-003").json()
    assert body["id"] == "media-003"
    assert body["tags"] == ["greek"]
    # `cell ? parseInt(cell) || null : null` — a blank dimension is unrecorded.
    assert body["width"] is None
    assert body["height"] is None


def test_an_unknown_id_is_a_404(unbuilt_client: TestClient, corpus: Path) -> None:
    response = unbuilt_client.get("/api/media-assets/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Media asset not found"}


def test_the_id_route_does_not_swallow_entity_or_meta(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """Both siblings have more path segments than `{id}` can match.

    Registered *after* the wildcard, as on Express — the guard is here because
    `routers/ethnography.py` had to hoist a static path above its own wildcard
    to get the same outcome, and the difference is easy to mistake for a rule.
    """
    entity = unbuilt_client.get("/api/media-assets/entity/art_tradition/art-001")
    assert entity.status_code == 200
    assert ids(entity.json()) == ["media-001"]

    meta = unbuilt_client.get("/api/media-assets/meta/types")
    assert meta.status_code == 200
    assert meta.json() == {
        "entityTypes": list(assets.VALID_ENTITY_TYPES),
        "mediaTypes": list(assets.VALID_MEDIA_TYPES),
    }


def test_an_entity_with_no_media_is_an_empty_list_not_a_404(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """The table cannot tell "no such entity" from "nothing illustrates it"."""
    body = unbuilt_client.get("/api/media-assets/entity/deity/hades").json()
    assert body == {"assets": [], "count": 0}


# ── POST /api/media-assets ───────────────────────────────────────────────────


def test_an_empty_body_lists_every_missing_field_in_order(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.post("/api/media-assets", json={})
    assert response.status_code == 400
    assert response.json() == {
        "errors": [
            {"field": "entityType", "message": "entityType is required"},
            {"field": "entityId", "message": "entityId is required"},
            {"field": "mediaType", "message": "mediaType is required"},
            {"field": "url", "message": "url is required"},
            {"field": "title", "message": "title is required"},
        ]
    }


def test_an_out_of_vocabulary_type_names_the_value_it_refused(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.post(
        "/api/media-assets",
        json={
            "entityType": "nope",
            "entityId": "x",
            "mediaType": "hologram",
            "url": "u",
            "title": "t",
        },
    )
    assert response.status_code == 400
    assert response.json() == {
        "errors": [
            {"field": "entityType", "message": "Invalid entityType: nope"},
            {"field": "mediaType", "message": "Invalid mediaType: hologram"},
        ]
    }


@pytest.mark.parametrize(
    ("width", "refused"),
    [
        (1920, False),
        (1920.0, False),  # `Number.isInteger(1920.0)` is true
        (0, False),
        ("800", True),  # a string is not a number to `Number.isInteger`
        (-3, True),
        (10.5, True),
        (None, True),  # `null !== undefined`, so it IS validated — and fails
        (True, True),  # `Number.isInteger(true)` is false
    ],
)
def test_a_dimension_is_validated_as_javascript_validated_it(
    unbuilt_client: TestClient, corpus: Path, width: Any, refused: bool
) -> None:
    """The whole rule is `x !== undefined && (x < 0 || !Number.isInteger(x))`.

    Absent is the only value that skips the check — which is why an explicit
    `null` is a 400 here and a missing key is not. A declared `int` field would
    have answered 422 to four of these and accepted none of the other four.
    """
    response = unbuilt_client.post(
        "/api/media-assets",
        json={
            "entityType": "deity",
            "entityId": "x",
            "mediaType": "image",
            "url": "u",
            "title": "t",
            "width": width,
        },
    )
    if refused:
        assert response.status_code == 400
        assert response.json() == {
            "errors": [
                {"field": "width", "message": "width must be a non-negative integer"}
            ]
        }
    else:
        assert response.status_code == 201


def test_a_write_mints_the_next_id_and_stamps_todays_utc_date(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    response = unbuilt_client.post(
        "/api/media-assets",
        json={
            "entityType": "deity",
            "entityId": "zeus",
            "mediaType": "audio",
            "url": "https://x/d.ogg",
            "title": "Paean",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["id"] == "media-004"
    # `input.description ?? ""` — the optionals default to blanks, not to null.
    assert body["description"] == ""
    assert body["mimeType"] == ""
    assert body["width"] is None
    assert body["tags"] == []
    assert len(body["dateAdded"]) == len("2026-08-05")

    listed = unbuilt_client.get("/api/media-assets").json()
    assert ids(listed) == ["media-001", "media-002", "media-003", "media-004"]


def test_the_written_row_round_trips_and_a_zero_height_erodes_to_blank(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`0` validates fine, writes as `0`, and reads back as `None`.

    So the cell survives the write that created it and is **blank after the
    next one** — any later POST or DELETE rewrites the whole file out of
    read-back records. Both readers spell the dimension
    `cell ? parseInt(cell) || null : null`, and this erosion is what that costs.
    Reproduced rather than repaired: the two backends have to agree about the
    same file, and the live diff shows Express doing exactly this.
    """
    created = unbuilt_client.post(
        "/api/media-assets",
        json={
            "entityType": "settlement",
            "entityId": "set-1",
            "mediaType": "video",
            "url": "https://x/z.mp4",
            "title": "Walkthrough",
            "width": 1920.0,
            "height": 0,
            "tags": ["a", "bé"],
        },
    ).json()
    assert created["width"] == 1920.0
    assert created["height"] == 0

    def last_row() -> list[str]:
        text = (corpus / "media-assets.tsv").read_text(encoding="utf-8")
        return text.splitlines()[-1].split("\t")

    cells = last_row()
    assert cells[0] == "media-004"
    # `(1920.0).toString()` is "1920" — one number type, no fractional part.
    assert cells[11] == "1920"
    assert cells[12] == "0"
    # `JSON.stringify` leaves non-ASCII alone and uses no separator spaces.
    assert cells[13] == '["a","bé"]'

    fetched = unbuilt_client.get("/api/media-assets/media-004").json()
    assert fetched["width"] == 1920
    assert fetched["height"] is None

    # Any later write rewrites the file out of read-back records, and the `0`
    # that read back as `None` writes as a blank.
    unbuilt_client.delete("/api/media-assets/media-001")
    assert last_row()[12] == ""


def test_the_write_side_tolerates_the_header_the_read_side_refuses(
    isolated_data_trees: dict[str, Path],
) -> None:
    """`MediaAssetService` reads with `indexOf`, and its write repairs the file.

    Two readers of one file, and the asymmetry is the TypeScript's. Exercised
    below HTTP because the route's *read* half would 500 first.
    """
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    (lexicons / "media-assets.tsv").write_text(
        "id\tentity_type\nmedia-007\tdeity\n", encoding="utf-8"
    )

    loaded = assets.load_assets(lexicons)
    assert loaded[0]["id"] == "media-007"
    assert loaded[0]["entityId"] == ""
    assert loaded[0]["tags"] == []

    assets.add_asset(
        lexicons,
        {
            "entityType": "deity",
            "entityId": "hera",
            "mediaType": "image",
            "url": "u",
            "title": "t",
        },
    )
    header = (lexicons / "media-assets.tsv").read_text(encoding="utf-8").splitlines()[0]
    assert header.split("\t") == list(assets.COLUMNS)


# ── DELETE /api/media-assets/{id} ────────────────────────────────────────────


def test_delete_removes_the_row_and_a_second_delete_is_a_404(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    first = unbuilt_client.delete("/api/media-assets/media-002")
    assert first.status_code == 200
    assert first.json() == {"message": "Media asset deleted"}

    second = unbuilt_client.delete("/api/media-assets/media-002")
    assert second.status_code == 404
    assert second.json() == {"message": "Media asset not found"}

    assert ids(unbuilt_client.get("/api/media-assets").json()) == [
        "media-001",
        "media-003",
    ]


def test_the_next_id_is_the_highest_seen_not_the_row_count(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`generateId` maxes over the surviving ids, so deletion never recycles."""
    unbuilt_client.delete("/api/media-assets/media-002")
    created = unbuilt_client.post(
        "/api/media-assets",
        json={
            "entityType": "empire",
            "entityId": "e-1",
            "mediaType": "document",
            "url": "https://x/d.pdf",
            "title": "Scroll",
        },
    ).json()
    assert created["id"] == "media-004"


# ── POST /api/media/generate ─────────────────────────────────────────────────


REQUIRED_MESSAGE = (
    "Missing required fields: entityType, entityId, sceneType, style, description"
)

VALID_REQUEST = {
    "entityType": "civilization",
    "entityId": "c1",
    "sceneType": "city_reconstruction",
    "style": "watercolor",
    "description": "Uruk at dusk",
}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {k: v for k, v in VALID_REQUEST.items() if k != "description"},
        {**VALID_REQUEST, "description": ""},
        {**VALID_REQUEST, "sceneType": ""},
    ],
)
def test_the_five_required_fields_are_checked_by_truthiness(
    unbuilt_client: TestClient, corpus: Path, body: dict[str, Any]
) -> None:
    """A blank field is the same refusal as an absent one, and one message."""
    response = unbuilt_client.post("/api/media/generate", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": REQUIRED_MESSAGE}


def test_the_two_vocabularies_are_checked_in_order_with_their_own_messages(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    scene = unbuilt_client.post(
        "/api/media/generate", json={**VALID_REQUEST, "sceneType": "mural"}
    )
    assert scene.status_code == 400
    assert scene.json() == {
        "message": (
            "Invalid sceneType. Must be one of: city_reconstruction, "
            "architectural, daily_life, artifact"
        )
    }

    style = unbuilt_client.post(
        "/api/media/generate", json={**VALID_REQUEST, "style": "anime"}
    )
    assert style.status_code == 400
    assert style.json() == {
        "message": (
            "Invalid style. Must be one of: realistic, illustrated, watercolor, "
            "archaeological_sketch"
        )
    }


def test_no_api_key_is_a_500_naming_the_variable_and_writes_no_ledger_row(
    unbuilt_client: TestClient, corpus: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The key check runs before the id is minted, so nothing is recorded.

    A model that *refuses* does leave a `status: error` row; a checkout with no
    key leaves none at all. The distinction is the TypeScript's ordering, and it
    is what keeps the ledger a record of requests that reached the model.
    """
    monkeypatch.delenv(images.API_KEY_ENV, raising=False)
    response = unbuilt_client.post("/api/media/generate", json=VALID_REQUEST)
    assert response.status_code == 500
    assert response.json() == {
        "message": (
            "GEMINI_API_KEY environment variable is required for image generation"
        )
    }
    assert not (corpus / images.PROMPTS_FILE).exists()


# ── GET /api/media/prompts ───────────────────────────────────────────────────


def test_the_ledger_is_empty_when_the_file_is_absent_or_header_only(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    assert unbuilt_client.get("/api/media/prompts").json() == {
        "prompts": [],
        "count": 0,
    }
    (corpus / images.PROMPTS_FILE).write_text(
        images.PROMPTS_HEADER + "\n", encoding="utf-8"
    )
    assert unbuilt_client.get("/api/media/prompts").json() == {
        "prompts": [],
        "count": 0,
    }


def test_the_ledger_reads_back_what_append_wrote(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    images.append_prompt_record(
        corpus,
        {
            "id": "img_1_1",
            "entityType": "civilization",
            "entityId": "c1",
            "promptText": "line one\nline two\twith a tab",
            "sceneType": "artifact",
            "style": "realistic",
            "generatedAt": "2026-08-05T00:00:00.000Z",
            "status": "success",
        },
    )
    body = unbuilt_client.get("/api/media/prompts").json()
    assert body["count"] == 1
    assert body["prompts"][0] == {
        "id": "img_1_1",
        "entityType": "civilization",
        "entityId": "c1",
        # Tabs and newlines become spaces — that is what keeps this a TSV.
        "promptText": "line one line two with a tab",
        "sceneType": "artifact",
        "style": "realistic",
        "generatedAt": "2026-08-05T00:00:00.000Z",
        "status": "success",
    }


# ── The prompt itself ────────────────────────────────────────────────────────


def test_an_absent_time_period_or_region_omits_its_whole_line() -> None:
    """Both are pushed only when truthy, and the ledger records the difference."""
    full = images.build_image_prompt(
        {**VALID_REQUEST, "timePeriod": "3000 BCE", "region": "Mesopotamia"}
    )
    assert "Time Period: 3000 BCE" in full
    assert "Region: Mesopotamia" in full

    bare = images.build_image_prompt(
        {**VALID_REQUEST, "timePeriod": "", "region": None}
    )
    assert "Time Period" not in bare
    assert "Region" not in bare
    assert bare.splitlines()[:3] == [
        "Create a historical reconstruction image.",
        "",
        "Subject: Uruk at dusk",
    ]
    assert images.SCENE_DIRECTIVES["city_reconstruction"] in bare
    assert images.STYLE_DIRECTIVES["watercolor"] in bare
