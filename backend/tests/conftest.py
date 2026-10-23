import asyncio
import os

import pytest
import pytest_asyncio

os.environ.setdefault("PADEL_DATABASE_URL", "postgresql://padel:padel@localhost:5432/padel_lobby_test")

from app import db  # noqa: E402

TABLES = "daily_closings, reservation_events, notifications, payments, reservation_players, blocks, reservations, holidays, price_rules, business_hours, settings, courts, users"


@pytest_asyncio.fixture
async def client():
    """App real contra o banco de teste, recriado a cada teste."""
    from httpx import ASGITransport, AsyncClient

    from app.main import app
    import seed

    pool = await db.connect(os.environ["PADEL_DATABASE_URL"])
    async with pool.acquire() as conn:
        await db.migrate(conn)
        await conn.execute(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
    await db.close()
    await seed.main(demo=False)
    await db.connect(os.environ["PADEL_DATABASE_URL"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c
    await db.close()


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def make_user(client, email="ana@ex.com", name="Ana Souza"):
    r = await client.post("/api/auth/register", json={"name": name, "email": email, "password": "segredo123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def admin(client):
    r = await client.post("/api/auth/login", json={"email": "admin@padellobby.com.br", "password": "admin123"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


__all__ = ["asyncio", "make_user", "admin"]
