from datetime import timedelta

from app import db
from app.domain import now_local

from .conftest import admin, make_user


async def _coach(client, adm, name):
    return (await client.post("/api/admin/coaches", json={"name": name}, headers=adm)).json()["id"]


async def _session(coach_id, minutes_from_now, court=1, title="Aula"):
    s = now_local().replace(second=0, microsecond=0) + timedelta(minutes=minutes_from_now)
    async with db.pool().acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO class_sessions (coach_id, court_id, period, title) VALUES ($1, $2, tstzrange($3, $4, '[)'), $5) RETURNING id",
            coach_id, court, s, s + timedelta(minutes=60), title)


async def test_access_grant_scoping_and_class_flow(client):
    adm = await admin(client)
    lucas = await _coach(client, adm, "Lucas Tavares")
    other = await _coach(client, adm, "Outra Prof")
    # dá acesso: cria a conta com senha temporária e troca obrigatória
    g = (await client.put(f"/api/admin/coaches/{lucas}/access", json={"email": "Lucas@Padel.com"}, headers=adm)).json()
    assert g["temporary_password"] and g["email"] == "lucas@padel.com"
    login = (await client.post("/api/auth/login", json={"email": "lucas@padel.com", "password": g["temporary_password"]})).json()
    assert login["user"]["is_coach"] is True and login["user"]["must_change_password"] is True
    h = {"Authorization": f"Bearer {login['token']}"}
    mine = await _session(lucas, 20, court=1, title="Turma A")
    theirs = await _session(other, 20, court=2, title="Turma B")
    later = await _session(lucas, 300, court=3, title="Turma C")
    async with db.pool().acquire() as conn:
        ana_id = await conn.fetchval("INSERT INTO users (name, email, password_hash) VALUES ('Ana Aluna', 'ana.aluna@ex.com', 'x') RETURNING id")
        await conn.execute("INSERT INTO attendance (session_id, user_id, status, dropin) VALUES ($1, $2, 'absent', true)", mine, ana_id)
        await conn.execute("INSERT INTO student_charges (user_id, kind, session_id, description, amount_cents) VALUES ($1, 'private', $2, 'Aula', 9000)", ana_id, mine)

    me = (await client.get("/api/coach/me", headers=h)).json()
    assert "Turma A" in [s["name"] for s in me["today"]] and "Turma B" not in [s["name"] for s in me["today"]]
    assert me["coach"]["name"] == "Lucas Tavares"
    # só as próprias aulas; e sem valores financeiros
    assert (await client.get(f"/api/coach/sessions/{theirs}", headers=h)).status_code == 404
    det = (await client.get(f"/api/coach/sessions/{mine}", headers=h)).json()
    assert det["roster"][0]["name"] == "Ana Aluna" and "open_cents" not in det["roster"][0]
    assert (await client.post(f"/api/coach/sessions/{theirs}/attendance", json={"user_id": ana_id, "status": "present"}, headers=h)).status_code == 404

    # iniciar aula pelo celular: só perto do horário
    assert (await client.post(f"/api/coach/sessions/{later}/start", headers=h)).status_code == 409
    st = (await client.post(f"/api/coach/sessions/{mine}/start", headers=h)).json()
    assert st["started_at"] and st["coach_checked_in_at"]
    det = (await client.post(f"/api/coach/sessions/{mine}/attendance", json={"user_id": ana_id, "status": "present"}, headers=h)).json()
    assert det["present"] == 1
    det = (await client.put(f"/api/coach/sessions/{mine}/notes", json={"notes": "  Saque e voleio de revés. Ana evoluiu na bandeja.  "}, headers=h)).json()
    assert det["notes"] == "Saque e voleio de revés. Ana evoluiu na bandeja."
    studs = (await client.get("/api/coach/students", headers=h)).json()
    assert studs[0]["name"] == "Ana Aluna" and studs[0]["presences"] == 1

    # professor não acessa o admin; jogador não acessa a área do professor
    assert (await client.get("/api/admin/class-sessions", headers=h)).status_code == 403
    ana = await make_user(client)
    assert (await client.get("/api/coach/me", headers=ana)).status_code == 403
    # vincular a mesma conta a outro professor é barrado; tirar o acesso derruba a área
    assert (await client.put(f"/api/admin/coaches/{other}/access", json={"email": "lucas@padel.com"}, headers=adm)).status_code == 409
    assert (await client.delete(f"/api/admin/coaches/{lucas}/access", headers=adm)).status_code == 200
    assert (await client.get("/api/coach/me", headers=h)).status_code == 403
    # conta existente é vinculada sem senha temporária
    g2 = (await client.put(f"/api/admin/coaches/{other}/access", json={"email": "ana@ex.com"}, headers=adm)).json()
    assert g2["temporary_password"] is None
