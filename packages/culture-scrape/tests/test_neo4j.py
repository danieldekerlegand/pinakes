"""Tests for the optional Neo4j connection helper.

The official driver is not a core dependency, so these tests resolve config
without it and exercise :func:`connect` against a *mocked* ``neo4j`` module
injected into ``sys.modules``.
"""

import sys
import types
from typing import Any

import pytest

from culturescrape import neo4j as cs_neo4j
from culturescrape.neo4j import (
    DEFAULT_URI,
    DEFAULT_USER,
    Neo4jConfig,
    Neo4jConfigError,
    Neo4jDriverNotInstalled,
)

EMPTY_ENV: dict[str, str] = {}


def test_config_from_explicit_mapping() -> None:
    cfg = cs_neo4j.load_config(
        {"uri": "bolt://db:7687", "user": "alice", "password": "s3cret"},
        env=EMPTY_ENV,
    )
    assert cfg == Neo4jConfig(uri="bolt://db:7687", user="alice", password="s3cret")


def test_config_from_environment() -> None:
    env = {
        "NEO4J_URI": "bolt://env:7687",
        "NEO4J_USER": "bob",
        "NEO4J_PASSWORD": "envpass",
    }
    cfg = cs_neo4j.load_config(env=env)
    assert cfg == Neo4jConfig(uri="bolt://env:7687", user="bob", password="envpass")


def test_config_prefers_mapping_over_environment() -> None:
    env = {"NEO4J_URI": "bolt://env:7687", "NEO4J_PASSWORD": "envpass"}
    cfg = cs_neo4j.load_config({"uri": "bolt://override:7687"}, env=env)
    assert cfg.uri == "bolt://override:7687"
    assert cfg.password == "envpass"


def test_config_falls_back_to_defaults() -> None:
    cfg = cs_neo4j.load_config({"password": "p"}, env=EMPTY_ENV)
    assert cfg.uri == DEFAULT_URI
    assert cfg.user == DEFAULT_USER


def test_config_missing_password_raises() -> None:
    with pytest.raises(Neo4jConfigError, match="NEO4J_PASSWORD"):
        cs_neo4j.load_config({"uri": "bolt://db:7687"}, env=EMPTY_ENV)


def test_connect_missing_driver_raises_clear_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Simulate the extra being absent: importing ``neo4j`` fails.
    monkeypatch.setitem(sys.modules, "neo4j", None)
    with pytest.raises(Neo4jDriverNotInstalled, match=r"culturescrape\[neo4j\]"):
        cs_neo4j.connect({"password": "p"}, env=EMPTY_ENV)


def test_connect_uses_mocked_driver(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, Any] = {}

    class FakeGraphDatabase:
        @staticmethod
        def driver(uri: str, **kwargs: Any) -> str:
            calls["uri"] = uri
            calls["kwargs"] = kwargs
            return "fake-driver"

    fake_module = types.ModuleType("neo4j")
    fake_module.GraphDatabase = FakeGraphDatabase  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "neo4j", fake_module)

    driver = cs_neo4j.connect(
        {"uri": "bolt://db:7687", "user": "alice", "password": "s3cret"},
        env=EMPTY_ENV,
        max_connection_lifetime=30,
    )
    assert driver == "fake-driver"
    assert calls["uri"] == "bolt://db:7687"
    assert calls["kwargs"]["auth"] == ("alice", "s3cret")
    assert calls["kwargs"]["max_connection_lifetime"] == 30
