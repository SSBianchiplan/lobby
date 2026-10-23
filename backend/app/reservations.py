"""Ciclo de vida da reserva: criação, pagamento, cancelamento, jogadores."""

from __future__ import annotations

import secrets
from datetime import date, datetime, time, timedelta

import asyncpg
from fastapi import HTTPException, status

from . import jobs, pix
from .config import get_settings
from .domain import Pricer, WEEKDAY_SHORT, day_info, load_settings, local_dt, now_local
from .notify import notify, notify_players

CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

SELECT_RESERVATION = """
    SELECT r.*, lower(r.period) AS starts_at, upper(r.period) AS ends_at,
           c.number AS court_number, c.name AS court_name, c.description AS court_description,
           u.name AS owner_name, u.phone AS owner_phone, u.email AS owner_email
    FROM reservations r
    JOIN courts c ON c.id = r.court_id
    JOIN users u ON u.id = r.user_id
"""


def new_code() -> str:
    return "PL-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))


def conflict(message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, message)


def bad(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)


def localize(row: asyncpg.Record) -> dict:
    """asyncpg devolve timestamptz em UTC; converte início/fim para o fuso do clube."""
    tz = get_settings().tz
    out = dict(row)
    for k in ("starts_at", "ends_at"):
        out[k] = out[k].astimezone(tz)
    return out


async def fetch(conn: asyncpg.Connection, code: str) -> dict:
    row = await conn.fetchrow(SELECT_RESERVATION + " WHERE r.code = $1", code.upper())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reserva não encontrada.")
    return localize(row)


async def serialize(conn: asyncpg.Connection, r: asyncpg.Record | dict, viewer: asyncpg.Record | None, settings: dict | None = None) -> dict:
    settings = settings or await load_settings(conn)
    r = localize(r) if isinstance(r, asyncpg.Record) else r
    players = await conn.fetch(
        "SELECT id, user_id, name, is_owner FROM reservation_players WHERE reservation_id = $1 ORDER BY is_owner DESC, joined_at",
        r["id"],
    )
    viewer_id = viewer["id"] if viewer else None
    is_owner = viewer_id == r["user_id"]
    is_admin = bool(viewer and viewer["role"] == "admin")
    start: datetime = r["starts_at"]
    end: datetime = r["ends_at"]
    free_until = start - timedelta(hours=int(settings["cancel_free_hours"]))
    now = now_local()
    n_players = max(len(players), 1)
    out = {
        "code": r["code"],
        "court": {"id": r["court_id"], "number": r["court_number"], "name": r["court_name"], "description": r["court_description"]},
        "date": start.date().isoformat(),
        "weekday": WEEKDAY_SHORT[start.weekday()],
        "start": start.strftime("%H:%M"),
        "end": end.strftime("%H:%M"),
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "duration": r["duration_min"],
        "status": r["status"],
        "payment_method": r["payment_method"],
        "payment_status": r["payment_status"],
        "price_cents": r["price_cents"],
        "per_player_cents": r["price_cents"] // n_players,
        "players": [
            {"id": p["id"], "name": p["name"], "is_owner": p["is_owner"], "is_you": p["user_id"] == viewer_id and viewer_id is not None}
            for p in players
        ],
        "max_players": int(settings["max_players"]),
        "owner_name": r["owner_name"],
        "is_owner": is_owner,
        "hold_expires_at": r["hold_expires_at"].isoformat() if r["hold_expires_at"] and r["status"] == "pending" else None,
        "checked_in_at": r["checked_in_at"].isoformat() if r["checked_in_at"] else None,
        "cancelled_at": r["cancelled_at"].isoformat() if r["cancelled_at"] else None,
        "free_cancel_until": free_until.isoformat(),
        "can_cancel": (is_owner or is_admin) and r["status"] in ("pending", "confirmed") and start > now,
        "free_cancel": now <= free_until,
    }
    if is_owner or is_admin:
        out["invite_token"] = str(r["invite_token"])
    if is_admin:
        out["owner"] = {"name": r["owner_name"], "email": r["owner_email"], "phone": r["owner_phone"]}
    if r["status"] == "pending" and r["payment_method"] == "pix" and (is_owner or is_admin):
        pay = await conn.fetchrow(
            "SELECT pix_payload, txid FROM payments WHERE reservation_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1",
            r["id"],
        )
        if pay:
            out["pix"] = {"payload": pay["pix_payload"], "txid": pay["txid"]}
    return out


async def quote(conn: asyncpg.Connection, court_id: int, d: date, start: time, duration: int) -> dict:
    settings = await load_settings(conn)
    info = await day_info(conn, d)
    q = (await Pricer.load(conn, settings)).quote(local_dt(d, start), duration, info.holiday is not None)
    return {"cents": q.cents, "promo": q.promo, "lines": q.lines}


