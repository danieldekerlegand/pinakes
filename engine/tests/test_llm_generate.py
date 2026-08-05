"""Tests for the model-generation source adapter (pinakes:70 US-1).

Eighteen of the twenty-seven retired TypeScript services were this one thing
with different prompts. The assertions here are about what survives that
collapse: the schema still derives from the target's own columns, the per-domain
briefs still reach the model, generated rows still carry provenance and a
down-weighted confidence, and the model is still reached through the shared
client rather than a fresh SDK object per domain.

The model itself is behind :class:`~pinakes_engine.acquire.generate.Generator`,
so every test but the last runs with no key, no network and no model.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from pinakes_engine.acquire import (
    API_KEY_ENV,
    DEFAULT_GENERATED_CONFIDENCE,
    SHARED_RULES,
    CategorySpec,
    GeminiGenerator,
    HttpClient,
    HttpResponse,
    LlmGenerationAdapter,
    LlmGenerationError,
    SourceSpec,
    build_prompt,
    load_category,
    response_schema,
)

_FIXTURES = Path(__file__).parent / "fixtures" / "scrapers"
_CATEGORY_DIR = Path(__file__).resolve().parents[1] / "inputs" / "categories"
_FIXED_NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=UTC)
_COLUMNS = (
    "id,system_type,language_ids,terminology,descent_rule,residence_rule,"
    "associated_civilizations"
)


class _RecordedGenerator:
    """Replays a recorded model answer, recording the prompts it was asked."""

    def __init__(self, envelope: dict[str, Any] | None = None) -> None:
        self._payload = envelope if envelope is not None else _recorded_entries()
        self.prompts: list[str] = []
        self.columns: list[tuple[str, ...]] = []

    def generate(
        self, prompt: str, columns: Sequence[str]
    ) -> Sequence[Mapping[str, Any]]:
        self.prompts.append(prompt)
        self.columns.append(tuple(columns))
        return self._payload


def _recorded_entries() -> list[dict[str, Any]]:
    envelope = json.loads(
        (_FIXTURES / "gemini-kinship-systems.json").read_text(encoding="utf-8")
    )
    text = envelope["candidates"][0]["content"]["parts"][0]["text"]
    entries: list[dict[str, Any]] = json.loads(text)["entries"]
    return entries


def _spec(params: dict[str, str]) -> CategorySpec:
    return CategorySpec(
        id="kinship-systems",
        label="Concept",
        description="kinship terminologies",
        source=SourceSpec(type="http", query=None, params=params),
        dimensions=("linguistic",),
    )


def _adapter(generator: _RecordedGenerator) -> LlmGenerationAdapter:
    # ``http`` is unused when a generator is injected: the parameter exists so
    # the *default* path is the polite one, not so every test needs a client.
    return LlmGenerationAdapter(
        _unusable_client(), generator=generator, now=lambda: _FIXED_NOW
    )


def _unusable_client() -> HttpClient:
    class _Refusing:
        def request(self, *args: Any, **kwargs: Any) -> HttpResponse:
            raise AssertionError("the injected generator should own every call")

    return HttpClient(
        cache_dir=Path("/tmp/pinakes-generate-unused"),
        transport=_Refusing(),
        sleep=lambda _: None,
    )


# ── the prompt ───────────────────────────────────────────────────────────────


def test_the_prompt_carries_the_columns_the_instruction_and_the_shared_rules(
    tmp_path: Path,
) -> None:
    generator = _RecordedGenerator()
    list(
        _adapter(generator).fetch(
            _spec(
                {
                    "columns": _COLUMNS,
                    "instruction": "system_type is one of the six terminologies.",
                    "batch_size": "25",
                }
            )
        )
    )

    (prompt,) = generator.prompts
    assert "kinship systems" in prompt
    assert "id\tsystem_type\tlanguage_ids" in prompt
    assert "system_type is one of the six terminologies." in prompt
    assert "Use kebab-case IDs" in prompt  # the shared block, not a local copy
    assert "Generate exactly 25 new, unique entries" in prompt


def test_each_prompt_pass_is_one_call_in_key_order(tmp_path: Path) -> None:
    """``prompt.*`` is what a bespoke scraper's era/family list became."""
    generator = _RecordedGenerator()
    list(
        _adapter(generator).fetch(
            _spec(
                {
                    "columns": _COLUMNS,
                    "prompt.a_ancient": "Focus on the ancient world.",
                    "prompt.b_medieval": "Focus on the medieval world.",
                }
            )
        )
    )

    assert len(generator.prompts) == 2
    assert "Focus on the ancient world." in generator.prompts[0]
    assert "Focus on the medieval world." in generator.prompts[1]


