import asyncio
from datetime import date, datetime, timedelta

from app.domain import now_local

from .conftest import admin, make_user


def next_weekday(wd: int, min_days: int = 1) -> date:
    """Próxima data com ISO weekday `wd`, pelo menos `min_days` à frente."""
    d = now_local().date() + timedelta(days=min_days)
    while d.isoweekday() != wd:
        d += timedelta(days=1)
    return d


def body(d: date, start="19:00", court=1, duration=60, method="pix", players=()):
    return {"court_id": court, "date": d.isoformat(), "start": start, "duration": duration, "payment_method": method, "players": list(players)}


async def test_availability_marks_lunch_break_and_sunday_closed(client):
    d = next_weekday(3)
    av = (await client.get(f"/api/availability?date={d}&duration=60")).json()
    rows = {r["time"]: r for r in av["rows"]}
    assert rows["13:00"]["break"] is True and rows["13:00"]["until"] == "14:00"
    assert rows["12:00"]["slots"][0]["status"] == "free"
    assert "23:00" not in rows and rows["22:00"]["break"] is False
    sunday = (await client.get(f"/api/availability?date={next_weekday(7)}&duration=60")).json()
    assert sunday["open"] is False


async def test_90min_cannot_cross_lunch_break(client):
    d = next_weekday(2)
    av = (await client.get(f"/api/availability?date={d}&duration=90")).json()
    row12 = next(r for r in av["rows"] if r["time"] == "12:00")
    assert all(s["status"] == "nofit" for s in row12["slots"])
    h = await make_user(client)
    r = await client.post("/api/reservations", json=body(d, "12:00", duration=90), headers=h)
    assert r.status_code == 422


async def test_pricing_peak_offpeak_weekend(client):
    wed = next_weekday(3)
    sat = next_weekday(6)
    q = lambda d, s, dur=60: client.get(f"/api/quote?court_id=1&date={d}&start={s}&duration={dur}")
    assert (await q(wed, "19:00")).json()["cents"] == 14000
    assert (await q(wed, "14:00")).json()["cents"] == 10000
    # 17:00–18:30 cruza faixas: 1h promo + 30min nobre
    mixed = (await q(wed, "17:00", 90)).json()
    assert mixed["cents"] == 10000 + 7000 and len(mixed["lines"]) == 2
    assert (await q(sat, "19:00")).json() == {"cents": 10000, "promo": True, "lines": [
        {"label": "Promoção fim de semana e feriado", "minutes": 60, "cents": 10000, "cents_per_hour": 10000}]}


async def test_pix_flow_confirm_and_double_booking_blocked(client):
    d = next_weekday(4)
    ana = await make_user(client)
    bia = await make_user(client, "bia@ex.com", "Bia Lima")
    r = await client.post("/api/reservations", json=body(d, players=["Carlos"]), headers=ana)
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["status"] == "pending" and res["pix"]["payload"].startswith("000201")
    # horários sempre no fuso do clube (asyncpg devolve UTC)
    assert (res["date"], res["start"], res["end"]) == (d.isoformat(), "19:00", "20:00")
    assert len(res["players"]) == 2 and res["per_player_cents"] == 7000

    # mesma quadra/horário (sobreposição parcial com 90 min) → 409 pela EXCLUDE constraint
    clash = await client.post("/api/reservations", json=body(d, "18:00", duration=90), headers=bia)
    assert clash.status_code == 409

    # webhook do PSP confirma (idempotente)
    import os
    hdr = {"X-Webhook-Secret": os.environ.get("PADEL_PIX_WEBHOOK_SECRET", "dev-webhook-secret")}
    w = await client.post("/api/payments/pix/webhook", json={"txid": res["pix"]["txid"], "status": "paid"}, headers=hdr)
    assert w.status_code == 200
    w2 = await client.post("/api/payments/pix/webhook", json={"txid": res["pix"]["txid"], "status": "paid"}, headers=hdr)
    assert w2.json()["idempotent"] is True
    got = (await client.get(f"/api/reservations/{res['code']}", headers=ana)).json()
    assert got["status"] == "confirmed" and got["payment_status"] == "paid"
    assert (await client.get(f"/api/reservations/{res['code']}", headers=bia)).status_code == 404


async def test_concurrent_requests_only_one_wins(client):
    d = next_weekday(5)
    users = [await make_user(client, f"u{i}@ex.com", f"User {i}") for i in range(6)]
    results = await asyncio.gather(*[client.post("/api/reservations", json=body(d, "20:00", court=2, method="card"), headers=h) for h in users])
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and codes.count(409) == 5