async def create(conn: asyncpg.Connection, user: asyncpg.Record, court_id: int, d: date, start: time,
                 duration: int, method: str, guests: list[str], by_admin: bool = False) -> dict:
    """`user` é o dono da reserva. `by_admin`: a recepção reservando em nome do cliente — sem limite de
    reservas futuras nem janela de antecedência (funcionamento, sobreposição e bloqueios continuam valendo)."""
    settings = await load_settings(conn)
    if duration not in settings["durations"]:
        raise bad("Duração não disponível.")
    if len(guests) > int(settings["max_players"]) - 1:
        raise bad(f"No máximo {settings['max_players']} jogadores por quadra.")
    court = await conn.fetchrow("SELECT id, name FROM courts WHERE id = $1 AND active", court_id)
    if court is None:
        raise bad("Quadra inválida.")

    info = await day_info(conn, d)
    starts_at = local_dt(d, start)
    now = now_local()
    if not info.open:
        raise bad("O clube está fechado nesse dia.")
    if not info.fits(start, duration):
        raise bad("Esse horário não cabe no funcionamento do clube.")
    if starts_at <= now:
        raise bad("Esse horário já passou.")
    if not by_admin and d > now.date() + timedelta(days=int(settings["booking_horizon_days"])):
        raise bad(f"Reservas abrem com até {settings['booking_horizon_days']} dias de antecedência.")

    q = (await Pricer.load(conn, settings)).quote(starts_at, duration, info.holiday is not None)
    ends_at = starts_at + timedelta(minutes=duration)

    async with conn.transaction():
        await jobs.expire_holds(conn)
        active = await conn.fetchval(
            "SELECT count(*) FROM reservations WHERE user_id = $1 AND status IN ('pending', 'confirmed') AND lower(period) > now()",
            user["id"],
        )
        if active >= int(settings["max_active_per_user"]) and user["role"] != "admin" and not by_admin:
            raise conflict(f"Você já tem {active} reservas futuras. Jogue ou cancele uma para reservar outra.")

        if method == "pix":
            st, pay_st = "pending", "pending"
            hold = now + timedelta(minutes=int(settings["pending_hold_minutes"]))
        elif method == "card":
            # Gateway de cartão simulado: aprovação imediata.
            st, pay_st, hold = "confirmed", "paid", None
        else:
            st, pay_st, hold = "confirmed", "onsite", None

        row = None
        for _ in range(5):
            try:
                async with conn.transaction():
                    row = await conn.fetchrow(
                        """
                        INSERT INTO reservations (code, court_id, user_id, period, duration_min, status,
                                                  payment_method, payment_status, price_cents, hold_expires_at)
                        VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6, $7, $8, $9, $10, $11)
                        RETURNING id, code
                        """,
                        new_code(), court_id, user["id"], starts_at, ends_at, duration, st, method, pay_st, q.cents, hold,
                    )
                break
            except asyncpg.UniqueViolationError as e:
                if e.constraint_name != "reservations_code_key":
                    raise
            except asyncpg.ExclusionViolationError:
                raise conflict("Esse horário acabou de ser reservado por outra pessoa. Escolha outro.")
        if row is None:
            raise conflict("Não foi possível gerar o código da reserva. Tente de novo.")

        await conn.execute(
            "INSERT INTO reservation_players (reservation_id, user_id, name, is_owner) VALUES ($1, $2, $3, true)",
            row["id"], user["id"], user["name"],
        )
        for g in guests:
            if g.strip():
                await conn.execute(
                    "INSERT INTO reservation_players (reservation_id, name) VALUES ($1, $2)", row["id"], g.strip()[:80]
                )

        if method == "pix":
            txid = row["code"].replace("-", "") + secrets.token_hex(4).upper()
            payload = pix.br_code(settings["pix_key"], q.cents, settings["pix_merchant_name"], settings["pix_merchant_city"], txid)
            await conn.execute(
                "INSERT INTO payments (reservation_id, method, channel, amount_cents, txid, pix_payload) VALUES ($1, 'pix', 'pix_online', $2, $3, $4)",
                row["id"], q.cents, txid, payload,
            )
        elif method == "card":
            await conn.execute(
                "INSERT INTO payments (reservation_id, method, channel, amount_cents, status, paid_at) VALUES ($1, 'card', 'cartao_online', $2, 'paid', now())",
                row["id"], q.cents,
            )
        if st == "confirmed":
            await notify(conn, user["id"], "confirmed", "Reserva confirmada",
                         f"{court['name']} · {WEEKDAY_SHORT[d.weekday()].title()} {d:%d/%m} · {start:%H:%M}", "/reservas")

    return await serialize(conn, await fetch(conn, row["code"]), user, settings)


async def mark_paid(conn: asyncpg.Connection, r: dict, txid: str | None = None,
                    channel: str | None = None, admin_id: int | None = None, note: str | None = None) -> None:
    """Confirma o pagamento. Com admin_id é lançamento de balcão (entra no caixa do dia e é travado no fechamento)."""
    try:
        await _mark_paid(conn, r, txid, channel, admin_id, note)
    except asyncpg.CheckViolationError as e:
        if e.constraint_name == "payments_closed_day":
            raise conflict("O caixa de hoje já foi fechado. Reabra o fechamento para lançar o recebimento.")
        raise