def test_batches_repeat_a_pass_and_number_themselves(tmp_path: Path) -> None:
    generator = _RecordedGenerator()
    list(_adapter(generator).fetch(_spec({"columns": _COLUMNS, "batches": "3"})))

    assert len(generator.prompts) == 3
    assert "This is batch 1," in generator.prompts[0]
    assert "This is batch 3," in generator.prompts[2]


def test_a_later_pass_is_told_not_to_repeat_what_an_earlier_one_produced() -> None:
    generator = _RecordedGenerator()
    list(
        _adapter(generator).fetch(
            _spec({"columns": _COLUMNS, "prompt.one": "a", "prompt.two": "b"})
        )
    )

    assert "EXISTING IDS" not in generator.prompts[0]
    assert "hawaiian-generational" in generator.prompts[1]


def test_existing_rows_on_disk_seed_the_do_not_reuse_list(tmp_path: Path) -> None:
    existing = tmp_path / "kinship-systems.tsv"
    existing.write_text(
        "id\tsystem_type\nsudanese-descriptive\tSudanese\n", encoding="utf-8"
    )
    generator = _RecordedGenerator()
    list(
        _adapter(generator).fetch(
            _spec({"columns": _COLUMNS, "existing": str(existing)})
        )
    )
    assert "sudanese-descriptive" in generator.prompts[0]


def test_a_missing_existing_file_is_an_empty_set_not_an_error(
    tmp_path: Path,
) -> None:
    """A domain acquired for the first time has nothing to avoid."""
    generator = _RecordedGenerator()
    records = list(
        _adapter(generator).fetch(
            _spec({"columns": _COLUMNS, "existing": str(tmp_path / "absent.tsv")})
        )
    )
    assert len(records) == 2


def test_build_prompt_is_pure_and_orders_its_sections() -> None:
    prompt = build_prompt(
        domain="battles",
        columns=("id", "name"),
        count=30,
        instruction="An instruction.",
        brief="A brief.",
        known=("cannae",),
        batch=2,
    )
    assert prompt.index("TSV COLUMN FORMAT") < prompt.index("An instruction.")
    assert prompt.index("An instruction.") < prompt.index("A brief.")
    assert prompt.index("A brief.") < prompt.index("EXISTING IDS")
    assert prompt.index("EXISTING IDS") < prompt.index(SHARED_RULES.split("\n")[0])


# ── the response schema ──────────────────────────────────────────────────────


def test_the_schema_is_derived_from_the_target_columns() -> None:
    schema = response_schema(("id", "name", "region"))
    items = schema["properties"]["entries"]["items"]
    assert items["required"] == ["id", "name", "region"]
    assert items["properties"]["region"] == {"type": "STRING"}
    assert schema["required"] == ["entries"]


def test_the_adapter_hands_its_columns_to_the_generator() -> None:
    generator = _RecordedGenerator()
    list(_adapter(generator).fetch(_spec({"columns": "id,name"})))
    assert generator.columns == [("id", "name")]


# ── the records ──────────────────────────────────────────────────────────────


def test_generated_entries_become_records_projected_onto_the_columns() -> None:
    generator = _RecordedGenerator()
    records = list(_adapter(generator).fetch(_spec({"columns": _COLUMNS})))

    assert [r.fields["id"] for r in records] == [
        "hawaiian-generational",
        "iroquois-bifurcate-merging",
    ]
    assert records[1].fields["language_ids"] == "moh;one"


def test_a_repeated_id_within_a_run_is_dropped() -> None:
    """The recorded answer repeats its first entry; one row, not two."""
    generator = _RecordedGenerator()
    records = list(_adapter(generator).fetch(_spec({"columns": _COLUMNS})))
    assert len(records) == 2


def test_an_entry_with_no_identity_is_dropped() -> None:
    generator = _RecordedGenerator([{"name": "nameless"}])
    records = list(
        _adapter(generator).fetch(_spec({"columns": "id,name", "id_column": "id"}))
    )
    assert records == []


def test_generated_rows_carry_provenance_at_the_inferred_prior() -> None:
    generator = _RecordedGenerator()
    (first, _) = list(_adapter(generator).fetch(_spec({"columns": _COLUMNS})))

    assert first.provenance.source == "llm-generated"
    assert first.provenance.confidence == DEFAULT_GENERATED_CONFIDENCE
    assert first.provenance.confidence < 1.0
    assert first.provenance.source_query == "kinship-systems:all"
    assert first.provenance.retrieved_at == _FIXED_NOW.isoformat()


def test_a_pass_names_itself_in_the_source_query() -> None:
    generator = _RecordedGenerator()
    records = list(
        _adapter(generator).fetch(_spec({"columns": _COLUMNS, "prompt.uralic": "x"}))
    )
    assert records[0].provenance.source_query == "kinship-systems:uralic"


