from datetime import timedelta

from app import db
from app.domain import now_local

from .conftest import admin, make_user
from .test_reservations import body, next_weekday


async def _coach(client, adm, name="Prof. Lucas"):
    r = await client.post("/api/admin/coaches", json={"name": name, "color": "#2563EB"}, headers=adm)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _group(client, adm, coach, wd=3, starts="20:00", court=2, capacity=4, **kw):
    r = await client.post("/api/admin/class-groups", json={
        "name": kw.pop("name", "Iniciantes"), "coach_id": coach, "court_id": court, "weekdays": [wd], "starts": starts,
        "duration_min": 60, "capacity": capacity, "monthly_price_cents": kw.pop("monthly", 25000), "dropin_price_cents": kw.pop("dropin", 6000), **kw,
    }, headers=adm)
    assert r.status_code == 201, r.text
    return r.json()


async def test_calendar_generation_and_court_invariants(client):
    adm = await admin(client)
    ana = await make_user(client)
    wed = next_weekday(3)
    # reserva já existente numa das quartas: a geração pula esse dia e relata
    await client.post("/api/reservations", json=body(wed, "20:00", court=2, method="card"), headers=ana)
    coach = await _coach(client, adm)
    g = await _group(client, adm, coach)
    gen = g["generation"]
    assert gen["created"] >= 3 and any(s["date"] == wed.isoformat() and "reservada" in s["reason"] for s in gen["skipped"])
    assert g["group"]["schedule"].startswith("Qua · 20:00")

    # reserva sobre aula → 409 com mensagem certa; e o jogador vê o horário indisponível
    nxt = wed + timedelta(days=7)
    r = await client.post("/api/reservations", json=body(nxt, "20:00", court=2, method="card"), headers=ana)
    assert r.status_code == 409 and "aula" in r.json()["detail"]
    av = (await client.get(f"/api/availability?date={nxt}&duration=60")).json()
    row = next(x for x in av["rows"] if x["time"] == "20:00")
    assert next(s for s in row["slots"] if s["court_id"] == 2)["status"] == "blocked"
    occ = (await client.get(f"/api/admin/occupancy?start={nxt}", headers=adm)).json()["days"][0]
    assert occ["cells"]["2"][occ["times"].index("20:00")]["s"] == "class"

    # gerar de novo não duplica
    again = await client.post(f"/api/admin/class-groups/{g['group']['id']}/generate", headers=adm)
    assert again.json()["created"] == 0


async def test_capacity_attendance_and_dropin_charge(client):
    adm = await admin(client)
    coach = await _coach(client, adm)
    g = (await _group(client, adm, coach, capacity=2))["group"]
    gid = g["id"]
    e1 = await client.post(f"/api/admin/class-groups/{gid}/enrollments", json={"client": {"name": "Aluno Um"}}, headers=adm)
    await client.post(f"/api/admin/class-groups/{gid}/enrollments", json={"client": {"name": "Aluno Dois"}}, headers=adm)
    full = await client.post(f"/api/admin/class-groups/{gid}/enrollments", json={"client": {"name": "Aluno Três"}}, headers=adm)
    assert full.status_code == 409 and "cheia" in full.json()["detail"]
    dup = await client.post(f"/api/admin/class-groups/{gid}/enrollments", json={"user_id": e1.json()["user_id"]}, headers=adm)
    assert dup.status_code == 409
    # pausar libera vaga; reativar com a turma cheia é barrado pelo banco
    assert (await client.put(f"/api/admin/enrollments/{e1.json()['id']}", json={"status": "paused"}, headers=adm)).status_code == 200
    assert (await client.post(f"/api/admin/class-groups/{gid}/enrollments", json={"client": {"name": "Aluno Três"}}, headers=adm)).status_code == 201
    assert (await client.put(f"/api/admin/enrollments/{e1.json()['id']}", json={"status": "active"}, headers=adm)).status_code == 409

    sess = (await client.get(f"/api/admin/class-sessions?group_id={gid}&days=31", headers=adm)).json()
    future = sess[0]["id"]
    early = await client.post(f"/api/admin/class-sessions/{future}/attendance", json={"user_id": e1.json()["user_id"], "status": "present"}, headers=adm)
    assert early.status_code == 409 and "ainda não começou" in early.json()["detail"]
    # falta justificada antecipada é permitida
    assert (await client.post(f"/api/admin/class-sessions/{future}/attendance", json={"user_id": e1.json()["user_id"], "status": "justified"}, headers=adm)).status_code == 200
    async with db.pool().acquire() as conn:  # aula da turma começando em 20 min, para a chamada de verdade
        s0 = now_local().replace(second=0, microsecond=0) + timedelta(minutes=20)
        sid = await conn.fetchval(
            """INSERT INTO class_sessions (group_id, coach_id, court_id, period) VALUES ($1, $2, 1, tstzrange($3, $4, '[)')) RETURNING id""",
            gid, coach, s0, s0 + timedelta(minutes=60))
    det = (await client.get(f"/api/admin/class-sessions/{sid}", headers=adm)).json()
    assert len(det["roster"]) == 2
    uid = det["roster"][0]["user_id"]
    det = (await client.post(f"/api/admin/class-sessions/{sid}/attendance", json={"user_id": uid, "status": "present"}, headers=adm)).json()
    assert det["present"] == 1 and det["started_at"]
    # avulso: entra presente e gera a cobrança da aula avulsa uma vez
    det = (await client.post(f"/api/admin/class-sessions/{sid}/students", json={"client": {"name": "Visitante"}}, headers=adm)).json()
    vis = next(r for r in det["roster"] if r["name"] == "Visitante")
    assert vis["dropin"] and vis["status"] == "present" and vis["open_cents"] == 6000
    await client.post(f"/api/admin/class-sessions/{sid}/attendance", json={"user_id": vis["user_id"], "status": "present"}, headers=adm)
    async with db.pool().acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM student_charges WHERE user_id = $1 AND kind = 'dropin'", vis["user_id"]) == 1


