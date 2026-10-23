from datetime import timedelta

from app import db
from app.domain import now_local

from .conftest import admin, make_user
from .test_reservations import body, next_weekday


def book(d, start="19:00", court=1, **kw):
    return {"court_id": court, "date": d.isoformat(), "start": start, "duration": kw.pop("duration", 60), **kw}


async def test_reception_books_for_registered_client_beyond_limits(client):
    adm = await admin(client)
    ana = await make_user(client)
    users = (await client.get("/api/admin/users?q=ana", headers=adm)).json()
    ana_id = users[0]["id"]
    # cliente já no limite de 3 reservas futuras
    for i, st in enumerate(["14:00", "15:00", "16:00"]):
        assert (await client.post("/api/reservations", json=body(next_weekday(2), st, court=1, method="onsite"), headers=ana)).status_code == 201
    assert (await client.post("/api/reservations", json=body(next_weekday(2), "17:00", method="onsite"), headers=ana)).status_code == 409
    # a recepção pode, inclusive além da janela de 14 dias
    far = next_weekday(3, 20)
    r = await client.post("/api/admin/reservations", json=book(far, user_id=ana_id, players=["Carlos"]), headers=adm)
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["owner"]["name"] == "Ana Souza" and res["status"] == "confirmed" and res["payment_status"] == "onsite"
    assert len(res["players"]) == 2 and res["warning"] is None
    # e a cliente vê a reserva na conta dela
    mine = (await client.get("/api/reservations/mine", headers=ana)).json()
    assert res["code"] in {m["code"] for m in mine}


async def test_walk_in_client_with_counter_payment(client):
    adm = await admin(client)
    d = next_weekday(4)
    r = await client.post("/api/admin/reservations", json=book(d, "20:00", court=2, client={"name": "João Balcão", "phone": "(53) 99111-2222"}, receive="debito"), headers=adm)
    assert r.status_code == 201, r.text
    res = r.json()
    assert res["payment_status"] == "paid" and res["owner"]["name"] == "João Balcão"
    async with db.pool().acquire() as conn:
        pay = await conn.fetchrow("SELECT channel, received_by IS NOT NULL AS manual FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE r.code = $1", res["code"])
        assert (pay["channel"], pay["manual"]) == ("debito", True)
        u = await conn.fetchrow("SELECT email::text, accepted_terms_at FROM users WHERE name = 'João Balcão'")
        assert u["email"].endswith("@padellobby.invalid") and u["accepted_terms_at"] is None
    occ = (await client.get(f"/api/admin/occupancy?start={d}", headers=adm)).json()
    day = occ["days"][0]
    assert day["cells"]["2"][day["times"].index("20:00")]["code"] == res["code"]


async def test_taken_slot_leaves_no_orphan_client_and_validations(client):
    adm = await admin(client)
    ana = await make_user(client)
    d = next_weekday(5)
    await client.post("/api/reservations", json=body(d, "19:00", method="card"), headers=ana)
    async with db.pool().acquire() as conn:
        before = await conn.fetchval("SELECT count(*) FROM users")
    r = await client.post("/api/admin/reservations", json=book(d, "19:00", client={"name": "Maria Nova"}), headers=adm)
    assert r.status_code == 409
    async with db.pool().acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM users") == before

    assert (await client.post("/api/admin/reservations", json=book(d, "20:00"), headers=adm)).status_code == 422
    assert (await client.post("/api/admin/reservations", json=book(d, "20:00", user_id=1, client={"name": "X Y"}), headers=adm)).status_code == 422
    dup = await client.post("/api/admin/reservations", json=book(d, "20:00", client={"name": "Outra Ana", "email": "ANA@ex.com"}), headers=adm)
    assert dup.status_code == 409
    assert (await client.post("/api/admin/reservations", json=book(d, "20:00", client={"name": "X Y"}), headers=ana)).status_code == 403


async def test_closed_day_keeps_booking_as_receivable(client):
    adm = await admin(client)
    today = now_local().date()
    assert (await client.post(f"/api/admin/closings/{today}", json={"cash_counted_cents": 0}, headers=adm)).status_code == 201
    d = next_weekday(3) if next_weekday(3) > today else today + timedelta(days=7)
    r = await client.post("/api/admin/reservations", json=book(d, "21:00", client={"name": "Pedro Tarde"}, receive="dinheiro"), headers=adm)
    assert r.status_code == 201
    assert r.json()["payment_status"] == "onsite" and "a receber" in r.json()["warning"]
