from app import db
from app.security import hash_password

from .conftest import admin, make_user
from .test_reservations import body, next_weekday

MASTER = "stefanosbianchi@gmail.com"


async def _master(client):
    async with db.pool().acquire() as conn:
        await conn.execute("INSERT INTO users (name, email, password_hash, role) VALUES ('Master', $1, $2, 'admin')", MASTER, hash_password("master123"))
    r = await client.post("/api/auth/login", json={"email": MASTER, "password": "master123"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def test_purge_demo_keeps_real_data(client):
    import seed
    async with db.pool().acquire() as conn:
        await seed.seed_demo(conn)
    master = await _master(client)
    adm = await admin(client)

    # cliente real com reserva, que convidou um jogador de exemplo
    ana = await make_user(client)
    real = (await client.post("/api/reservations", json=body(next_weekday(3), "22:00", court=3, method="onsite"), headers=ana)).json()
    async with db.pool().acquire() as conn:
        bruno = await conn.fetchval("SELECT id FROM users WHERE email = 'bruno.lima@exemplo.com'")
        rid = await conn.fetchval("SELECT id FROM reservations WHERE code = $1", real["code"])
        await conn.execute("INSERT INTO reservation_players (reservation_id, user_id, name) VALUES ($1, $2, 'Bruno Lima')", rid, bruno)
        # um dia com dinheiro de exemplo já fechado
        demo_day = await conn.fetchval(
            """SELECT p.paid_at::date FROM payments p JOIN reservations r ON r.id = p.reservation_id
               JOIN users u ON u.id = r.user_id WHERE u.email LIKE '%@exemplo.com' AND p.paid_at IS NOT NULL LIMIT 1""")
    assert (await client.post(f"/api/admin/closings/{demo_day}", json={"cash_counted_cents": 0}, headers=adm)).status_code == 201

    # só o master vê e executa
    assert (await client.get("/api/admin/maintenance/demo-data", headers=adm)).status_code == 403
    assert (await client.post("/api/admin/maintenance/purge-demo", json={"confirm": "APAGAR", "password": "admin123"}, headers=adm)).status_code == 403
    prev = (await client.get("/api/admin/maintenance/demo-data", headers=master)).json()
    assert prev["users"] == 8 and prev["reservations"] > 100 and prev["closings"] == 1
    assert prev["invited_elsewhere"] == 1 and prev["kept_reservations"] == 1

    # confirmação e senha obrigatórias; prévia não altera nada
    assert (await client.post("/api/admin/maintenance/purge-demo", json={"confirm": "apaga", "password": "master123"}, headers=master)).status_code == 422
    assert (await client.post("/api/admin/maintenance/purge-demo", json={"confirm": "APAGAR", "password": "errada"}, headers=master)).status_code == 403
    assert (await client.get("/api/admin/maintenance/demo-data", headers=master)).json()["users"] == 8

    r = await client.post("/api/admin/maintenance/purge-demo", json={"confirm": "apagar", "password": "master123"}, headers=master)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"]["users"] == 8 and r.json()["deleted"]["closings"] == 1
    left = r.json()["remaining"]
    assert left["users"] == 0 and left["reservations"] == 0 and left["kept_reservations"] == 1

    async with db.pool().acquire() as conn:
        emails = {r["email"] for r in await conn.fetch("SELECT email::text FROM users")}
        assert emails == {"admin@padellobby.com.br", "ana@ex.com", MASTER}
        players = await conn.fetch("SELECT name, user_id FROM reservation_players WHERE reservation_id = $1 ORDER BY id", rid)
        assert [p["name"] for p in players] == ["Ana Souza", "Bruno Lima"] and players[1]["user_id"] is None
        assert await conn.fetchval("SELECT count(*) FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id WHERE r.id IS NULL") == 0
        assert await conn.fetchval("SELECT count(*) FROM courts") == 3 and await conn.fetchval("SELECT count(*) FROM price_rules") == 3

    # a reserva real continua funcionando, e rodar de novo é inofensivo
    assert (await client.get(f"/api/reservations/{real['code']}", headers=ana)).status_code == 200
    again = await client.post("/api/admin/maintenance/purge-demo", json={"confirm": "APAGAR", "password": "master123"}, headers=master)
    assert again.status_code == 200 and again.json()["deleted"]["users"] == 0