async def test_monthly_charges_cash_and_closing(client):
    adm = await admin(client)
    coach = await _coach(client, adm)
    gid = (await _group(client, adm, coach))["group"]["id"]
    for n in ("Ana Aluna", "Beto Aluno"):
        await client.post(f"/api/admin/class-groups/{gid}/enrollments", json={"client": {"name": n}}, headers=adm)
    month = now_local().date().replace(day=1).isoformat()
    assert (await client.post("/api/admin/charges/generate", json={"month": month}, headers=adm)).json()["created"] == 2
    assert (await client.post("/api/admin/charges/generate", json={"month": month}, headers=adm)).json()["created"] == 0
    ch = (await client.get(f"/api/admin/charges?month={month}", headers=adm)).json()
    assert ch["open_cents"] == 50000 and ch["items"][0]["description"].startswith("Mensalidade Iniciantes")
    c1, c2 = ch["items"][0]["id"], ch["items"][1]["id"]
    assert (await client.post(f"/api/admin/charges/{c1}/receive", json={"channel": "pix_balcao"}, headers=adm)).status_code == 200
    assert (await client.post(f"/api/admin/charges/{c1}/receive", json={"channel": "pix_balcao"}, headers=adm)).status_code == 409
    # entra no caixa e no movimento de pagamentos
    today = now_local().date().isoformat()
    sm = (await client.get(f"/api/admin/closings/{today}", headers=adm)).json()["summary"]
    assert sm["by_channel"]["pix_balcao"]["received_cents"] == 25000
    pay = (await client.get("/api/admin/payments", headers=adm)).json()
    assert any(i["code"] == "Aulas" and i["amount_cents"] == 25000 for i in pay["items"])
    # caixa fechado barra o próximo recebimento de balcão
    await client.post(f"/api/admin/closings/{today}", json={"cash_counted_cents": 0}, headers=adm)
    late = await client.post(f"/api/admin/charges/{c2}/receive", json={"channel": "dinheiro"}, headers=adm)
    assert late.status_code == 409 and "fechado" in late.json()["detail"]
    summ = (await client.get("/api/admin/classes/summary", headers=adm)).json()
    assert summ["paid_cents"] == 25000 and summ["open_cents"] == 25000 and summ["students"] == 2


