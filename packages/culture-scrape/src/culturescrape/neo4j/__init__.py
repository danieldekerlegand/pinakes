"""Optional Neo4j connection helper, isolated from the core pipeline.

The Neo4j converter is the *only* part of culture-scrape that talks to a graph
database, so its driver dependency is kept out of the core install. The official
``neo4j`` Python driver ships behind the ``neo4j`` extra
(``pip install culturescrape[neo4j]``) and is imported lazily here — importing
this module, or parsing connection config, never requires the driver to be
present.

Connection settings are resolved from an explicit *config* mapping first, then
from the environment (:data:`URI_ENV` / :data:`USER_ENV` / :data:`PASSWORD_ENV`),
so a caller can override any field while still picking up the standard Neo4j
environment variables. :func:`connect` turns a resolved :class:`Neo4jConfig`
into a live driver, raising :class:`Neo4jDriverNotInstalled` with install
instructions when the extra is missing.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from neo4j import Driver

#: Environment variable holding the Bolt URI of the Neo4j server.
URI_ENV = "NEO4J_URI"

#: Environment variable holding the Neo4j username.
USER_ENV = "NEO4J_USER"

#: Environment variable holding the Neo4j password.
PASSWORD_ENV = "NEO4J_PASSWORD"

#: Bolt URI used when neither config nor environment supplies one.
DEFAULT_URI = "bolt://localhost:7687"

#: Username used when neither config nor environment supplies one.
DEFAULT_USER = "neo4j"


class Neo4jConfigError(ValueError):
    """Raised when Neo4j connection settings are missing or invalid."""


class Neo4jDriverNotInstalled(ImportError):
    """Raised when the optional ``neo4j`` driver extra is not installed."""

    def __init__(self) -> None:
        super().__init__(
            "The Neo4j converter requires the official driver, which is not "
            "installed. Install it with: pip install 'culturescrape[neo4j]'"
        )


@dataclass(frozen=True)
class Neo4jConfig:
    """Resolved Neo4j connection settings."""

    uri: str
    user: str
    password: str


def _resolve(
    key: str,
    env_key: str,
    config: Mapping[str, Any] | None,
    env: Mapping[str, str],
    default: str | None,
) -> str | None:
    """Pick *key* from *config*, else *env_key* from *env*, else *default*."""
    if config is not None and config.get(key) is not None:
        return str(config[key])
    if env_key in env:
        return env[env_key]
    return default


def load_config(
    config: Mapping[str, Any] | None = None,
    *,
    env: Mapping[str, str] | None = None,
) -> Neo4jConfig:
    """Resolve connection settings from *config*, then the environment.

    Each field is taken from *config* (keys ``uri``/``user``/``password``) when
    present, otherwise from the matching environment variable, otherwise from a
    built-in default. The password has no default: it must come from *config* or
    :data:`PASSWORD_ENV`, and its absence raises :class:`Neo4jConfigError`.
    """
    source = os.environ if env is None else env
    uri = _resolve("uri", URI_ENV, config, source, DEFAULT_URI)
    user = _resolve("user", USER_ENV, config, source, DEFAULT_USER)
    password = _resolve("password", PASSWORD_ENV, config, source, None)
    if not password:
        raise Neo4jConfigError(
            f"No Neo4j password supplied; set {PASSWORD_ENV} or pass "
            "config['password']."
        )
    assert uri is not None and user is not None  # defaults are non-None
    return Neo4jConfig(uri=uri, user=user, password=password)


def connect(
    config: Mapping[str, Any] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    **driver_kwargs: Any,
) -> Driver:
    """Open a Neo4j driver from resolved connection settings.

    Settings are resolved via :func:`load_config`. Raises
    :class:`Neo4jDriverNotInstalled` with install instructions when the optional
    ``neo4j`` extra is absent.
    """
    settings = load_config(config, env=env)
    try:
        from neo4j import GraphDatabase
    except ImportError as exc:  # pragma: no cover - exercised via mocked import
        raise Neo4jDriverNotInstalled() from exc
    return GraphDatabase.driver(
        settings.uri, auth=(settings.user, settings.password), **driver_kwargs
    )


__all__ = [
    "DEFAULT_URI",
    "DEFAULT_USER",
    "Neo4jConfig",
    "Neo4jConfigError",
    "Neo4jDriverNotInstalled",
    "PASSWORD_ENV",
    "URI_ENV",
    "USER_ENV",
    "connect",
    "load_config",
]
