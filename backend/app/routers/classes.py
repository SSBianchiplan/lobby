"""Aulas e alunos: professores, turmas recorrentes, aulas (sessões), matrículas, chamada, mensalidades e check-in do aluno."""

from datetime import date, datetime, time, timedelta
from typing import Literal

import asyncpg
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..deps import Admin, Conn, User
from ..domain import day_infos, local_dt, now_local
from ..notify import notify
from .backoffice import Channel, WalkInIn, resolve_client

router = APIRouter(prefix="/api", tags=["aulas"])

Level = Literal["iniciante", "6", "5", "4", "3", "2", "1"]
WD = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
MONTHS = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
GEN_WEEKS = 4  # calendário gerado à frente para cada turma


def _iso(v):
    return v.astimezone(get_settings().tz).isoformat() if isinstance(v, datetime) else (v.isoformat() if isinstance(v, (date, time)) else v)


def _row(r) -> dict:
    return {k: _iso(v) for k, v in dict(r).items()}


def _court_conflict(e: asyncpg.PostgresError) -> HTTPException:
    msg = {
        "class_sessions_no_overlap": "Já existe outra aula nessa quadra e horário.",
        "class_sessions_reserved": "A quadra está reservada nesse horário.",
        "class_sessions_blocked": "Esse horário está bloqueado.",
    }.get(getattr(e, "constraint_name", None), "Conflito de horário na quadra.")
    return HTTPException(status.HTTP_409_CONFLICT, msg)


# ── Professores ─────────────────────────────────────────────────────────────

class CoachIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=120)
    color: str = Field(default="#7C3AED", pattern=r"^#[0-9A-Fa-f]{6}$")
    active: bool = True


@router.get("/admin/coaches")
async def coaches(_: Admin, conn: Conn):
    rows = await conn.fetch(
        """SELECT c.*, (SELECT count(*) FROM class_groups g WHERE g.coach_id = c.id AND g.active) AS groups
           FROM coaches c ORDER BY c.active DESC, c.name""")
    return [_row(r) for r in rows]