async def test_student_qr_checkin_and_private_class(client):
    adm = await admin(client)
    ana = await make_user(client)
    coach = await _coach(client, adm)
    async with db.pool().acquire() as conn:
        uid = await conn.fetchval("SELECT id FROM users WHERE email = 'ana@ex.com'")
        token = await conn.fetchval("SELECT checkin_token::text FROM users WHERE id = $1", uid)
        s = now_local().replace(second=0, microsecond=0) + timedelta(minutes=20)
        sid = await conn.fetchval(
            "INSERT INTO class_sessions (coach_id, court_id, period, title) VALUES ($1, 3, tstzrange($2, $3, '[)'), 'Aula teste') RETURNING id",
            coach, s, s + timedelta(minutes=60))
    # sem vínculo com a aula: não faz check-in
    r = await client.post("/api/admin/classes/checkin", json={"token": token}, headers=adm)
    assert r.status_code == 409 and "não tem aula agora" in r.json()["detail"]
    async with db.pool().acquire() as conn:
        await conn.execute("INSERT INTO attendance (session_id, user_id, status, dropin) VALUES ($1, $2, 'absent', true)", sid, uid)
    r = await client.post("/api/admin/classes/checkin", json={"token": token}, headers=adm)
    assert r.status_code == 200 and r.json()["session"]["name"] == "Aula teste" and r.json()["already"] is False
    assert (await client.post("/api/admin/classes/checkin", json={"token": token}, headers=adm)).json()["already"] is True
    assert (await client.post("/api/admin/classes/checkin", json={"token": "0" * 36}, headers=adm)).status_code == 404

    # aula particular com cobrança; cancelar cancela a cobrança e avisa
    d = next_weekday(4)
    p = await client.post("/api/admin/class-sessions", json={"coach_id": coach, "court_id": 1, "date": d.isoformat(), "start": "15:00",
                                                           "user_ids": [uid], "price_cents": 12000}, headers=adm)
    assert p.status_code == 201, p.text
    clash = await client.post("/api/admin/class-sessions", json={"coach_id": coach, "court_id": 1, "date": d.isoformat(), "start": "15:30"}, headers=adm)
    assert clash.status_code == 409 and "outra aula" in clash.json()["detail"]
    mine = (await client.get("/api/me/classes", headers=ana)).json()
    assert mine["checkin_token"] == token and any(u["id"] == p.json()["id"] for u in mine["upcoming"])
    assert mine["open_charges"][0]["amount_cents"] == 12000
    c = await client.post(f"/api/admin/class-sessions/{p.json()['id']}/cancel", json={"reason": "Professor doente"}, headers=adm)
    assert c.json()["status"] == "cancelled"
    assert (await client.get("/api/me/classes", headers=ana)).json()["open_charges"] == []
    notes = (await client.get("/api/notifications", headers=ana)).json()["items"]
    assert any(n["title"] == "Aula cancelada" for n in notes)


async def test_group_schedule_change_regenerates(client):
    adm = await admin(client)
    coach = await _coach(client, adm)
    g = (await _group(client, adm, coach, wd=2, starts="19:00"))["group"]
    payload = {"name": g["name"], "coach_id": coach, "court_id": 2, "weekdays": [4], "starts": "18:00", "duration_min": 60, "capacity": 4,
               "monthly_price_cents": 25000, "dropin_price_cents": 6000}
    r = await client.put(f"/api/admin/class-groups/{g['id']}", json=payload, headers=adm)
    assert r.status_code == 200 and r.json()["removed"] >= 3 and r.json()["generation"]["created"] >= 3
    sess = (await client.get(f"/api/admin/class-sessions?group_id={g['id']}&days=35", headers=adm)).json()
    from datetime import datetime
    assert all(datetime.fromisoformat(s["starts_at"]).isoweekday() == 4 for s in sess)
    assert (await client.post(f"/api/admin/class-groups/{g['id']}/close", headers=adm)).status_code == 200
    sess = (await client.get(f"/api/admin/class-sessions?group_id={g['id']}&days=35", headers=adm)).json()
    assert all(s["status"] == "cancelled" for s in sess)


async def test_private_class_with_new_walk_in_student(client):
    adm = await admin(client)
    coach = await _coach(client, adm)
    d = next_weekday(5)
    r = await client.post("/api/admin/class-sessions", json={"coach_id": coach, "court_id": 2, "date": d.isoformat(), "start": "16:00",
                                                           "client": {"name": "Novo Aluno", "phone": "(53) 98888-1111"}, "price_cents": 9000}, headers=adm)
    assert r.status_code == 201, r.text
    det = (await client.get(f"/api/admin/class-sessions/{r.json()['id']}", headers=adm)).json()
    assert [x["name"] for x in det["roster"]] == ["Novo Aluno"] and det["roster"][0]["open_cents"] == 9000


async def test_coach_qr_checkin_starts_class(client):
    adm = await admin(client)
    coach = await _coach(client, adm)
    card = (await client.get(f"/api/admin/coaches/{coach}/card", headers=adm)).json()
    assert len(card["token"]) == 36
    r = await client.post("/api/admin/classes/coach-checkin", json={"token": card["token"]}, headers=adm)
    assert r.status_code == 409 and "não tem aula agora" in r.json()["detail"]
    async with db.pool().acquire() as conn:
        s = now_local().replace(second=0, microsecond=0) + timedelta(minutes=10)
        await conn.execute("INSERT INTO class_sessions (coach_id, court_id, period, title) VALUES ($1, 2, tstzrange($2, $3, '[)'), 'Aula do prof')",
                           coach, s, s + timedelta(minutes=60))
    ok = (await client.post("/api/admin/classes/coach-checkin", json={"token": card["token"]}, headers=adm)).json()
    assert ok["already"] is False and ok["session"]["name"] == "Aula do prof" and ok["session"]["started_at"] and ok["session"]["coach_checked_in_at"]
    assert (await client.post("/api/admin/classes/coach-checkin", json={"token": card["token"]}, headers=adm)).json()["already"] is True
    ana = await make_user(client)
    assert (await client.post("/api/admin/classes/coach-checkin", json={"token": card["token"]}, headers=ana)).status_code == 403
