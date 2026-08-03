"""Tests for the engine-neutral Datalog/Prolog fact representation."""

import pytest

from pinakes_engine.datalog import (
    DatalogError,
    Dialect,
    Fact,
    render_atom,
    render_fact,
    render_predicate,
)

# --- render_atom: symbolic constants ---------------------------------------


def test_lowercase_token_is_a_bare_prolog_atom() -> None:
    assert render_atom("dish") == "dish"
    assert render_atom("located_in") == "located_in"


def test_csid_with_colons_is_quoted() -> None:
    assert render_atom("cs:dish:Q42") == "'cs:dish:Q42'"


def test_capitalised_name_is_quoted() -> None:
    # Unquoted it would read as a Prolog variable, not an atom.
    assert render_atom("Ceviche") == "'Ceviche'"


def test_embedded_single_quote_is_escaped() -> None:
    assert render_atom("Tom's dish") == "'Tom\\'s dish'"


def test_spaces_kept_control_chars_escaped() -> None:
    assert render_atom("a b") == "'a b'"
    assert render_atom("line1\nline2") == "'line1\\nline2'"
    assert render_atom("col1\tcol2") == "'col1\\tcol2'"
    assert render_atom("a\rb") == "'a\\rb'"


def test_backslash_is_escaped() -> None:
    assert render_atom("a\\b") == "'a\\\\b'"


def test_unicode_passes_through_verbatim() -> None:
    assert render_atom("Crème brûlée") == "'Crème brûlée'"
    assert render_atom("café") == "'café'"


def test_empty_string_is_quoted() -> None:
    assert render_atom("") == "''"


# --- render_atom: dialects --------------------------------------------------


def test_datalog_symbols_are_double_quoted() -> None:
    assert render_atom("dish", Dialect.DATALOG) == '"dish"'
    assert render_atom("cs:dish:Q42", Dialect.DATALOG) == '"cs:dish:Q42"'


def test_datalog_escapes_double_quote_not_single() -> None:
    assert render_atom('say "hi"', Dialect.DATALOG) == '"say \\"hi\\""'
    assert render_atom("Tom's", Dialect.DATALOG) == '"Tom\'s"'


def test_datalog_unicode_passes_through() -> None:
    assert render_atom("café", Dialect.DATALOG) == '"café"'


# --- render_atom: numbers ---------------------------------------------------


def test_integers_render_bare() -> None:
    assert render_atom(2024) == "2024"
    assert render_atom(-480) == "-480"  # BCE year


def test_floats_keep_a_decimal_point() -> None:
    assert render_atom(0.5) == "0.5"
    assert render_atom(1.0) == "1.0"


def test_float_exponent_has_decimal_mantissa() -> None:
    # repr(1e20) is '1e+20'; both engines need a decimal point in the mantissa.
    assert render_atom(1e20) == "1.0e+20"


def test_bool_is_rejected() -> None:
    with pytest.raises(DatalogError):
        render_atom(True)


def test_unsupported_type_is_rejected() -> None:
    with pytest.raises(DatalogError):
        render_atom(None)  # type: ignore[arg-type]


# --- render_predicate -------------------------------------------------------


def test_valid_predicate_returns_unchanged() -> None:
    assert render_predicate("time_start") == "time_start"


def test_predicate_must_be_lowercase_initial_identifier() -> None:
    for bad in ("Node", "located in", "rel:type", "", "3way"):
        with pytest.raises(DatalogError):
            render_predicate(bad)


# --- Fact -------------------------------------------------------------------


def test_fact_coerces_args_to_tuple_and_is_hashable() -> None:
    fact = Fact("instance_of", ["cs:dish:Q42", "dish"])
    assert fact.args == ("cs:dish:Q42", "dish")
    assert hash(fact)  # frozen + tuple args -> hashable


def test_fact_render_prolog_clause() -> None:
    fact = Fact("located_in", ("cs:dish:Q42", "cs:place:Q123"))
    assert fact.render() == "located_in('cs:dish:Q42', 'cs:place:Q123')."


def test_fact_render_datalog_clause() -> None:
    fact = Fact("node", ("cs:dish:Q42", "dish", "Ceviche"))
    assert fact.render(Dialect.DATALOG) == 'node("cs:dish:Q42", "dish", "Ceviche").'


def test_source_renders_as_prolog_comment() -> None:
    fact = Fact("time_start", ("cs:battle:Q7", -480), source="wikidata")
    assert fact.render() == "time_start('cs:battle:Q7', -480).  % source: wikidata"


def test_source_renders_as_datalog_comment() -> None:
    fact = Fact("instance_of", ("cs:dish:Q42", "dish"), source="petscan")
    rendered = render_fact(fact, Dialect.DATALOG)
    assert rendered == 'instance_of("cs:dish:Q42", "dish").  // source: petscan'


def test_multiline_source_is_collapsed_to_one_line() -> None:
    fact = Fact("node", ("cs:dish:Q42", "dish"), source="line1\nline2\t x")
    assert fact.render().endswith("% source: line1 line2 x")


def test_empty_args_is_rejected() -> None:
    with pytest.raises(DatalogError):
        render_fact(Fact("node", ()))