async def test_expired_hold_frees_slot(client):
    from app import db, jobs

    d = next_weekday(1)
    ana = await make_user(client)
    res = (await client.post("/api/reservations", json=body(d, "21:00"), headers=ana)).json()
    async with db.pool().acquire() as conn:
        await conn.execute("UPDATE reservations SET hold_expires_at = now() - interval '1 minute' WHERE code = $1", res["code"])
        assert (await jobs.run_once(conn))["expired"] == 1
    av = (await client.get(f"/api/availability?date={d}&duration=60")).json()
    assert next(r for r in av["rows"] if r["time"] == "21:00")["slots"][0]["status"] == "free"
    notes = (await client.get("/api/notifications", headers=ana)).json()
    assert notes["items"][0]["kind"] == "expired"


async def test_cancel_policy_refund_window(client):
    from app import db

    d = next_weekday(2, min_days=3)
    ana = await make_user(client)
    res = (await client.post("/api/reservations", json=body(d, "19:00", method="card"), headers=ana)).json()
    c = (await client.post(f"/api/reservations/{res['code']}/cancel", json={}, headers=ana)).json()
    assert c["refund"] is True and c["reservation"]["payment_status"] == "refunded"
    # cancelar de novo → 409 (máquina de estados no banco)
    assert (await client.post(f"/api/reservations/{res['code']}/cancel", json={}, headers=ana)).status_code == 409

    # reserva em cima da hora (dentro da janela): cancela sem estorno
    res2 = (await client.post("/api/reservations", json=body(d, "20:00", method="card"), headers=ana)).json()
    async with db.pool().acquire() as conn:
        soon = now_local() + timedelta(hours=2)
        await conn.execute(
            "UPDATE reservations SET period = tstzrange($2::timestamptz, $2::timestamptz + interval '60 minutes', '[)') WHERE code = $1", res2["code"], soon)
    c2 = (await client.post(f"/api/reservations/{res2['code']}/cancel", json={}, headers=ana)).json()
    assert c2["refund"] is False and c2["reservation"]["payment_status"] == "paid"


async def test_invite_join_and_player_limit(client):
    d = next_weekday(3)
    ana = await make_user(client)
    res = (await client.post("/api/reservations", json=body(d, "18:00", method="onsite", players=["B", "C"]), headers=ana)).json()
    token = res["invite_token"]
    info = (await client.get(f"/api/invites/{token}")).json()
    assert info["owner_name"] == "Ana" and len(info["players"]) == 3
    dani = await make_user(client, "dani@ex.com", "Dani Reis")
    j = await client.post(f"/api/invites/{token}/join", headers=dani)
    assert j.status_code == 200 and len(j.json()["players"]) == 4
    eva = await make_user(client, "eva@ex.com", "Eva Melo")
    full = await client.post(f"/api/invites/{token}/join", headers=eva)
    assert full.status_code == 409 and "completa" in full.json()["detail"]
    # quem entrou pelo convite vê a reserva em "minhas"
    mine = (await client.get("/api/reservations/mine?scope=upcoming", headers=dani)).json()
    assert [m["code"] for m in mine] == [res["code"]]


async def test_admin_block_prevents_booking_and_checkin_window(client):
    d = next_weekday(4)
    adm = await admin(client)
    b = await client.post("/api/admin/blocks", json={"court_id": 3, "date": d.isoformat(), "start": "18:00", "end": "20:00", "reason": "Manutenção"}, headers=adm)
    assert b.status_code == 201
    ana = await make_user(client)
    r = await client.post("/api/reservations", json=body(d, "19:00", court=3), headers=ana)
    assert r.status_code == 409
    av = (await client.get(f"/api/availability?date={d}&duration=60")).json()
    assert next(x for x in av["rows"] if x["time"] == "19:00")["slots"][2]["status"] == "blocked"
    ok = (await client.post("/api/reservations", json=body(d, "21:00", court=3, method="card"), headers=ana)).json()
    early = await client.post("/api/admin/checkin", json={"code": ok["code"]}, headers=adm)
    assert early.status_code == 409 and "1 h antes" in early.json()["detail"]
    assert (await client.get("/api/admin/dashboard", headers=ana)).status_code == 403
    dash = (await client.get("/api/admin/dashboard", headers=adm)).json()
    assert dash["capacity_minutes"] > 0
    sched = (await client.get(f"/api/admin/schedule?date={d}", headers=adm)).json()
    assert sched["blocks"][0]["starts"].endswith("18:00")
    assert [x["start"] for x in sched["reservations"]] == ["21:00"]


async def test_max_active_reservations_per_user(client):
    ana = await make_user(client)
    d = next_weekday(1)
    for t in ("15:00", "16:00", "17:00"):
        assert (await client.post("/api/reservations", json=body(d, t, method="card"), headers=ana)).status_code == 201
    r = await client.post("/api/reservations", json=body(d, "18:00", method="card"), headers=ana)
    assert r.status_code == 409 and "3 reservas" in r.json()["detail"]