@router.post("/admin/coaches", status_code=201)
async def create_coach(body: CoachIn, _: Admin, conn: Conn):
    return _row(await conn.fetchrow(
        "INSERT INTO coaches (name, phone, email, color, active) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        body.name.strip(), body.phone, body.email, body.color, body.active))


@router.put("/admin/coaches/{coach_id}")
async def update_coach(coach_id: int, body: CoachIn, _: Admin, conn: Conn):
    r = await conn.fetchrow(
        "UPDATE coaches SET name = $2, phone = $3, email = $4, color = $5, active = $6 WHERE id = $1 RETURNING *",
        coach_id, body.name.strip(), body.phone, body.email, body.color, body.active)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Professor não encontrado.")
    return _row(r)


# ── Turmas ──────────────────────────────────────────────────────────────────

class GroupIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    coach_id: int
    court_id: int
    weekdays: list[int] = Field(min_length=1, max_length=7)
    starts: time
    duration_min: int = Field(default=60, ge=30, le=180, multiple_of=30)
    level: Level | None = None
    capacity: int = Field(default=4, ge=1, le=12)
    monthly_price_cents: int = Field(default=0, ge=0, le=10_000_00)
    dropin_price_cents: int = Field(default=0, ge=0, le=10_000_00)
    starts_on: date | None = None
    ends_on: date | None = None
    notes: str | None = Field(default=None, max_length=500)


GROUP_SELECT = """
    SELECT g.*, c.name AS coach_name, c.color AS coach_color, ct.name AS court_name,
           (SELECT count(*) FROM enrollments e WHERE e.group_id = g.id AND e.status = 'active') AS enrolled,
           (SELECT min(lower(s.period)) FROM class_sessions s WHERE s.group_id = g.id AND s.status = 'scheduled' AND lower(s.period) > now()) AS next_session
    FROM class_groups g JOIN coaches c ON c.id = g.coach_id JOIN courts ct ON ct.id = g.court_id
"""


def _group_out(r) -> dict:
    d = _row(r)
    d["schedule"] = f"{' e '.join(WD[w] for w in sorted(r['weekdays']))} · {r['starts']:%H:%M} ({r['duration_min']} min)"
    return d


async def generate_sessions(conn: asyncpg.Connection, group_id: int, weeks: int = GEN_WEEKS) -> dict:
    """Cria as aulas da turma nas próximas `weeks` semanas. Pula dias fechados/fora do horário e conflitos
    de quadra (que são relatados); não recria aula já existente ou cancelada no mesmo horário."""
    g = await conn.fetchrow("SELECT * FROM class_groups WHERE id = $1", group_id)
    if g is None or not g["active"]:
        return {"created": 0, "skipped": []}
    now = now_local()
    start = max(now.date(), g["starts_on"])
    end = now.date() + timedelta(days=7 * weeks)
    if g["ends_on"]:
        end = min(end, g["ends_on"] + timedelta(days=1))
    created, skipped = 0, []
    if end <= start:
        return {"created": 0, "skipped": []}
    for info in await day_infos(conn, start, (end - start).days):
        if info.day.isoweekday() not in g["weekdays"]:
            continue
        s = local_dt(info.day, g["starts"])
        if s <= now:
            continue
        if not info.open or not info.fits(g["starts"], g["duration_min"]):
            skipped.append({"date": info.day.isoformat(), "reason": info.holiday or "Clube fechado ou fora do horário"})
            continue
        try:
            async with conn.transaction():
                r = await conn.execute(
                    """INSERT INTO class_sessions (group_id, coach_id, court_id, period)
                       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'))
                       ON CONFLICT (group_id, lower(period)) WHERE group_id IS NOT NULL DO NOTHING""",
                    g["id"], g["coach_id"], g["court_id"], s, s + timedelta(minutes=g["duration_min"]))
                created += r == "INSERT 0 1"
        except asyncpg.ExclusionViolationError as e:
            skipped.append({"date": info.day.isoformat(), "reason": _court_conflict(e).detail})
    return {"created": created, "skipped": skipped}


async def _validate_group(conn: asyncpg.Connection, body: GroupIn) -> None:
    if any(w < 1 or w > 7 for w in body.weekdays):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Dias da semana inválidos.")
    if not await conn.fetchval("SELECT 1 FROM coaches WHERE id = $1 AND active", body.coach_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Professor inválido ou inativo.")
    if not await conn.fetchval("SELECT 1 FROM courts WHERE id = $1 AND active", body.court_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Quadra inválida.")


@router.get("/admin/class-groups")
async def groups(_: Admin, conn: Conn, active: bool | None = True):
    rows = await conn.fetch(GROUP_SELECT + " WHERE ($1::boolean IS NULL OR g.active = $1) ORDER BY g.active DESC, g.name", active)
    return [_group_out(r) for r in rows]


@router.post("/admin/class-groups", status_code=201)
async def create_group(body: GroupIn, _: Admin, conn: Conn):
    await _validate_group(conn, body)
    async with conn.transaction():
        gid = await conn.fetchval(
            """INSERT INTO class_groups (name, coach_id, court_id, weekdays, starts, duration_min, level, capacity,
                                         monthly_price_cents, dropin_price_cents, starts_on, ends_on, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11, current_date),$12,$13) RETURNING id""",
            body.name.strip(), body.coach_id, body.court_id, sorted(set(body.weekdays)), body.starts, body.duration_min,
            body.level, body.capacity, body.monthly_price_cents, body.dropin_price_cents, body.starts_on, body.ends_on, body.notes)
        gen = await generate_sessions(conn, gid)
    return {"group": _group_out(await conn.fetchrow(GROUP_SELECT + " WHERE g.id = $1", gid)), "generation": gen}


@router.put("/admin/class-groups/{group_id}")
async def update_group(group_id: int, body: GroupIn, _: Admin, conn: Conn):
    """Mudar horário, dias, quadra ou professor refaz as aulas futuras ainda sem chamada."""
    await _validate_group(conn, body)
    async with conn.transaction():
        old = await conn.fetchrow("SELECT * FROM class_groups WHERE id = $1 FOR UPDATE", group_id)
        if old is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Turma não encontrada.")
        try:
            await conn.execute(
                """UPDATE class_groups SET name=$2, coach_id=$3, court_id=$4, weekdays=$5, starts=$6, duration_min=$7, level=$8,
                       capacity=$9, monthly_price_cents=$10, dropin_price_cents=$11, starts_on=coalesce($12, starts_on), ends_on=$13, notes=$14
                   WHERE id = $1""",
                group_id, body.name.strip(), body.coach_id, body.court_id, sorted(set(body.weekdays)), body.starts, body.duration_min,
                body.level, body.capacity, body.monthly_price_cents, body.dropin_price_cents, body.starts_on, body.ends_on, body.notes)
        except asyncpg.CheckViolationError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Dados da turma inválidos.")
        if await conn.fetchval("SELECT count(*) FROM enrollments WHERE group_id = $1 AND status = 'active'", group_id) > body.capacity:
            raise HTTPException(status.HTTP_409_CONFLICT, "A turma tem mais alunos ativos do que a nova capacidade.")
        schedule_changed = (old["coach_id"], old["court_id"], sorted(old["weekdays"]), old["starts"], old["duration_min"], old["ends_on"]) != \
            (body.coach_id, body.court_id, sorted(set(body.weekdays)), body.starts, body.duration_min, body.ends_on)
        removed = 0
        if schedule_changed:
            removed = int((await conn.execute(
                """DELETE FROM class_sessions s WHERE s.group_id = $1 AND s.status = 'scheduled' AND lower(s.period) > now()
                     AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id)""", group_id)).split()[-1])
        gen = await generate_sessions(conn, group_id)
    return {"group": _group_out(await conn.fetchrow(GROUP_SELECT + " WHERE g.id = $1", group_id)), "generation": gen, "removed": removed}


@router.post("/admin/class-groups/{group_id}/generate")
async def regenerate(group_id: int, _: Admin, conn: Conn, weeks: int = Query(GEN_WEEKS, ge=1, le=26)):
    async with conn.transaction():
        return await generate_sessions(conn, group_id, weeks)


@router.post("/admin/class-groups/{group_id}/close")
async def close_group(group_id: int, _: Admin, conn: Conn):
    """Encerra a turma: aulas futuras canceladas, matrículas encerradas (histórico fica)."""
    async with conn.transaction():
        if await conn.execute("UPDATE class_groups SET active = false, ends_on = current_date WHERE id = $1", group_id) == "UPDATE 0":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Turma não encontrada.")
        await conn.execute("""UPDATE class_sessions SET status = 'cancelled', cancel_reason = 'Turma encerrada'
                              WHERE group_id = $1 AND status = 'scheduled' AND lower(period) > now()""", group_id)
        await conn.execute("UPDATE enrollments SET status = 'cancelled', ended_on = current_date WHERE group_id = $1 AND status <> 'cancelled'", group_id)
    return {"ok": True}


# ── Matrículas e alunos ─────────────────────────────────────────────────────

class EnrollIn(BaseModel):
    user_id: int | None = None
    client: WalkInIn | None = None


@router.get("/admin/class-groups/{group_id}/enrollments")
async def group_enrollments(group_id: int, _: Admin, conn: Conn):
    rows = await conn.fetch(
        """SELECT e.id, e.status, e.started_on, u.id AS user_id, u.name, u.phone, u.email::text AS email, u.level,
                  (SELECT count(*) FILTER (WHERE a.status = 'present') FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                    WHERE a.user_id = u.id AND s.group_id = e.group_id) AS presences,
                  (SELECT coalesce(sum(amount_cents), 0) FROM student_charges c WHERE c.user_id = u.id AND c.status = 'open') AS open_cents
           FROM enrollments e JOIN users u ON u.id = e.user_id
           WHERE e.group_id = $1 AND e.status <> 'cancelled' ORDER BY e.status, u.name""", group_id)
    return [_row(r) for r in rows]


@router.post("/admin/class-groups/{group_id}/enrollments", status_code=201)
async def enroll(group_id: int, body: EnrollIn, _: Admin, conn: Conn):
    if (body.user_id is None) == (body.client is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha um aluno cadastrado ou informe o nome do aluno novo.")
    g = await conn.fetchrow("SELECT id, name, active FROM class_groups WHERE id = $1", group_id)
    if g is None or not g["active"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Turma não encontrada ou encerrada.")
    try:
        async with conn.transaction():
            u = await resolve_client(conn, body.user_id, body.client)
            eid = await conn.fetchval("INSERT INTO enrollments (group_id, user_id) VALUES ($1, $2) RETURNING id", group_id, u["id"])
            await notify(conn, u["id"], "class", "Matrícula confirmada", f"Você está na turma {g['name']}.", "/perfil#aulas")
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Esse aluno já está nessa turma.")
    except asyncpg.CheckViolationError as e:
        if e.constraint_name == "enrollments_capacity":
            raise HTTPException(status.HTTP_409_CONFLICT, "Turma cheia.")
        raise
    return {"id": eid, "user_id": u["id"], "name": u["name"]}


class EnrollmentStatusIn(BaseModel):
    status: Literal["active", "paused", "cancelled"]


@router.put("/admin/enrollments/{enrollment_id}")
async def set_enrollment(enrollment_id: int, body: EnrollmentStatusIn, _: Admin, conn: Conn):
    try:
        r = await conn.execute(
            "UPDATE enrollments SET status = $2, ended_on = CASE WHEN $2 = 'cancelled' THEN current_date END WHERE id = $1",
            enrollment_id, body.status)
    except asyncpg.CheckViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Turma cheia: não dá para reativar essa matrícula.")
    if r == "UPDATE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Matrícula não encontrada.")
    return {"ok": True}


@router.get("/admin/students")
async def students(_: Admin, conn: Conn, q: str = ""):
    """Quem tem matrícula (ativa ou pausada) ou aula nos últimos 90 dias, com frequência e mensalidades em aberto."""
    rows = await conn.fetch(
        """
        WITH st AS (
            SELECT DISTINCT user_id FROM enrollments WHERE status <> 'cancelled'
            UNION SELECT a.user_id FROM attendance a JOIN class_sessions s ON s.id = a.session_id WHERE lower(s.period) > now() - interval '90 days'
        )
        SELECT u.id, u.name, u.phone, u.email::text AS email, u.level,
               (SELECT string_agg(g.name, ', ' ORDER BY g.name) FROM enrollments e JOIN class_groups g ON g.id = e.group_id
                 WHERE e.user_id = u.id AND e.status = 'active') AS groups,
               (SELECT count(*) FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                 WHERE a.user_id = u.id AND a.status = 'present' AND lower(s.period) > now() - interval '30 days') AS present_30d,
               (SELECT count(*) FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                 WHERE a.user_id = u.id AND a.status = 'absent' AND lower(s.period) > now() - interval '30 days') AS absent_30d,
               (SELECT coalesce(sum(amount_cents), 0) FROM student_charges c WHERE c.user_id = u.id AND c.status = 'open') AS open_cents
        FROM users u JOIN st ON st.user_id = u.id
        WHERE u.deleted_at IS NULL AND ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%' OR coalesce(u.phone, '') ILIKE '%' || $1 || '%')
        ORDER BY u.name""", q.strip())
    return [_row(r) for r in rows]


# ── Aulas (sessões) e chamada ───────────────────────────────────────────────

SESSION_SELECT = """
    SELECT s.id, s.group_id, s.coach_id, s.court_id, lower(s.period) AS starts_at, upper(s.period) AS ends_at, s.status, s.title,
           s.cancel_reason, s.started_at, s.coach_checked_in_at, coalesce(s.title, g.name, 'Aula particular') AS name, g.level, g.capacity,
           c.name AS coach_name, c.color AS coach_color, ct.name AS court_name,
           (SELECT count(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'present') AS present,
           CASE WHEN s.group_id IS NULL THEN (SELECT count(*) FROM attendance a WHERE a.session_id = s.id)
                ELSE (SELECT count(*) FROM enrollments e WHERE e.group_id = s.group_id AND e.status = 'active') END AS expected
    FROM class_sessions s JOIN coaches c ON c.id = s.coach_id JOIN courts ct ON ct.id = s.court_id
    LEFT JOIN class_groups g ON g.id = s.group_id
"""


@router.get("/admin/class-sessions")
async def sessions(_: Admin, conn: Conn, start: date | None = None, days: int = Query(7, ge=1, le=62),
                   coach_id: int | None = None, group_id: int | None = None):
    start = start or now_local().date()
    s, e = local_dt(start, time(0)), local_dt(start + timedelta(days=days), time(0))
    rows = await conn.fetch(
        SESSION_SELECT + """ WHERE s.period && tstzrange($1, $2) AND ($3::bigint IS NULL OR s.coach_id = $3)
                             AND ($4::bigint IS NULL OR s.group_id = $4) ORDER BY lower(s.period), ct.number""",
        s, e, coach_id, group_id)
    return [_row(r) for r in rows]


class PrivateIn(BaseModel):
    coach_id: int
    court_id: int
    date: date
    start: time
    duration_min: int = Field(default=60, ge=30, le=180, multiple_of=30)
    title: str | None = Field(default=None, max_length=80)
    user_ids: list[int] = Field(default_factory=list, max_length=8)
    client: WalkInIn | None = None                           # aluno novo (balcão), além dos user_ids
    price_cents: int = Field(default=0, ge=0, le=10_000_00)  # por aluno


@router.post("/admin/class-sessions", status_code=201)
async def create_private(body: PrivateIn, admin: Admin, conn: Conn):
    """Aula particular/avulsa: ocupa a quadra, já entra com os alunos na chamada e gera a cobrança de cada um."""
    s = local_dt(body.date, body.start)
    if s <= now_local():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Esse horário já passou.")
    info = (await day_infos(conn, body.date, 1))[0]
    if not info.open or not info.fits(body.start, body.duration_min):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fora do horário de funcionamento do clube.")
    try:
        async with conn.transaction():
            sid = await conn.fetchval(
                "INSERT INTO class_sessions (coach_id, court_id, period, title) VALUES ($1, $2, tstzrange($3, $4, '[)'), $5) RETURNING id",
                body.coach_id, body.court_id, s, s + timedelta(minutes=body.duration_min), body.title or "Aula particular")
            uids = list(body.user_ids)
            if body.client is not None:
                uids.append((await resolve_client(conn, None, body.client))["id"])
            for uid in dict.fromkeys(uids):
                await conn.execute(
                    "INSERT INTO attendance (session_id, user_id, status, dropin, marked_by) VALUES ($1, $2, 'absent', true, $3)",
                    sid, uid, admin["id"])
                if body.price_cents:
                    await conn.execute(
                        """INSERT INTO student_charges (user_id, kind, session_id, description, amount_cents)
                           VALUES ($1, 'private', $2, $3, $4)""",
                        uid, sid, f"{body.title or 'Aula particular'} · {body.date:%d/%m} {body.start:%H:%M}", body.price_cents)
                await notify(conn, uid, "class", "Aula agendada", f"{body.title or 'Aula particular'} · {body.date:%d/%m} às {body.start:%H:%M}", "/perfil#aulas")
    except asyncpg.ExclusionViolationError as e:
        raise _court_conflict(e)
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Professor, quadra ou aluno inválido.")
    return _row(await conn.fetchrow(SESSION_SELECT + " WHERE s.id = $1", sid))


@router.get("/admin/class-sessions/{session_id}")
async def session_detail(session_id: int, _: Admin, conn: Conn):
    s = await conn.fetchrow(SESSION_SELECT + " WHERE s.id = $1", session_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aula não encontrada.")
    # matriculados ativos (no dia da aula) + avulsos com chamada
    roster = await conn.fetch(
        """
        SELECT u.id AS user_id, u.name, u.phone, u.level, a.status, a.dropin, a.checked_in_at,
               (SELECT coalesce(sum(amount_cents), 0) FROM student_charges c WHERE c.user_id = u.id AND c.status = 'open') AS open_cents
        FROM (
            SELECT e.user_id FROM enrollments e JOIN class_sessions s ON s.group_id = e.group_id
            WHERE s.id = $1 AND (e.status = 'active' OR EXISTS (SELECT 1 FROM attendance a2 WHERE a2.session_id = $1 AND a2.user_id = e.user_id))
            UNION SELECT user_id FROM attendance WHERE session_id = $1
        ) r JOIN users u ON u.id = r.user_id
        LEFT JOIN attendance a ON a.session_id = $1 AND a.user_id = u.id
        ORDER BY a.dropin NULLS FIRST, u.name""", session_id)
    return {**_row(s), "roster": [_row(r) for r in roster]}


class AttendanceIn(BaseModel):
    user_id: int
    status: Literal["present", "absent", "justified"]


async def _mark(conn: asyncpg.Connection, session_id: int, user_id: int, st: str, admin_id: int | None, checkin: bool = False) -> dict:
    s = await conn.fetchrow("SELECT s.*, g.dropin_price_cents, g.name AS group_name FROM class_sessions s LEFT JOIN class_groups g ON g.id = s.group_id WHERE s.id = $1", session_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aula não encontrada.")
    if s["status"] == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa aula foi cancelada.")
    opens = s["period"].lower - timedelta(minutes=60)
    if st == "present" and now_local() < opens:
        # falta/justificada podem ser lançadas antes (aviso do aluno); presença só quando a aula está para começar
        raise HTTPException(status.HTTP_409_CONFLICT, f"A aula ainda não começou: presença a partir de {opens.astimezone(get_settings().tz):%d/%m às %H:%M}.")
    enrolled = s["group_id"] is not None and await conn.fetchval(
        "SELECT 1 FROM enrollments WHERE group_id = $1 AND user_id = $2 AND status = 'active'", s["group_id"], user_id)
    async with conn.transaction():
        prev = await conn.fetchrow("SELECT id, dropin FROM attendance WHERE session_id = $1 AND user_id = $2", session_id, user_id)
        dropin = prev["dropin"] if prev else not enrolled
        await conn.execute(
            """INSERT INTO attendance (session_id, user_id, status, dropin, marked_by, checked_in_at)
               VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)
               ON CONFLICT (session_id, user_id) DO UPDATE SET status = $3, marked_by = $5, updated_at = now(),
                   checked_in_at = CASE WHEN $6 THEN coalesce(attendance.checked_in_at, now()) ELSE attendance.checked_in_at END""",
            session_id, user_id, st, dropin, admin_id, checkin)
        # avulso numa turma: cobra a aula avulsa uma vez
        if not prev and dropin and s["group_id"] and s["dropin_price_cents"] and st == "present":
            lt = s["period"].lower.astimezone(get_settings().tz)
            await conn.execute(
                """INSERT INTO student_charges (user_id, group_id, kind, session_id, description, amount_cents)
                   VALUES ($1, $2, 'dropin', $3, $4, $5)""",
                user_id, s["group_id"], session_id, f"Aula avulsa · {s['group_name']} · {lt:%d/%m %H:%M}", s["dropin_price_cents"])
        if st == "present":
            await conn.execute("UPDATE class_sessions SET started_at = coalesce(started_at, now()) WHERE id = $1", session_id)
    return {"dropin": dropin}


@router.post("/admin/class-sessions/{session_id}/attendance")
async def mark_attendance(session_id: int, body: AttendanceIn, admin: Admin, conn: Conn):
    await _mark(conn, session_id, body.user_id, body.status, admin["id"])
    return await session_detail(session_id, admin, conn)


class AddStudentIn(BaseModel):
    user_id: int | None = None
    client: WalkInIn | None = None


@router.post("/admin/class-sessions/{session_id}/students")
async def add_session_student(session_id: int, body: AddStudentIn, admin: Admin, conn: Conn):
    """Aluno avulso nessa aula (ou incluído numa aula particular). Entra como presente."""
    if (body.user_id is None) == (body.client is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha um aluno cadastrado ou informe o nome do aluno novo.")
    async with conn.transaction():
        u = await resolve_client(conn, body.user_id, body.client)
    await _mark(conn, session_id, u["id"], "present", admin["id"])
    return await session_detail(session_id, admin, conn)


class CancelSessionIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


@router.post("/admin/class-sessions/{session_id}/cancel")
async def cancel_session(session_id: int, body: CancelSessionIn, admin: Admin, conn: Conn):
    async with conn.transaction():
        s = await conn.fetchrow(SESSION_SELECT + " WHERE s.id = $1 FOR UPDATE OF s", session_id)
        if s is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Aula não encontrada.")
        if s["status"] != "scheduled":
            raise HTTPException(status.HTTP_409_CONFLICT, "Só aulas agendadas podem ser canceladas.")
        await conn.execute("UPDATE class_sessions SET status = 'cancelled', cancel_reason = $2 WHERE id = $1", session_id, body.reason)
        await conn.execute("UPDATE student_charges SET status = 'cancelled' WHERE session_id = $1 AND kind = 'private' AND status = 'open'", session_id)
        lt = s["starts_at"].astimezone(get_settings().tz)
        for r in await conn.fetch(
                """SELECT user_id FROM enrollments WHERE group_id = $1 AND status = 'active'
                   UNION SELECT user_id FROM attendance WHERE session_id = $2""", s["group_id"], session_id):
            await notify(conn, r["user_id"], "class", "Aula cancelada", f"{s['name']} · {lt:%d/%m %H:%M} · {body.reason}", "/perfil#aulas")
    return await session_detail(session_id, admin, conn)


# ── Check-in do aluno pelo QR pessoal (leitor da recepção) ──────────────────

class StudentCheckinIn(BaseModel):
    token: str = Field(min_length=32, max_length=40)


@router.post("/admin/classes/checkin")
async def student_checkin(body: StudentCheckinIn, admin: Admin, conn: Conn):
    try:
        u = await conn.fetchrow("SELECT id, name FROM users WHERE checkin_token = $1::uuid AND deleted_at IS NULL", body.token)
    except (asyncpg.DataError, asyncpg.InvalidTextRepresentationError):
        u = None
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR de aluno não reconhecido.")
    # aula de agora: de 1 h antes do início até o fim, numa turma do aluno ou com ele na chamada
    s = await conn.fetchrow(
        SESSION_SELECT + """ WHERE s.status <> 'cancelled' AND now() BETWEEN lower(s.period) - interval '60 minutes' AND upper(s.period)
             AND (EXISTS (SELECT 1 FROM enrollments e WHERE e.group_id = s.group_id AND e.user_id = $1 AND e.status = 'active')
                  OR EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.user_id = $1))
           ORDER BY abs(extract(epoch FROM lower(s.period) - now())) LIMIT 1""", u["id"])
    if s is None:
        nxt = await conn.fetchval(
            """SELECT min(lower(s.period)) FROM class_sessions s WHERE s.status = 'scheduled' AND lower(s.period) > now()
               AND (EXISTS (SELECT 1 FROM enrollments e WHERE e.group_id = s.group_id AND e.user_id = $1 AND e.status = 'active')
                    OR EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.user_id = $1))""", u["id"])
        when = f" Próxima: {nxt.astimezone(get_settings().tz):%d/%m às %H:%M}." if nxt else ""
        raise HTTPException(status.HTTP_409_CONFLICT, f"{u['name']} não tem aula agora.{when}")
    already = await conn.fetchval("SELECT status = 'present' FROM attendance WHERE session_id = $1 AND user_id = $2", s["id"], u["id"])
    await _mark(conn, s["id"], u["id"], "present", admin["id"], checkin=True)
    open_cents = await conn.fetchval("SELECT coalesce(sum(amount_cents), 0) FROM student_charges WHERE user_id = $1 AND status = 'open'", u["id"])
    return {"user": {"id": u["id"], "name": u["name"]}, "session": _row(await conn.fetchrow(SESSION_SELECT + " WHERE s.id = $1", s["id"])),
            "already": bool(already), "open_cents": open_cents}


class CoachCheckinIn(BaseModel):
    token: str = Field(min_length=32, max_length=40)


@router.post("/admin/classes/coach-checkin")
async def coach_checkin(body: CoachCheckinIn, _: Admin, conn: Conn):
    """QR do professor: registra a chegada e inicia a aula dele de agora (de 1 h antes até o fim)."""
    try:
        c = await conn.fetchrow("SELECT id, name FROM coaches WHERE checkin_token = $1::uuid AND active", body.token)
    except (asyncpg.DataError, asyncpg.InvalidTextRepresentationError):
        c = None
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR de professor não reconhecido.")
    s = await conn.fetchrow(
        SESSION_SELECT + """ WHERE s.coach_id = $1 AND s.status <> 'cancelled'
             AND now() BETWEEN lower(s.period) - interval '60 minutes' AND upper(s.period)
           ORDER BY abs(extract(epoch FROM lower(s.period) - now())) LIMIT 1""", c["id"])
    if s is None:
        nxt = await conn.fetchval(
            "SELECT min(lower(period)) FROM class_sessions WHERE coach_id = $1 AND status = 'scheduled' AND lower(period) > now()", c["id"])
        when = f" Próxima: {nxt.astimezone(get_settings().tz):%d/%m às %H:%M}." if nxt else ""
        raise HTTPException(status.HTTP_409_CONFLICT, f"{c['name']} não tem aula agora.{when}")
    already = s["coach_checked_in_at"] is not None
    await conn.execute(
        """UPDATE class_sessions SET coach_checked_in_at = coalesce(coach_checked_in_at, now()),
               started_at = coalesce(started_at, now()) WHERE id = $1""", s["id"])
    return {"coach": {"id": c["id"], "name": c["name"]}, "already": already,
            "session": _row(await conn.fetchrow(SESSION_SELECT + " WHERE s.id = $1", s["id"]))}


@router.get("/admin/coaches/{coach_id}/card")
async def coach_card(coach_id: int, _: Admin, conn: Conn):
    """Dados da carteirinha do professor (QR de check-in + turmas)."""
    c = await conn.fetchrow("SELECT id, name, phone, color, checkin_token::text AS token FROM coaches WHERE id = $1", coach_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Professor não encontrado.")
    gs = await conn.fetch(GROUP_SELECT + " WHERE g.coach_id = $1 AND g.active ORDER BY g.name", coach_id)
    return {**dict(c), "groups": [_group_out(g) for g in gs]}


# ── Mensalidades e cobranças ────────────────────────────────────────────────

class GenerateChargesIn(BaseModel):
    month: date


@router.post("/admin/charges/generate")
async def generate_charges(body: GenerateChargesIn, _: Admin, conn: Conn):
    """Uma mensalidade por matrícula ativa (turmas com mensalidade > 0). Rodar de novo não duplica."""
    m = body.month.replace(day=1)
    r = await conn.execute(
        """INSERT INTO student_charges (user_id, group_id, kind, month, description, amount_cents)
           SELECT e.user_id, g.id, 'monthly', $1, 'Mensalidade ' || g.name || ' · ' || $2, g.monthly_price_cents
           FROM enrollments e JOIN class_groups g ON g.id = e.group_id
           WHERE e.status = 'active' AND g.active AND g.monthly_price_cents > 0
           ON CONFLICT (user_id, group_id, month) WHERE kind = 'monthly' AND status <> 'cancelled' DO NOTHING""",
        m, f"{MONTHS[m.month]}/{m.year}")
    return {"created": int(r.split()[-1]), "month": m.isoformat()}


@router.get("/admin/charges")
async def charges(_: Admin, conn: Conn, month: date | None = None, status_: str | None = Query(None, alias="status"), q: str = ""):
    rows = await conn.fetch(
        """SELECT c.*, u.name AS student, u.phone, g.name AS group_name, p.paid_at, p.channel, a.name AS received_by_name
           FROM student_charges c JOIN users u ON u.id = c.user_id LEFT JOIN class_groups g ON g.id = c.group_id
           LEFT JOIN payments p ON p.charge_id = c.id AND p.status = 'paid' LEFT JOIN users a ON a.id = p.received_by
           WHERE ($1::date IS NULL OR c.month = $1 OR (c.month IS NULL AND date_trunc('month', c.created_at)::date = $1))
             AND ($2::text IS NULL OR c.status = $2)
             AND ($3 = '' OR u.name ILIKE '%' || $3 || '%' OR c.description ILIKE '%' || $3 || '%')
           ORDER BY c.status = 'open' DESC, u.name, c.id""",
        month.replace(day=1) if month else None, status_ or None, q.strip())
    items = [_row(r) for r in rows]
    return {
        "items": items,
        "open_cents": sum(i["amount_cents"] for i in items if i["status"] == "open"),
        "paid_cents": sum(i["amount_cents"] for i in items if i["status"] == "paid"),
    }


class ReceiveChargeIn(BaseModel):
    channel: Channel = "dinheiro"
    note: str | None = Field(default=None, max_length=200)


@router.post("/admin/charges/{charge_id}/receive")
async def receive_charge(charge_id: int, body: ReceiveChargeIn, admin: Admin, conn: Conn):
    """Recebimento no balcão: entra no caixa do dia (e respeita o fechamento)."""
    if body.channel in ("pix_online", "cartao_online"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha como o valor foi recebido no balcão.")
    try:
        async with conn.transaction():
            c = await conn.fetchrow("SELECT * FROM student_charges WHERE id = $1 FOR UPDATE", charge_id)
            if c is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Cobrança não encontrada.")
            if c["status"] != "open":
                raise HTTPException(status.HTTP_409_CONFLICT, "Essa cobrança não está em aberto.")
            await conn.execute(
                """INSERT INTO payments (charge_id, method, channel, amount_cents, status, paid_at, received_by, note)
                   VALUES ($1, 'onsite', $2, $3, 'paid', now(), $4, $5)""",
                charge_id, body.channel, c["amount_cents"], admin["id"], body.note)
            await conn.execute("UPDATE student_charges SET status = 'paid' WHERE id = $1", charge_id)
    except asyncpg.CheckViolationError as e:
        if e.constraint_name == "payments_closed_day":
            raise HTTPException(status.HTTP_409_CONFLICT, "O caixa de hoje já foi fechado. Reabra o fechamento para lançar o recebimento.")
        raise
    return {"ok": True}


@router.post("/admin/charges/{charge_id}/cancel")
async def cancel_charge(charge_id: int, _: Admin, conn: Conn):
    if await conn.execute("UPDATE student_charges SET status = 'cancelled' WHERE id = $1 AND status = 'open'", charge_id) == "UPDATE 0":
        raise HTTPException(status.HTTP_409_CONFLICT, "Só cobranças em aberto podem ser canceladas.")
    return {"ok": True}


# ── Resumo ──────────────────────────────────────────────────────────────────

@router.get("/admin/classes/summary")
async def summary(_: Admin, conn: Conn, start: date | None = None, end: date | None = None):
    today = now_local().date()
    start = start or today.replace(day=1)
    end = end or (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    s, e = local_dt(start, time(0)), local_dt(end, time(0))
    tot = await conn.fetchrow(
        """SELECT count(*) FILTER (WHERE status <> 'cancelled') AS sessions,
                  count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                  (SELECT count(*) FROM attendance a JOIN class_sessions x ON x.id = a.session_id
                    WHERE x.period && tstzrange($1, $2) AND a.status = 'present') AS presences,
                  (SELECT count(*) FROM attendance a JOIN class_sessions x ON x.id = a.session_id
                    WHERE x.period && tstzrange($1, $2) AND a.status IN ('absent', 'justified')) AS absences
           FROM class_sessions WHERE period && tstzrange($1, $2)""", s, e)
    by_coach = await conn.fetch(
        """SELECT c.name, c.color, count(x.id) FILTER (WHERE x.status <> 'cancelled') AS sessions,
                  coalesce(sum(extract(epoch FROM upper(x.period) - lower(x.period)) / 60) FILTER (WHERE x.status <> 'cancelled'), 0)::int AS minutes,
                  (SELECT count(*) FROM attendance a JOIN class_sessions y ON y.id = a.session_id
                    WHERE y.coach_id = c.id AND y.period && tstzrange($1, $2) AND a.status = 'present') AS presences
           FROM coaches c LEFT JOIN class_sessions x ON x.coach_id = c.id AND x.period && tstzrange($1, $2)
           GROUP BY c.id ORDER BY 3 DESC, c.name""", s, e)
    money = await conn.fetchrow(
        """SELECT coalesce(sum(amount_cents) FILTER (WHERE status <> 'cancelled'), 0) AS billed_cents,
                  coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_cents,
                  coalesce(sum(amount_cents) FILTER (WHERE status = 'open'), 0) AS open_cents
           FROM student_charges WHERE (month >= $1 AND month < $2) OR (month IS NULL AND created_at >= $3 AND created_at < $4)""",
        start, end, s, e)
    marked = tot["presences"] + tot["absences"]
    return {
        "start": start.isoformat(), "end": end.isoformat(), **dict(tot), **dict(money),
        "attendance_rate": round(tot["presences"] / marked, 4) if marked else None,
        "students": await conn.fetchval("SELECT count(DISTINCT user_id) FROM enrollments WHERE status = 'active'"),
        "groups": await conn.fetchval("SELECT count(*) FROM class_groups WHERE active"),
        "by_coach": [dict(r) for r in by_coach],
    }


# ── Área do aluno ───────────────────────────────────────────────────────────

@router.get("/me/classes")
async def my_classes(user: User, conn: Conn):
    groups_ = await conn.fetch(
        GROUP_SELECT + " JOIN enrollments e ON e.group_id = g.id AND e.user_id = $1 AND e.status <> 'cancelled' ORDER BY g.name", user["id"])
    upcoming = await conn.fetch(
        SESSION_SELECT + """ WHERE s.status <> 'cancelled' AND upper(s.period) > now()
             AND (EXISTS (SELECT 1 FROM enrollments e WHERE e.group_id = s.group_id AND e.user_id = $1 AND e.status = 'active')
                  OR EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = s.id AND a.user_id = $1))
           ORDER BY lower(s.period) LIMIT 8""", user["id"])
    history = await conn.fetch(
        """SELECT coalesce(s.title, g.name, 'Aula') AS name, lower(s.period) AS starts_at, a.status
           FROM attendance a JOIN class_sessions s ON s.id = a.session_id LEFT JOIN class_groups g ON g.id = s.group_id
           WHERE a.user_id = $1 ORDER BY lower(s.period) DESC LIMIT 12""", user["id"])
    open_charges = await conn.fetch(
        "SELECT id, description, amount_cents, created_at FROM student_charges WHERE user_id = $1 AND status = 'open' ORDER BY created_at", user["id"])
    token = await conn.fetchval("SELECT checkin_token::text FROM users WHERE id = $1", user["id"])
    present = sum(1 for h in history if h["status"] == "present")
    return {
        "groups": [_group_out(g) for g in groups_],
        "upcoming": [_row(r) for r in upcoming],
        "history": [_row(r) for r in history],
        "attendance_rate": round(present / len(history), 4) if history else None,
        "open_charges": [_row(r) for r in open_charges],
        "checkin_token": token,
    }
