"""Rotinas periódicas: expira holds Pix, conclui reservas passadas e envia lembretes."""

import asyncio
import logging
from datetime import date

import asyncpg

from . import db
from .config import get_settings
from .domain import now_local
from .notify import notify, notify_players

log = logging.getLogger("padel.jobs")


async def expire_holds(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch(
        """
        UPDATE reservations SET status = 'expired', payment_status = 'void'
        WHERE status = 'pending' AND hold_expires_at < now()
        RETURNING id, user_id, code
        """
    )
    for r in rows:
        await conn.execute("UPDATE payments SET status = 'void' WHERE reservation_id = $1 AND status = 'pending'", r["id"])
        await notify(conn, r["user_id"], "expired", "Reserva expirada",
                     f"O pagamento da reserva {r['code']} não foi confirmado a tempo e o horário foi liberado.",
                     "/agenda")
    return len(rows)


async def complete_past(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch(
        "UPDATE reservations SET status = 'completed' WHERE status IN ('confirmed', 'checked_in') AND upper(period) < now() RETURNING id"
    )
    return len(rows)


async def send_reminders(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch(
        """
        UPDATE reservations r SET reminder_sent = true
        FROM courts c
        WHERE c.id = r.court_id AND r.status = 'confirmed' AND NOT r.reminder_sent
          AND lower(r.period) BETWEEN now() AND now() + interval '2 hours'
        RETURNING r.id, r.code, c.name AS court, to_char(lower(r.period), 'HH24:MI') AS hhmm
        """
    )
    for r in rows:
        await notify_players(conn, r["id"], "reminder", f"Seu jogo é às {r['hhmm']}",
                             f"{r['court']} · leve o código {r['code']} para o check-in.", "/reservas")
    return len(rows)


async def complete_classes(conn: asyncpg.Connection) -> int:
    return len(await conn.fetch(
        "UPDATE class_sessions SET status = 'done' WHERE status = 'scheduled' AND upper(period) < now() RETURNING id"))


_last_generation: date | None = None


async def roll_class_calendar(conn: asyncpg.Connection) -> int:
    """Uma vez por dia: estende o calendário de cada turma ativa (~4 semanas à frente) e apaga logs vencidos."""
    global _last_generation
    today = now_local().date()
    if _last_generation == today:
        return 0
    from .routers.classes import generate_sessions  # import tardio: evita ciclo jobs → routers
    created = 0
    for g in await conn.fetch("SELECT id FROM class_groups WHERE active"):
        created += (await generate_sessions(conn, g["id"]))["created"]
    # retenção dos logs (LGPD: guardar só o necessário)
    await conn.execute("DELETE FROM page_views WHERE at < now() - interval '180 days'")
    await conn.execute("DELETE FROM access_log WHERE at < now() - interval '365 days'")
    _last_generation = today
    return created


async def run_once(conn: asyncpg.Connection) -> dict:
    async with conn.transaction():
        return {
            "expired": await expire_holds(conn),
            "completed": await complete_past(conn),
            "reminders": await send_reminders(conn),
            "classes_done": await complete_classes(conn),
            "classes_created": await roll_class_calendar(conn),
        }


async def loop() -> None:
    interval = get_settings().jobs_interval_seconds
    while True:
        try:
            async with db.pool().acquire() as conn:
                result = await run_once(conn)
                if any(result.values()):
                    log.info("jobs: %s", result)
        except Exception:  # noqa: BLE001 — o loop nunca pode morrer
            log.exception("falha nas rotinas periódicas")
        await asyncio.sleep(interval)
