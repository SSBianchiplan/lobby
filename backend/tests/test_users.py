from app import db
from app.security import hash_password

from .conftest import admin, make_user
from .test_reservations import body, next_weekday

NEW = {"name": "Bia Lima", "email": "bia@ex.com", "password": "segredo123", "accept_terms": True}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_register_requires_terms_and_strong_password_and_saves_player_profile(client):
    r = await client.post("/api/auth/register", json={**NEW, "accept_terms": False})
    assert r.status_code == 422 and "termos" in r.json()["detail"]
    assert (await client.post("/api/auth/register", json={**NEW, "password": "curta1"})).status_code == 422
    r = await client.post("/api/auth/register", json={**NEW, "level": "5", "side": "esquerda", "hand": "canhoto", "city": " Rio Grande "})
    assert r.status_code == 201, r.text
    u = r.json()["user"]
    assert (u["level"], u["side"], u["hand"], u["city"], u["must_change_password"]) == ("5", "esquerda", "canhoto", "Rio Grande", False)
    assert (await client.post("/api/auth/register", json={**NEW, "email": "BIA@ex.com"})).status_code == 409


async def test_profile_update_and_stats(client):
    h = await make_user(client)
    r = await client.patch("/api/me", json={"phone": "(53) 99999-1111", "level": "4", "side": "direita"}, headers=h)
    assert r.status_code == 200 and r.json()["level"] == "4" and r.json()["phone"] == "(53) 99999-1111"
    assert (await client.patch("/api/me", json={"level": "7"}, headers=h)).status_code == 422
    await client.post("/api/reservations", json=body(next_weekday(3), method="card", players=["Carlos"]), headers=h)
    me = (await client.get("/api/me", headers=h)).json()
    assert me["stats"]["upcoming"] == 1 and me["stats"]["favorite_court"] == "Quadra 1"
    assert me["partners"] == [{"name": "Carlos", "games": 1}]


async def test_change_password_needs_current_and_drops_other_sessions(client):
    h = await make_user(client)
    other = auth((await client.post("/api/auth/login", json={"email": "ana@ex.com", "password": "segredo123"})).json()["token"])
    bad = await client.post("/api/me/password", json={"current_password": "errada123", "new_password": "novasenha9"}, headers=h)
    assert bad.status_code == 403
    r = await client.post("/api/me/password", json={"current_password": "segredo123", "new_password": "novasenha9"}, headers=h)
    assert r.status_code == 200
    assert (await client.get("/api/me", headers=auth(r.json()["token"]))).status_code == 200
    assert (await client.get("/api/me", headers=other)).status_code == 401  # o outro aparelho caiu
    assert (await client.post("/api/auth/login", json={"email": "ana@ex.com", "password": "novasenha9"})).status_code == 200
    # sair de todos: o token devolvido vale, o anterior não
    now = auth(r.json()["token"])
    out = await client.post("/api/me/logout-all", headers=now)
    assert (await client.get("/api/me", headers=now)).status_code == 401
    assert (await client.get("/api/me", headers=auth(out.json()["token"]))).status_code == 200


async def test_login_lockout_after_repeated_failures(client):
    await client.post("/api/auth/register", json={**NEW, "email": "trava@ex.com"})
    for _ in range(5):
        assert (await client.post("/api/auth/login", json={"email": "trava@ex.com", "password": "x"})).status_code == 401
    r = await client.post("/api/auth/login", json={"email": "trava@ex.com", "password": "segredo123"})
    assert r.status_code == 429


async def test_export_and_delete_account(client):
    h = await make_user(client)
    r = (await client.post("/api/reservations", json=body(next_weekday(2), method="card"), headers=h)).json()
    exp = await client.get("/api/me/export", headers=h)
    assert exp.status_code == 200 and exp.json()["reservas"][0]["code"] == r["code"] and exp.json()["conta"]["email"] == "ana@ex.com"

    assert (await client.request("DELETE", "/api/me", json={"password": "errada"}, headers=h)).status_code == 403
    blocked = await client.request("DELETE", "/api/me", json={"password": "segredo123"}, headers=h)
    assert blocked.status_code == 409  # reserva futura
    await client.post(f"/api/reservations/{r['code']}/cancel", json={}, headers=h)
    assert (await client.request("DELETE", "/api/me", json={"password": "segredo123"}, headers=h)).status_code == 200
    assert (await client.get("/api/me", headers=h)).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": "ana@ex.com", "password": "segredo123"})).status_code == 401
    # o e-mail fica livre para um novo cadastro; o histórico financeiro continua, sem dados pessoais
    assert (await client.post("/api/auth/register", json={**NEW, "email": "ana@ex.com"})).status_code == 201
    adm = await admin(client)
    found = (await client.get(f"/api/admin/bookings?q={r['code']}&start={next_weekday(2)}&end={next_weekday(2, 8)}", headers=adm)).json()
    assert found["items"][0]["owner"]["name"] == "Conta excluída" and found["items"][0]["payment_status"] == "refunded"


async def test_reception_reset_password_forces_change(client):
    h = await make_user(client)
    adm = await admin(client)
    users = (await client.get("/api/admin/users", headers=adm)).json()
    ana = next(u for u in users if u["email"] == "ana@ex.com")
    r = await client.post(f"/api/admin/users/{ana['id']}/reset-password", headers=adm)
    temp = r.json()["temporary_password"]
    assert (await client.get("/api/me", headers=h)).status_code == 401  # sessão antiga caiu
    login = (await client.post("/api/auth/login", json={"email": "ana@ex.com", "password": temp})).json()
    assert login["user"]["must_change_password"] is True
    r = await client.post("/api/me/password", json={"current_password": temp, "new_password": "minhanova1"}, headers=auth(login["token"]))
    assert r.json()["user"]["must_change_password"] is False

    # admin comum não redefine outro admin; master sim
    async with db.pool().acquire() as conn:
        await conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES ('Outro Admin', 'outro@ex.com', $1, 'admin')", hash_password("x" * 8))
        await conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES ('Master', 'stefanosbianchi@gmail.com', $1, 'admin')", hash_password("master123"))
    users = (await client.get("/api/admin/users", headers=adm)).json()
    outro = next(u for u in users if u["email"] == "outro@ex.com")
    master_u = next(u for u in users if u["is_master"])
    assert (await client.post(f"/api/admin/users/{outro['id']}/reset-password", headers=adm)).status_code == 403
    master = auth((await client.post("/api/auth/login", json={"email": "stefanosbianchi@gmail.com", "password": "master123"})).json()["token"])
    assert (await client.post(f"/api/admin/users/{outro['id']}/reset-password", headers=master)).status_code == 200
    assert (await client.post(f"/api/admin/users/{master_u['id']}/reset-password", headers=master)).status_code == 409
