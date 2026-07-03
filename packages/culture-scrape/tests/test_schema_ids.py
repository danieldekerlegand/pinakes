"""Tests for deterministic ``csid`` minting (idempotent re-runs)."""

import pytest

from culturescrape.schema import (
    CSID_PREFIX,
    IdError,
    csid_type,
    mint_csid,
    normalize_name,
    normalize_qid,
    normalize_type,
)


def test_qid_anchored_format() -> None:
    assert mint_csid("dish", qid="Q12345") == "cs:dish:Q12345"


def test_qid_minting_is_deterministic() -> None:
    assert mint_csid("dish", qid="Q42") == mint_csid("dish", qid="Q42")


def test_qid_accepts_entity_uri() -> None:
    uri = "http://www.wikidata.org/entity/Q42"
    assert mint_csid("person", qid=uri) == "cs:person:Q42"


def test_qid_wins_over_name() -> None:
    # When a QID is known it is the identity; the name is ignored entirely.
    assert mint_csid("dish", qid="Q42", name="anything") == "cs:dish:Q42"


def test_alias_anchored_format() -> None:
    # A source-local id is used verbatim (no slug, no hash) as the local part.
    assert mint_csid("language", alias="aap") == "cs:language:aap"


def test_alias_anchored_preserves_kebab_type() -> None:
    # A kebab node type survives, so the id matches the export's cs:<type>:<id>.
    assert (
        mint_csid("archaeological-culture", alias="bell-beaker")
        == "cs:archaeological-culture:bell-beaker"
    )


def test_alias_minting_is_deterministic() -> None:
    assert mint_csid("language", alias="pie") == mint_csid("language", alias="pie")


def test_qid_wins_over_alias() -> None:
    # When a QID is known it is the identity; the alias is ignored entirely.
    assert mint_csid("language", qid="Q42", alias="aap") == "cs:language:Q42"


def test_alias_wins_over_name() -> None:
    assert mint_csid("dish", alias="ceviche-01", name="Ceviche") == "cs:dish:ceviche-01"


def test_empty_alias_rejected() -> None:
    with pytest.raises(IdError):
        mint_csid("language", alias="   ")


def test_csid_type_extracts_type_segment() -> None:
    assert (
        csid_type("cs:archaeological-culture:bell-beaker")
        == "archaeological-culture"
    )
    assert csid_type("cs:language:aap") == "language"
    assert csid_type("cs:person:Q42") == "person"


def test_csid_type_rejects_malformed() -> None:
    for bad in ("", "language:aap", "cs:language", "notacsid"):
        with pytest.raises(IdError):
            csid_type(bad)


def test_name_anchored_format() -> None:
    csid = mint_csid("dish", name="Ceviche", lang="es")
    prefix, type_slug, local = csid.split(":")
    assert (prefix, type_slug) == (CSID_PREFIX, "dish")
    assert local.startswith("ceviche-")


def test_name_minting_is_deterministic() -> None:
    assert mint_csid("dish", name="Ceviche", lang="es") == mint_csid(
        "dish", name="Ceviche", lang="es"
    )


def test_name_minting_is_normalized() -> None:
    # Casing, surrounding/internal whitespace, and Unicode form do not fork id.
    a = mint_csid("dish", name="  Café\tCriollo ", lang="es")
    b = mint_csid("dish", name="café criollo", lang="es")
    assert a == b


def test_name_minting_distinguishes_language() -> None:
    assert mint_csid("place", name="Cologne", lang="en") != mint_csid(
        "place", name="Cologne", lang="de"
    )


def test_name_minting_distinguishes_names() -> None:
    assert mint_csid("dish", name="Ceviche", lang="es") != mint_csid(
        "dish", name="Lomo Saltado", lang="es"
    )


def test_name_minting_distinguishes_type() -> None:
    assert mint_csid("dish", name="Ceviche", lang="es") != mint_csid(
        "place", name="Ceviche", lang="es"
    )


def test_non_ascii_name_falls_back_to_hash() -> None:
    # An all-non-ASCII name has no slug prefix; the hash still gives a stable id.
    csid = mint_csid("dish", name="北京烤鸭", lang="zh")
    prefix, type_slug, local = csid.split(":")
    assert (prefix, type_slug) == (CSID_PREFIX, "dish")
    assert local and "-" not in local
    assert csid == mint_csid("dish", name="北京烤鸭", lang="zh")


def test_name_minting_defaults_lang_to_empty() -> None:
    assert mint_csid("dish", name="Ceviche") == mint_csid(
        "dish", name="Ceviche", lang=""
    )


def test_requires_qid_or_name() -> None:
    with pytest.raises(IdError):
        mint_csid("dish")


def test_rejects_malformed_qid() -> None:
    with pytest.raises(IdError):
        normalize_qid("not-a-qid")


def test_normalize_qid_canonical() -> None:
    assert normalize_qid("  Q42  ") == "Q42"


def test_normalize_type_slugifies() -> None:
    assert normalize_type("Cultural Artifact") == "cultural-artifact"


def test_normalize_type_rejects_empty_slug() -> None:
    with pytest.raises(IdError):
        normalize_type("!!!")


def test_normalize_name_collapses_whitespace() -> None:
    assert normalize_name("  A\t B  ") == "a b"


def test_empty_name_rejected() -> None:
    with pytest.raises(IdError):
        mint_csid("dish", name="   ")