def test_a_non_scalar_value_is_serialised_rather_than_dropped() -> None:
    generator = _RecordedGenerator([{"id": "x", "coordinates": {"lat": 1, "lng": 2}}])
    (record,) = list(
        _adapter(generator).fetch(_spec({"columns": "id,coordinates"}))
    )
    assert record.fields["coordinates"] == '{"lat": 1, "lng": 2}'


# ── refusals ─────────────────────────────────────────────────────────────────


def test_no_columns_is_an_error_naming_the_category() -> None:
    with pytest.raises(LlmGenerationError, match="declares no 'columns'"):
        list(_adapter(_RecordedGenerator()).fetch(_spec({})))


def test_an_id_column_outside_the_columns_is_an_error() -> None:
    with pytest.raises(LlmGenerationError, match="is not one of columns"):
        list(
            _adapter(_RecordedGenerator()).fetch(
                _spec({"columns": "id,name", "id_column": "slug"})
            )
        )


# ── the live generator ───────────────────────────────────────────────────────


class _CapturingTransport:
    def __init__(self, body: str, status: int = 200) -> None:
        self._body = body
        self._status = status
        self.calls: list[tuple[str, str, dict[str, str], str | None]] = []

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
        self.calls.append((method, url, dict(headers), body))
        return HttpResponse(
            url=url, status_code=self._status, text=self._body, headers={}
        )


def _live(transport: _CapturingTransport, tmp_path: Path) -> GeminiGenerator:
    return GeminiGenerator(
        HttpClient(
            cache_dir=tmp_path,
            min_interval=0.0,
            max_retries=0,
            transport=transport,
            sleep=lambda _: None,
        )
    )


def test_the_live_generator_posts_through_the_shared_client_with_a_header_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The key never goes in the query string — every hop logs that."""
    monkeypatch.setenv(API_KEY_ENV, "secret-key")
    envelope = (_FIXTURES / "gemini-kinship-systems.json").read_text(encoding="utf-8")
    transport = _CapturingTransport(envelope)

    entries = _live(transport, tmp_path).generate("a prompt", ("id", "system_type"))

    (method, url, headers, body) = transport.calls[0]
    assert method == "POST"
    assert url.endswith(":generateContent")
    assert headers["x-goog-api-key"] == "secret-key"
    assert "secret-key" not in url
    assert body is not None
    sent = json.loads(body)
    assert sent["contents"][0]["parts"][0]["text"] == "a prompt"
    assert sent["generationConfig"]["responseSchema"] == response_schema(
        ("id", "system_type")
    )
    assert len(entries) == 3


def test_no_api_key_is_a_named_refusal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    transport = _CapturingTransport("{}")
    with pytest.raises(LlmGenerationError, match=API_KEY_ENV):
        _live(transport, tmp_path).generate("a prompt", ("id",))
    assert transport.calls == []


def test_an_error_status_is_raised_rather_than_read_as_an_empty_batch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The TypeScript pushed this onto ``errors[]`` and reported success."""
    monkeypatch.setenv(API_KEY_ENV, "k")
    transport = _CapturingTransport("throttled", status=429)
    with pytest.raises(LlmGenerationError, match="returned 429"):
        _live(transport, tmp_path).generate("a prompt", ("id",))


@pytest.mark.parametrize(
    ("envelope", "message"),
    [
        ('{"candidates": []}', "no candidate"),
        ('{"candidates": [{"content": {"parts": []}}]}', "empty candidate"),
        (
            '{"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}',
            "not valid JSON",
        ),
        (
            '{"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}',
            "no 'entries' array",
        ),
    ],
)
def test_a_malformed_answer_is_raised_and_says_which_way(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, envelope: str, message: str
) -> None:
    monkeypatch.setenv(API_KEY_ENV, "k")
    with pytest.raises(LlmGenerationError, match=message):
        _live(_CapturingTransport(envelope), tmp_path).generate("p", ("id",))


# ── the committed category specs ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "category",
    [
        "kinship-systems",
        "sound-changes",
        "culture-profiles",
        "language-contacts",
        "underrepresented-vocab",
    ],
)
def test_the_migrated_generation_categories_declare_their_target_columns(
    category: str,
) -> None:
    spec = load_category(_CATEGORY_DIR / f"{category}.yml")
    params = spec.source.params
    assert params["adapter"] == LlmGenerationAdapter.name
    assert params["columns"].split(",")
    assert params.get("instruction"), "a generated domain must state its own rules"


def test_the_sound_change_category_kept_all_sixteen_family_briefs() -> None:
    spec = load_category(_CATEGORY_DIR / "sound-changes.yml")
    passes = [key for key in spec.source.params if key.startswith("prompt.")]
    assert len(passes) == 16
    assert "prompt.indo_european" in passes
