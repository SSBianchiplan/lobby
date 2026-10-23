import os

from app import db
from app.domain import now_local
from app.security import hash_password

from .conftest import admin, make_user
from .test_reservations import body, next_weekday

MASTER = "stefanosbianchi@gmail.com"


async def _onsite(client, h, d, start="19:00", court=1):
    r = await client.post("/api/reservations", json=body(d, start, court=court, method="onsite"), headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def test_counter_receipt_enters_payments_and_closing_locks_it(client):
    adm = await admin(client)
    ana = await make_user(client)
    d = next_weekday(3)
    a = await _onsite(client, ana, d)
    b = await _onsite(client, ana, d, "20:00")

    pay = (await client.get("/api/admin/payments", headers=adm)).json()
    assert {r["code"] for r in pay["receivable"]} == {a["code"], b["code"]}

    r = await client.post(f"/api/admin/reservations/{a['code']}/receive", json={"channel": "dinheiro"}, headers=adm)
    assert r.status_code == 200 and r.json()["payment_status"] == "paid"
    today = now_local().date().isoformat()
    sm = (await client.get(f"/api/admin/closings/{today}", headers=adm)).json()["summary"]
    assert sm["by_channel"]["dinheiro"]["received_cents"] == a["price_cents"] == sm["cash_expected_cents"]

    # fecha com R$ 10 a menos na gaveta
    c = await client.post(f"/api/admin/closings/{today}", json={"cash_counted_cents": a["price_cents"] - 1000}, headers=adm)
    assert c.status_code == 201, c.text
    assert c.json()["closing"]["locked"] is True
    assert (await client.post(f"/api/admin/closings/{today}", json={"cash_counted_cents": 0}, headers=adm)).status_code == 409

    # caixa fechado: recebimento de balcão barrado pelo banco
    late = await client.post(f"/api/admin/reservations/{b['code']}/receive", json={"channel": "debito"}, headers=adm)
    assert late.status_code == 409 and "fechado" in late.json()["detail"]

    # pagamento online nunca é barrado — aparece como divergência do fechamento
    pix = (await client.post("/api/reservations", json=body(d, "21:00"), headers=ana)).json()
    hdr = {"X-Webhook-Secret": os.environ.get("PADEL_PIX_WEBHOOK_SECRET", "dev-webhook-secret")}
    assert (await client.post("/api/payments/pix/webhook", json={"txid": pix["pix"]["txid"], "status": "paid"}, headers=hdr)).status_code == 200
    drift = (await client.get(f"/api/admin/closings/{today}", headers=adm)).json()["drift"]
    assert drift["received_cents"] == pix["price_cents"]

    # reabrir libera o lançamento e guarda o histórico
    assert (await client.post(f"/api/admin/closings/{today}/reopen", json={"reason": "x"}, headers=adm)).status_code == 422
    ro = await client.post(f"/api/admin/closings/{today}/reopen", json={"reason": "faltou lançar débito"}, headers=adm)
    assert ro.status_code == 200 and ro.json()["closing"]["locked"] is False
    assert len(ro.json()["closing"]["history"]) == 1
    assert (await client.post(f"/api/admin/reservations/{b['code']}/receive", json={"channel": "debito"}, headers=adm)).status_code == 200


async def test_refund_is_dated_and_counted(client):
    adm = await admin(client)
    ana = await make_user(client)
    r = (await client.post("/api/reservations", json=body(next_weekday(4), method="card"), headers=ana)).json()
    assert (await client.post(f"/api/reservations/{r['code']}/cancel", json={}, headers=ana)).status_code == 200
    pay = (await client.get("/api/admin/payments", headers=adm)).json()
    kinds = sorted(i["kind"] for i in pay["items"] if i["code"] == r["code"])
    assert kinds == ["received", "refunded"] and pay["refunded_cents"] == r["price_cents"]
    assert pay["by_channel"]["cartao_online"]["refunded_cents"] == r["price_cents"]


async def test_bookings_occupancy_and_rentals_report(client):
    adm = await admin(client)
    ana = await make_user(client)
    d = next_weekday(2)
    a = await _onsite(client, ana, d, "19:00", court=2)
    q = f"start={d}&end={next_weekday(2, 8)}"
    bk = (await client.get(f"/api/admin/bookings?{q}&court_id=2", headers=adm)).json()
    assert bk["n"] == 1 and bk["items"][0]["code"] == a["code"] and bk["open_cents"] == a["price_cents"]
    assert (await client.get(f"/api/admin/bookings?{q}&court_id=1", headers=adm)).json()["n"] == 0
    assert (await client.get(f"/api/admin/bookings?{q}&q=ana", headers=adm)).json()["n"] == 1

    occ = (await client.get(f"/api/admin/occupancy?start={d}", headers=adm)).json()
    day = occ["days"][0]
    i = day["times"].index("19:00")
    cell = day["cells"]["2"][i]
    assert cell["s"] == "res" and cell["code"] == a["code"] and cell["first"] is True
    assert day["cells"]["2"][i + 1]["s"] == "res" and day["cells"]["2"][i + 1]["first"] is False
    assert day["cells"]["1"][i]["s"] == "free"
    assert day["booked_minutes"]["2"] == 60

    rep = (await client.get(f"/api/admin/reports/rentals?{q}", headers=adm)).json()
    assert rep["rentals"] == 1 and rep["gross_cents"] == a["price_cents"] and rep["open_cents"] == a["price_cents"]
    assert rep["by_court"][0]["label"] == "Quadra 2" and rep["by_hour"][0]["label"] == "19h"
    csv = await client.get(f"/api/admin/reports/rentals.csv?{q}&group=client", headers=adm)
    assert csv.status_code == 200 and "Ana Souza" in csv.text
    assert (await client.get(f"/api/admin/reports/rentals?{q}", headers=ana)).status_code == 403


async def test_master_admin_controls_roles(client):
    # cadastro público com e-mail master é recusado (e-mail não é verificado)
    r = await client.post("/api/auth/register", json={"name": "Impostor", "email": MASTER, "password": "segredo123", "accept_terms": True})
    assert r.status_code == 409
    async with db.pool().acquire() as conn:
        await conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES ('Master', $1, $2, 'admin')",
                           MASTER, hash_password("master123"))
    login = (await client.post("/api/auth/login", json={"email": MASTER, "password": "master123"})).json()
    assert login["user"]["is_master"] is True
    master = {"Authorization": f"Bearer {login['token']}"}
    adm = await admin(client)
    await make_user(client)
    users = (await client.get("/api/admin/users", headers=adm)).json()
    ana = next(u for u in users if u["email"] == "ana@ex.com")
    me = next(u for u in users if u["email"] == MASTER)

    assert (await client.put(f"/api/admin/users/{ana['id']}/role", json={"role": "admin"}, headers=adm)).status_code == 403
    assert (await client.put(f"/api/admin/users/{ana['id']}/role", json={"role": "admin"}, headers=master)).status_code == 200
    assert (await client.put(f"/api/admin/users/{me['id']}/role", json={"role": "player"}, headers=master)).status_code == 409


async def test_static_fallback_does_not_escape_dist(client):
    from app.main import DIST
    if not DIST.exists():
        return  # sem build do front, a rota de estáticos não existe
    r = await client.get("/%2e%2e/%2e%2e/backend/requirements.txt")
    assert "asyncpg" not in r.text and "<div id=\"root\"" in r.text
    assert (await client.get("/manifest.webmanifest")).headers["content-type"].startswith("application/manifest+json")
