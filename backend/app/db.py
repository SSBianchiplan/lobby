import json
from pathlib import Path

import asyncpg

from .config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def connect(dsn: str | None = None) -> asyncpg.Pool:
    global _pool
    # timezone como parâmetro de conexão: sobrevive ao RESET ALL que o pool faz ao devolver conexões
    _pool = await asyncpg.create_pool(
        dsn or get_settings().database_url, min_size=1, max_size=10, init=_init_conn,
        server_settings={"timezone": get_settings().timezone},
    )
    return _pool


async def close() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    assert _pool is not None, "pool não inicializado"
    return _pool


async def migrate(conn: asyncpg.Connection) -> list[str]:
    """Aplica migrations/*.sql em ordem, uma única vez cada."""
    await conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    done = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
    applied = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in done:
            continue
        async with conn.transaction():
            await conn.execute(path.read_text())
            await conn.execute("INSERT INTO schema_migrations (name) VALUES ($1)", path.name)
        applied.append(path.name)
    return applied
