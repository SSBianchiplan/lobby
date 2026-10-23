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


async def test_court_photos_and_gallery(client):
    club = (await client.get("/api/club")).json()
    assert len(club["gallery"]) == 4
    photos = {c["number"]: c["photo"] for c in club["courts"]}
    assert photos == {1: "/quadras/quadra-vidro-1600.webp", 2: "/quadras/quadra-fundo-1600.webp", 3: "/quadras/quadra-lateral-1600.webp"}
    adm = await admin(client)
    c1 = club["courts"][0]["id"]
    assert (await client.put(f"/api/admin/courts/{c1}/photo", json={"photo": "/quadras/quadra-rede-1600.webp"}, headers=adm)).status_code == 200
    assert (await client.put(f"/api/admin/courts/{c1}/photo", json={"photo": "https://evil.example/x.webp"}, headers=adm)).status_code == 422
    assert (await client.get("/api/club")).json()["courts"][0]["photo"] == "/quadras/quadra-rede-1600.webp"
    ana = await make_user(client)
    assert (await client.put(f"/api/admin/courts/{c1}/photo", json={"photo": None}, headers=ana)).status_code == 403


async def test_invite_link_preview_for_whatsapp(client):
    from app.main import DIST
    if not DIST.exists():
        return
    ana = await make_user(client)
    from .test_reservations import body, next_weekday
    r = (await client.post("/api/reservations", json=body(next_weekday(3), "19:00", court=2, method="card", players=["Bia"]), headers=ana)).json()
    page = (await client.get(f"/convite/{r['invite_token']}")).text
    assert 'property="og:title" content="🎾 Bora jogar? Quadra 2 · Qua' in page and "19:00–20:00" in page
    assert "Faltam 2 vagas" in page and "R$ 35,00 por jogador" in page
    assert 'og:image" content="http://t/quadras/quadra-fundo-og.jpg"' in page
    assert "<title>🎾 Bora jogar? Quadra 2" in page
    generic = (await client.get("/convite/00000000-0000-0000-0000-000000000000")).text
    assert 'og:title" content="Padel Lobby — Reservas"' in generic
    await client.post(f"/api/reservations/{r['code']}/cancel", json={}, headers=ana)
    assert "Bora jogar" not in (await client.get(f"/convite/{r['invite_token']}")).text


async def test_calendar_events_merge_reservations_classes_blocks(client):
    from datetime import timedelta

    from .test_reservations import body, next_weekday
    adm = await admin(client)
    ana = await make_user(client)
    d = next_weekday(3)
    r = (await client.post("/api/reservations", json=body(d, "19:00", court=1, method="card"), headers=ana)).json()
    coach = (await client.post("/api/admin/coaches", json={"name": "Prof Cal"}, headers=adm)).json()["id"]
    await client.post("/api/admin/class-sessions", json={"coach_id": coach, "court_id": 2, "date": d.isoformat(), "start": "20:00", "title": "Aula X"}, headers=adm)
    await client.post("/api/admin/blocks", json={"court_id": 3, "date": d.isoformat(), "start": "14:00", "end": "15:00", "reason": "Pintura"}, headers=adm)
    cal = (await client.get(f"/api/admin/calendar?start={d}&end={d + timedelta(days=1)}", headers=adm)).json()
    kinds = [(e["type"], e["court_id"], e["start"][11:16]) for e in cal["events"]]
    assert kinds == [("block", 3, "14:00"), ("reservation", 1, "19:00"), ("class", 2, "20:00")]
    assert cal["events"][1]["id"] == r["code"] and cal["days"][0]["intervals"] == [["12:00", "13:00"], ["14:00", "23:00"]]
    only2 = (await client.get(f"/api/admin/calendar?start={d}&end={d + timedelta(days=1)}&court_id=2", headers=adm)).json()
    assert [e["type"] for e in only2["events"]] == ["class"]
    assert (await client.get(f"/api/admin/calendar?start={d}&end={d + timedelta(days=60)}", headers=adm)).status_code == 422


async def test_system_manual_is_admin_only(client):
    adm = await admin(client)
    ana = await make_user(client)
    assert (await client.get("/api/admin/manual")).status_code == 401
    assert (await client.get("/api/admin/manual", headers=ana)).status_code == 403
    r = await client.get("/api/admin/manual", headers=adm)
    assert r.status_code == 200 and "Manual do Sistema" in r.text and 'id="fechamento"' in r.text and "GPlanSiS|Group" in r.text
    from app.main import DIST
    if DIST.exists():  # e não existe cópia pública
        assert "Manual do Sistema" not in (await client.get("/manual.html")).text


async def test_admin_creates_users_with_temporary_password(client):
    adm = await admin(client)
    r = await client.post("/api/admin/users", json={"name": "Nova Jogadora", "email": "Nova@Ex.com", "phone": "(53) 98888-0000", "level": "5"}, headers=adm)
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "nova@ex.com" and r.json()["role"] == "player" and r.json()["temporary_password"]
    login = (await client.post("/api/auth/login", json={"email": "nova@ex.com", "password": r.json()["temporary_password"]})).json()
    assert login["user"]["must_change_password"] is True and login["user"]["level"] == "5"
    assert (await client.post("/api/admin/users", json={"name": "Dup", "email": "nova@ex.com"}, headers=adm)).status_code == 409
    # admin comum não cria admin; master cria
    assert (await client.post("/api/admin/users", json={"name": "Outro Admin", "email": "oa@ex.com", "role": "admin"}, headers=adm)).status_code == 403
    async with db.pool().acquire() as conn:
        await conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES ('Master', $1, $2, 'admin')", MASTER, hash_password("master123"))
    m = {"Authorization": f"Bearer {(await client.post('/api/auth/login', json={'email': MASTER, 'password': 'master123'})).json()['token']}"}
    assert (await client.post("/api/admin/users", json={"name": "Outro Admin", "email": "oa@ex.com", "role": "admin"}, headers=m)).json()["role"] == "admin"
    ana = await make_user(client)
    assert (await client.post("/api/admin/users", json={"name": "X Y", "email": "xy@ex.com"}, headers=ana)).status_code == 403