async def _mark_paid(conn: asyncpg.Connection, r: dict, txid: str | None, channel: str | None,
                     admin_id: int | None, note: str | None) -> None:
    async with conn.transaction():
        if r["status"] == "pending":
            if r["hold_expires_at"] and r["hold_expires_at"] < now_local():
                raise conflict("O prazo de pagamento expirou. Faça uma nova reserva.")
            await conn.execute("UPDATE reservations SET status = 'confirmed', payment_status = 'paid', hold_expires_at = NULL WHERE id = $1", r["id"])
            await conn.execute(
                """UPDATE payments SET status = 'paid', paid_at = now(), channel = coalesce($3, channel), received_by = $4, note = $5
                   WHERE reservation_id = $1 AND status = 'pending' AND ($2::text IS NULL OR txid = $2)""",
                r["id"], txid, channel, admin_id, note,
            )
            await notify_players(conn, r["id"], "confirmed", "Pagamento confirmado",
                                 f"Reserva {r['code']} confirmada · {r['court_name']} · {r['starts_at']:%d/%m %H:%M}", "/reservas")
        elif r["payment_status"] == "onsite" and r["status"] in ("confirmed", "checked_in", "completed"):
            await conn.execute("UPDATE reservations SET payment_status = 'paid' WHERE id = $1", r["id"])
            await conn.execute(
                """INSERT INTO payments (reservation_id, method, channel, amount_cents, status, paid_at, received_by, note)
                   VALUES ($1, 'onsite', $2, $3, 'paid', now(), $4, $5)""",
                r["id"], channel or "dinheiro", r["price_cents"], admin_id, note,
            )
        else:
            raise conflict("Essa reserva não tem pagamento pendente.")


async def cancel(conn: asyncpg.Connection, r: dict, actor: asyncpg.Record, reason: str | None) -> dict:
    settings = await load_settings(conn)
    is_admin = actor["role"] == "admin"
    if r["user_id"] != actor["id"] and not is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só quem fez a reserva pode cancelar.")
    if r["status"] not in ("pending", "confirmed"):
        raise conflict("Essa reserva não pode mais ser cancelada.")
    now = now_local()
    if r["starts_at"] <= now:
        raise conflict("O jogo já começou.")
    free = is_admin or now <= r["starts_at"] - timedelta(hours=int(settings["cancel_free_hours"]))
    refund = free and r["payment_status"] == "paid"
    new_pay = "refunded" if refund else ("void" if r["payment_status"] in ("pending", "onsite") else r["payment_status"])
    async with conn.transaction():
        await conn.execute(
            "UPDATE reservations SET status = 'cancelled', payment_status = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1",
            r["id"], new_pay, reason or ("Cancelada pela administração" if is_admin and r["user_id"] != actor["id"] else None),
        )
        await conn.execute(
            """UPDATE payments SET status = CASE WHEN status = 'paid' AND $2 THEN 'refunded' WHEN status = 'pending' THEN 'void' ELSE status END,
                                  refunded_at = CASE WHEN status = 'paid' AND $2 THEN now() ELSE refunded_at END
               WHERE reservation_id = $1""",
            r["id"], refund,
        )
        await notify_players(conn, r["id"], "cancelled", "Reserva cancelada",
                             f"{r['court_name']} · {r['starts_at']:%d/%m %H:%M}" + (" · valor estornado" if refund else ""),
                             "/reservas", exclude=actor["id"])
    return {"refund": refund, "free": free}


async def add_player(conn: asyncpg.Connection, r: dict, name: str, user_id: int | None = None) -> None:
    if r["status"] not in ("pending", "confirmed"):
        raise conflict("Essa reserva não aceita mais jogadores.")
    try:
        await conn.execute(
            "INSERT INTO reservation_players (reservation_id, user_id, name) VALUES ($1, $2, $3)",
            r["id"], user_id, name.strip()[:80],
        )
    except asyncpg.UniqueViolationError:
        raise conflict("Você já está nessa reserva.")
    except asyncpg.CheckViolationError as e:
        if e.constraint_name == "reservation_players_limit":
            raise conflict("A quadra já está completa.")
        raise


def ics(r: dict, settings: dict) -> str:
    fmt = "%Y%m%dT%H%M%SZ"
    from datetime import timezone

    s = r["starts_at"].astimezone(timezone.utc).strftime(fmt)
    e = r["ends_at"].astimezone(timezone.utc).strftime(fmt)
    stamp = datetime.now(timezone.utc).strftime(fmt)
    loc = f"{settings['address']} - {settings['district']}".replace(",", "\\,")
    return "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Padel Lobby//Reservas//PT-BR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
        f"UID:{r['code']}@padellobby", f"DTSTAMP:{stamp}", f"DTSTART:{s}", f"DTEND:{e}",
        f"SUMMARY:Padel · {r['court_name']}", f"LOCATION:{loc}",
        f"DESCRIPTION:Código de check-in {r['code']}",
        "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Jogo de padel em 1 hora", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", "",
    ])
