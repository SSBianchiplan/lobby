"""Rotinas periódicas: expira holds Pix, conclui reservas passadas e envia lembretes."""

import asyncio
import logging

import asyncpg

from . import db
from .config import get_settings
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


async def run_once(conn: asyncpg.Connection) -> dict:
    async with conn.transaction():
        return {
            "expired": await expire_holds(conn),
            "completed": await complete_past(conn),
            "reminders": await send_reminders(conn),
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
