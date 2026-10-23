from datetime import timedelta

from app import db
from app.domain import now_local

from .conftest import admin, make_user


async def _reservation(starts_in_min: int, code: str) -> None:
    s = now_local().replace(second=0, microsecond=0) + timedelta(minutes=starts_in_min)
    async with db.pool().acquire() as conn:
        uid = await conn.fetchval("SELECT id FROM users WHERE email = 'ana@ex.com'")
        await conn.execute(
            """INSERT INTO reservations (code, court_id, user_id, period, duration_min, status, payment_method, payment_status, price_cents)
               VALUES ($1, 1, $2, tstzrange($3, $4, '[)'), 60, 'confirmed', 'card', 'paid', 10000)""",
            code, uid, s, s + timedelta(minutes=60))


async def test_checkin_window_and_idempotence(client):
    adm = await admin(client)
    await make_user(client)
    await _reservation(30, "PL-AGORA")
    await _reservation(180, "PL-CEDOO")

    early = await client.post("/api/admin/checkin", json={"code": "PL-CEDOO"}, headers=adm)
    assert early.status_code == 409 and "Cedo demais" in early.json()["detail"] and "abre" in early.json()["detail"]

    # o leitor manda o código como veio do QR (minúsculas/espaços); o servidor normaliza
    ok = await client.post("/api/admin/checkin", json={"code": "  pl-agora "}, headers=adm)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "checked_in" and ok.json()["checked_in_at"]
    again = await client.post("/api/admin/checkin", json={"code": "PL-AGORA"}, headers=adm)
    assert again.status_code == 409 and "já realizado" in again.json()["detail"]
    assert (await client.post("/api/admin/checkin", json={"code": "PL-NADAA"}, headers=adm)).status_code == 404
