"""Área do professor: as próprias aulas, chamada, iniciar aula, anotações e alunos. Sem dados financeiros."""

from datetime import date, time, timedelta
from typing import Annotated, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..config import get_settings
from ..deps import Conn, User
from ..domain import local_dt, now_local
from .backoffice import WalkInIn, resolve_client
from .classes import GROUP_SELECT, SESSION_SELECT, _group_out, _mark, _row, _session_detail

router = APIRouter(prefix="/api/coach", tags=["professor"])


async def coach_of(user: User, conn: Conn) -> asyncpg.Record:
    c = await conn.fetchrow("SELECT * FROM coaches WHERE user_id = $1 AND active", user["id"])
    if c is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Área exclusiva de professores.")
    return c


Coach = Annotated[asyncpg.Record, Depends(coach_of)]


async def _own(conn: asyncpg.Connection, coach: asyncpg.Record, session_id: int) -> None:
    if not await conn.fetchval("SELECT 1 FROM class_sessions WHERE id = $1 AND coach_id = $2", session_id, coach["id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aula não encontrada.")


@router.get("/me")
async def me(coach: Coach, conn: Conn):
    today = now_local().date()
    s0, s1 = local_dt(today, time(0)), local_dt(today + timedelta(days=1), time(0))
    m0 = local_dt(today.replace(day=1), time(0))
    today_rows = await conn.fetch(SESSION_SELECT + " WHERE s.coach_id = $1 AND s.period && tstzrange($2, $3) ORDER BY lower(s.period)", coach["id"], s0, s1)
    stats = await conn.fetchrow(
        """SELECT count(*) FILTER (WHERE x.status <> 'cancelled' AND lower(x.period) < now()) AS given,
                  count(*) FILTER (WHERE x.status = 'scheduled' AND lower(x.period) >= now()) AS upcoming,
                  (SELECT count(*) FROM attendance a JOIN class_sessions y ON y.id = a.session_id
                    WHERE y.coach_id = $1 AND lower(y.period) >= $2 AND a.status = 'present') AS presences,
                  (SELECT count(*) FROM attendance a JOIN class_sessions y ON y.id = a.session_id
                    WHERE y.coach_id = $1 AND lower(y.period) >= $2 AND a.status IN ('absent', 'justified')) AS absences
           FROM class_sessions x WHERE x.coach_id = $1 AND lower(x.period) >= $2 AND lower(x.period) < $2 + interval '1 month'""",
        coach["id"], m0)
    marked = stats["presences"] + stats["absences"]
    groups = await conn.fetch(GROUP_SELECT + " WHERE g.coach_id = $1 AND g.active ORDER BY g.name", coach["id"])
    return {
        "coach": {"id": coach["id"], "name": coach["name"], "color": coach["color"], "token": str(coach["checkin_token"])},
        "today": [_row(r) for r in today_rows],
        "stats": {**dict(stats), "attendance_rate": round(stats["presences"] / marked, 4) if marked else None},
        "groups": [_group_out(g) for g in groups],
    }


@router.get("/sessions")
async def sessions(coach: Coach, conn: Conn, start: date | None = None, days: int = Query(7, ge=1, le=31)):
    start = start or now_local().date()
    rows = await conn.fetch(
        SESSION_SELECT + " WHERE s.coach_id = $1 AND s.period && tstzrange($2, $3) ORDER BY lower(s.period)",
        coach["id"], local_dt(start, time(0)), local_dt(start + timedelta(days=days), time(0)))
    return [_row(r) for r in rows]


@router.get("/sessions/{session_id}")
async def session(session_id: int, coach: Coach, conn: Conn):
    await _own(conn, coach, session_id)
    return await _session_detail(conn, session_id, with_money=False)


class AttendanceIn(BaseModel):
    user_id: int
    status: Literal["present", "absent", "justified"]


@router.post("/sessions/{session_id}/attendance")
async def attendance(session_id: int, body: AttendanceIn, coach: Coach, user: User, conn: Conn):
    await _own(conn, coach, session_id)
    await _mark(conn, session_id, body.user_id, body.status, user["id"])
    return await _session_detail(conn, session_id, with_money=False)


class AddStudentIn(BaseModel):
    user_id: int | None = None
    client: WalkInIn | None = None


@router.post("/sessions/{session_id}/students")
async def add_student(session_id: int, body: AddStudentIn, coach: Coach, user: User, conn: Conn):
    await _own(conn, coach, session_id)
    if (body.user_id is None) == (body.client is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha um aluno cadastrado ou informe o nome do aluno novo.")
    async with conn.transaction():
        u = await resolve_client(conn, body.user_id, body.client)
    await _mark(conn, session_id, u["id"], "present", user["id"])
    return await _session_detail(conn, session_id, with_money=False)


@router.post("/sessions/{session_id}/start")
async def start(session_id: int, coach: Coach, conn: Conn):
    """Professor inicia a aula pelo celular (mesmo efeito do QR na recepção): de 1 h antes até o fim."""
    await _own(conn, coach, session_id)
    s = await conn.fetchrow("SELECT period, status FROM class_sessions WHERE id = $1", session_id)
    if s["status"] == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa aula foi cancelada.")
    opens = s["period"].lower - timedelta(minutes=60)
    if not (opens <= now_local() <= s["period"].upper):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A aula pode ser iniciada a partir de {opens.astimezone(get_settings().tz):%d/%m às %H:%M}.")
    await conn.execute(
        """UPDATE class_sessions SET coach_checked_in_at = coalesce(coach_checked_in_at, now()),
               started_at = coalesce(started_at, now()) WHERE id = $1""", session_id)
    return await _session_detail(conn, session_id, with_money=False)


class NotesIn(BaseModel):
    notes: str = Field(max_length=2000)


@router.put("/sessions/{session_id}/notes")
async def notes(session_id: int, body: NotesIn, coach: Coach, conn: Conn):
    await _own(conn, coach, session_id)
    await conn.execute("UPDATE class_sessions SET notes = nullif(trim($2), '') WHERE id = $1", session_id, body.notes)
    return await _session_detail(conn, session_id, with_money=False)


@router.get("/students")
async def students(coach: Coach, conn: Conn):
    """Alunos das turmas do professor (e avulsos nas aulas dele nos últimos 60 dias), com frequência."""
    rows = await conn.fetch(
        """
        WITH st AS (
            SELECT e.user_id FROM enrollments e JOIN class_groups g ON g.id = e.group_id WHERE g.coach_id = $1 AND e.status = 'active'
            UNION SELECT a.user_id FROM attendance a JOIN class_sessions s ON s.id = a.session_id
            WHERE s.coach_id = $1 AND lower(s.period) > now() - interval '60 days'
        )
        SELECT u.id, u.name, u.phone, u.level, u.side, u.hand,
               (SELECT string_agg(g.name, ', ' ORDER BY g.name) FROM enrollments e JOIN class_groups g ON g.id = e.group_id
                 WHERE e.user_id = u.id AND e.status = 'active' AND g.coach_id = $1) AS groups,
               (SELECT count(*) FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                 WHERE a.user_id = u.id AND s.coach_id = $1 AND a.status = 'present') AS presences,
               (SELECT count(*) FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                 WHERE a.user_id = u.id AND s.coach_id = $1 AND a.status <> 'present') AS absences,
               (SELECT max(lower(s.period)) FROM attendance a JOIN class_sessions s ON s.id = a.session_id
                 WHERE a.user_id = u.id AND s.coach_id = $1 AND a.status = 'present') AS last_class
        FROM users u JOIN st ON st.user_id = u.id WHERE u.deleted_at IS NULL ORDER BY u.name""", coach["id"])
    return [_row(r) for r in rows]
