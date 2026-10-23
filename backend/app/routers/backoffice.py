"""Retaguarda do admin: agendamentos, mapa de disponibilidade, pagamentos, fechamento diário e relatórios de locação."""

import csv
import io
import logging
import secrets
from datetime import date, time, timedelta
from typing import Literal

import asyncpg
from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, EmailStr, Field

from .. import reservations as svc
from ..config import get_settings
from ..deps import Admin, Conn, Master
from ..security import hash_password, verify_password
from ..domain import WEEKDAY_SHORT, _m, day_infos, load_settings, local_dt, now_local

router = APIRouter(prefix="/api/admin", tags=["retaguarda"])
log = logging.getLogger("padel.backoffice")

PLAYED = ("confirmed", "checked_in", "completed")
CHANNELS = ("pix_online", "cartao_online", "dinheiro", "pix_balcao", "debito", "credito")
Channel = Literal["pix_online", "cartao_online", "dinheiro", "pix_balcao", "debito", "credito"]


def _period(start: date | None, end: date | None, max_days: int = 400) -> tuple[date, date]:
    """[start, end) — padrão: mês corrente."""
    today = now_local().date()
    start = start or today.replace(day=1)
    end = end or (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    if end <= start or (end - start).days > max_days:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Período inválido.")
    return start, end


def _bounds(start: date, end: date):
    return local_dt(start, time(0)), local_dt(end, time(0))


def _csv(name: str, header: list[str], rows: list[list]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(header)
    w.writerows(rows)
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


def _brl(cents: int) -> str:
    return f"{cents / 100:.2f}".replace(".", ",")


# ── Agendamentos ────────────────────────────────────────────────────────────

BOOKING_FILTER = """
    WHERE lower(r.period) >= $1 AND lower(r.period) < $2
      AND ($3::smallint IS NULL OR r.court_id = $3)
      AND ($4::text IS NULL OR r.status = $4)
      AND ($5::text IS NULL OR r.payment_status = $5)
      AND ($6::text IS NULL OR r.payment_method = $6)
      AND ($7 = '' OR r.code ILIKE '%' || $7 || '%' OR u.name ILIKE '%' || $7 || '%'
           OR u.email::text ILIKE '%' || $7 || '%' OR coalesce(u.phone, '') ILIKE '%' || $7 || '%')
"""


@router.get("/bookings")
async def bookings(
    admin: Admin, conn: Conn,
    start: date | None = None, end: date | None = None, court_id: int | None = None,
    status_: str | None = Query(None, alias="status"), payment_status: str | None = None,
    method: str | None = None, q: str = "",
    order: Literal["asc", "desc"] = "asc", offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200),
):
    s, e = _bounds(*_period(start, end))
    args = (s, e, court_id, status_ or None, payment_status or None, method or None, q.strip())
    totals = await conn.fetchrow(
        f"""SELECT count(*) AS n,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.status IN {PLAYED}), 0) AS value_cents,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.payment_status = 'paid'), 0) AS paid_cents,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.payment_status IN ('onsite', 'pending') AND r.status IN {PLAYED + ('pending',)}), 0) AS open_cents,
                   coalesce(sum(r.duration_min) FILTER (WHERE r.status IN {PLAYED}), 0) AS minutes
            FROM reservations r JOIN users u ON u.id = r.user_id {BOOKING_FILTER}""",
        *args,
    )
    rows = await conn.fetch(
        svc.SELECT_RESERVATION + BOOKING_FILTER + f" ORDER BY lower(r.period) {order}, c.number OFFSET $8 LIMIT $9",
        *args, offset, limit,
    )
    settings = await load_settings(conn)
    return {**dict(totals), "items": [await svc.serialize(conn, r, admin, settings) for r in rows]}


# ── Mapa de disponibilidade (quadras × horários, vários dias) ──────────────

@router.get("/occupancy")
async def occupancy(_: Admin, conn: Conn, start: date | None = None, days: int = Query(1, ge=1, le=7)):
    """Grade em fatias de 30 min: livre, reservado (com quem/situação), bloqueado ou passado."""
    start = start or now_local().date()
    courts = await conn.fetch("SELECT id, number, name FROM courts WHERE active ORDER BY number")
    infos = await day_infos(conn, start, days)
    s, e = _bounds(start, start + timedelta(days=days))
    res = await conn.fetch(
        svc.SELECT_RESERVATION
        + """ WHERE r.period && tstzrange($1, $2) AND r.status IN ('pending', 'confirmed', 'checked_in', 'completed')
              AND NOT (r.status = 'pending' AND r.hold_expires_at < now())""",
        s, e,
    )
    blocks = await conn.fetch(
        "SELECT id, court_id, lower(period) AS s, upper(period) AS e, reason FROM blocks WHERE period && tstzrange($1, $2)", s, e)
    lessons = await conn.fetch(
        """SELECT x.id, x.court_id, lower(x.period) AS s, upper(x.period) AS e, coalesce(x.title, g.name, 'Aula') AS name, c.name AS coach
           FROM class_sessions x JOIN coaches c ON c.id = x.coach_id LEFT JOIN class_groups g ON g.id = x.group_id
           WHERE x.period && tstzrange($1, $2) AND x.status <> 'cancelled'""", s, e)
    now = now_local()
    out_days = []
    for info in infos:
        day = {"date": info.day.isoformat(), "weekday": WEEKDAY_SHORT[info.day.weekday()], "holiday": info.holiday,
               "open": info.open, "times": [], "cells": {c["id"]: [] for c in courts},
               "free_minutes": {c["id"]: 0 for c in courts}, "booked_minutes": {c["id"]: 0 for c in courts}}
        for o, c_ in info.intervals:
            for minute in range(_m(o), _m(c_), 30):
                t = time(minute // 60, minute % 60)
                a = local_dt(info.day, t)
                b = a + timedelta(minutes=30)
                day["times"].append(t.strftime("%H:%M"))
                for c in courts:
                    cell: dict = {"s": "free"}
                    r = next((r for r in res if r["court_id"] == c["id"] and r["starts_at"] < b and a < r["ends_at"]), None)
                    blk = next((x for x in blocks if x["court_id"] in (None, c["id"]) and x["s"] < b and a < x["e"]), None)
                    les = next((x for x in lessons if x["court_id"] == c["id"] and x["s"] < b and a < x["e"]), None)
                    if les is not None:
                        cell = {"s": "class", "id": les["id"], "name": les["name"], "coach": les["coach"], "first": les["s"] >= a}
                        day["booked_minutes"][c["id"]] += 30
                    elif r is not None:
                        cell = {"s": "res", "code": r["code"], "status": r["status"], "pay": r["payment_status"],
                                "who": r["owner_name"], "first": r["starts_at"] >= a}
                        day["booked_minutes"][c["id"]] += 30
                    elif blk is not None:
                        cell = {"s": "block", "reason": blk["reason"], "id": blk["id"]}
                    elif b <= now:
                        cell = {"s": "past"}
                    else:
                        day["free_minutes"][c["id"]] += 30
                    day["cells"][c["id"]].append(cell)
        out_days.append(day)
    return {"courts": [dict(c) for c in courts], "days": out_days}


# ── Pagamentos ──────────────────────────────────────────────────────────────

@router.get("/payments")
async def payments(
    _: Admin, conn: Conn, start: date | None = None, end: date | None = None,
    channel: str | None = None, kind: Literal["received", "refunded", "all"] = "all",
):
    """Movimento financeiro do período: recebimentos (paid_at) e estornos (refunded_at)."""
    s, e = _bounds(*_period(start, end))
    rows = await conn.fetch(
        """
        SELECT * FROM (
            SELECT 'received' AS kind, p.paid_at AS at, p.amount_cents, p.id, p.channel, p.note, p.received_by,
                   coalesce(r.code, 'Aulas'), coalesce(c.name, ch.description), u.name AS client,
                   coalesce(lower(r.period), ch.created_at) AS starts_at, a.name AS admin
            FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id LEFT JOIN courts c ON c.id = r.court_id
                 LEFT JOIN student_charges ch ON ch.id = p.charge_id
                 JOIN users u ON u.id = coalesce(r.user_id, ch.user_id) LEFT JOIN users a ON a.id = p.received_by
            WHERE p.status IN ('paid', 'refunded') AND p.paid_at >= $1 AND p.paid_at < $2
            UNION ALL
            SELECT 'refunded', p.refunded_at, -p.amount_cents, p.id, p.channel, r.cancel_reason, p.received_by,
                   coalesce(r.code, 'Aulas'), coalesce(c.name, ch.description), u.name,
                   coalesce(lower(r.period), ch.created_at), a.name
            FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id LEFT JOIN courts c ON c.id = r.court_id
                 LEFT JOIN student_charges ch ON ch.id = p.charge_id
                 JOIN users u ON u.id = coalesce(r.user_id, ch.user_id) LEFT JOIN users a ON a.id = p.received_by
            WHERE p.status = 'refunded' AND p.refunded_at >= $1 AND p.refunded_at < $2
        ) m(kind, at, amount_cents, id, channel, note, received_by, code, court, client, starts_at, admin)
        WHERE ($3::text IS NULL OR channel = $3) AND ($4 = 'all' OR kind = $4)
        ORDER BY at DESC
        """,
        s, e, channel or None, kind,
    )
    tz = get_settings().tz
    items = [{**dict(r), "at": r["at"].astimezone(tz).isoformat(), "starts_at": r["starts_at"].astimezone(tz).isoformat(),
              "manual": r["received_by"] is not None} for r in rows]
    by_channel: dict[str, dict] = {ch: {"received_cents": 0, "refunded_cents": 0, "count": 0} for ch in CHANNELS}
    for it in items:
        b = by_channel[it["channel"]]
        if it["kind"] == "received":
            b["received_cents"] += it["amount_cents"]
            b["count"] += 1
        else:
            b["refunded_cents"] += -it["amount_cents"]
    receivable = await conn.fetch(
        svc.SELECT_RESERVATION
        + f""" WHERE (r.payment_status = 'onsite' AND r.status IN {PLAYED})
                  OR (r.status = 'pending' AND r.hold_expires_at >= now())
               ORDER BY lower(r.period)"""
    )
    settings = await load_settings(conn)
    return {
        "items": items,
        "received_cents": sum(i["amount_cents"] for i in items if i["kind"] == "received"),
        "refunded_cents": -sum(i["amount_cents"] for i in items if i["kind"] == "refunded"),
        "by_channel": by_channel,
        "receivable": [await svc.serialize(conn, r, _, settings) for r in receivable],
        "receivable_cents": sum(r["price_cents"] for r in receivable),
    }


class ReceiveIn(BaseModel):
    channel: Channel = "dinheiro"
    note: str | None = Field(default=None, max_length=200)


@router.post("/reservations/{code}/receive")
async def receive(code: str, body: ReceiveIn, admin: Admin, conn: Conn):
    """Recebimento no balcão (no local ou Pix pendente confirmado manualmente)."""
    if body.channel in ("pix_online", "cartao_online"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha como o valor foi recebido no balcão.")
    await svc.mark_paid(conn, await svc.fetch(conn, code), channel=body.channel, admin_id=admin["id"], note=body.note)
    return await svc.serialize(conn, await svc.fetch(conn, code), admin)


@router.get("/payments.csv")
async def payments_csv(admin: Admin, conn: Conn, start: date | None = None, end: date | None = None):
    data = await payments(admin, conn, start, end, None, "all")
    s, e = _period(start, end)
    return _csv(f"pagamentos-{s}-{e}", ["data_hora", "tipo", "canal", "valor", "reserva", "quadra", "cliente", "lancado_por", "obs"], [
        [i["at"][:16].replace("T", " "), "recebimento" if i["kind"] == "received" else "estorno", i["channel"],
         _brl(i["amount_cents"]), i["code"], i["court"], i["client"], i["admin"] or "online", i["note"] or ""]
        for i in data["items"]
    ])


# ── Fechamento diário ───────────────────────────────────────────────────────

async def _day_summary(conn: asyncpg.Connection, day: date) -> dict:
    s, e = _bounds(day, day + timedelta(days=1))
    by_channel = {ch: {"received_cents": 0, "refunded_cents": 0, "count": 0} for ch in CHANNELS}
    for r in await conn.fetch(
        """SELECT channel, count(*) AS n, sum(amount_cents) AS v FROM payments
           WHERE status IN ('paid', 'refunded') AND paid_at >= $1 AND paid_at < $2 GROUP BY channel""", s, e):
        by_channel[r["channel"]].update(received_cents=r["v"], count=r["n"])
    for r in await conn.fetch(
        """SELECT channel, sum(amount_cents) AS v FROM payments
           WHERE status = 'refunded' AND refunded_at >= $1 AND refunded_at < $2 GROUP BY channel""", s, e):
        by_channel[r["channel"]]["refunded_cents"] = r["v"]
    games = await conn.fetchrow(
        f"""SELECT count(*) FILTER (WHERE status IN {PLAYED}) AS played,
                   count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                   count(*) FILTER (WHERE status IN {PLAYED} AND checked_in_at IS NULL AND upper(period) <= now()) AS no_checkin,
                   coalesce(sum(duration_min) FILTER (WHERE status IN {PLAYED}), 0) AS minutes,
                   coalesce(sum(price_cents) FILTER (WHERE status IN {PLAYED}), 0) AS value_cents,
                   coalesce(sum(price_cents) FILTER (WHERE status IN {PLAYED} AND payment_status = 'onsite'), 0) AS open_cents,
                   count(*) FILTER (WHERE status IN {PLAYED} AND payment_status = 'onsite') AS open_count
            FROM reservations WHERE lower(period) >= $1 AND lower(period) < $2""",
        s, e,
    )
    by_court = await conn.fetch(
        f"""SELECT c.name, count(r.id) AS bookings, coalesce(sum(r.duration_min), 0) AS minutes, coalesce(sum(r.price_cents), 0) AS value_cents
            FROM courts c LEFT JOIN reservations r ON r.court_id = c.id AND r.status IN {PLAYED}
                 AND lower(r.period) >= $1 AND lower(r.period) < $2
            WHERE c.active GROUP BY c.id ORDER BY c.number""",
        s, e,
    )
    received = sum(b["received_cents"] for b in by_channel.values())
    refunded = sum(b["refunded_cents"] for b in by_channel.values())
    cash = by_channel["dinheiro"]
    return {
        "date": day.isoformat(),
        "by_channel": by_channel,
        "received_cents": received,
        "refunded_cents": refunded,
        "net_cents": received - refunded,
        "cash_expected_cents": cash["received_cents"] - cash["refunded_cents"],
        "games": dict(games),
        "by_court": [dict(r) for r in by_court],
    }


def _closing_out(row: asyncpg.Record | None) -> dict | None:
    if row is None:
        return None
    tz = get_settings().tz
    d = dict(row)
    for k in ("closed_at", "reopened_at"):
        d[k] = d[k].astimezone(tz).isoformat() if d[k] else None
    d["day"] = d["day"].isoformat()
    d["locked"] = d["reopened_at"] is None
    return d


CLOSING_SELECT = """SELECT dc.*, a.name AS closed_by_name, b.name AS reopened_by_name FROM daily_closings dc
                    JOIN users a ON a.id = dc.closed_by LEFT JOIN users b ON b.id = dc.reopened_by"""


@router.get("/closings/{day}")
async def closing(day: date, _: Admin, conn: Conn):
    summary = await _day_summary(conn, day)
    row = await conn.fetchrow(CLOSING_SELECT + " WHERE dc.day = $1", day)
    out = _closing_out(row)
    drift = None
    if out and out["locked"]:
        drift = {"received_cents": summary["received_cents"] - out["received_cents"],
                 "refunded_cents": summary["refunded_cents"] - out["refunded_cents"]}
    return {"summary": summary, "closing": out, "drift": drift, "can_close": day <= now_local().date()}


class CloseIn(BaseModel):
    cash_counted_cents: int = Field(ge=0, le=100_000_000)
    note: str | None = Field(default=None, max_length=500)


@router.post("/closings/{day}", status_code=201)
async def close_day(day: date, body: CloseIn, admin: Admin, conn: Conn):
    if day > now_local().date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Não dá para fechar um dia que ainda não começou.")
    async with conn.transaction():
        existing = await conn.fetchrow("SELECT * FROM daily_closings WHERE day = $1 FOR UPDATE", day)
        if existing and existing["reopened_at"] is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esse dia já está fechado.")
        sm = await _day_summary(conn, day)
        hist = existing["history"] if existing else []
        await conn.execute(
            """INSERT INTO daily_closings (day, received_cents, refunded_cents, cash_expected_cents, cash_counted_cents, snapshot, note, closed_by, history)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (day) DO UPDATE SET received_cents = $2, refunded_cents = $3, cash_expected_cents = $4,
                   cash_counted_cents = $5, snapshot = $6, note = $7, closed_by = $8, closed_at = now(),
                   reopened_at = NULL, reopened_by = NULL, history = $9""",
            day, sm["received_cents"], sm["refunded_cents"], sm["cash_expected_cents"], body.cash_counted_cents,
            sm, body.note, admin["id"], hist,
        )
    return await closing(day, admin, conn)


class ReopenIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


@router.post("/closings/{day}/reopen")
async def reopen_day(day: date, body: ReopenIn, admin: Admin, conn: Conn):
    async with conn.transaction():
        row = await conn.fetchrow("SELECT * FROM daily_closings WHERE day = $1 FOR UPDATE", day)
        if row is None or row["reopened_at"] is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esse dia não está fechado.")
        entry = {"closed_at": row["closed_at"].isoformat(), "closed_by": row["closed_by"],
                 "received_cents": row["received_cents"], "cash_counted_cents": row["cash_counted_cents"],
                 "cash_expected_cents": row["cash_expected_cents"],
                 "reopened_at": now_local().isoformat(), "reopened_by": admin["id"], "reason": body.reason}
        await conn.execute(
            "UPDATE daily_closings SET reopened_at = now(), reopened_by = $2, history = history || $3::jsonb WHERE day = $1",
            day, admin["id"], [entry],
        )
    return await closing(day, admin, conn)


@router.get("/closings")
async def closings(_: Admin, conn: Conn, start: date | None = None, end: date | None = None):
    """Fechamentos do período + dias com movimento ainda sem fechamento."""
    start, end = _period(start, end)
    rows = await conn.fetch(CLOSING_SELECT + " WHERE dc.day >= $1 AND dc.day < $2 ORDER BY dc.day", start, end)
    s, e = _bounds(start, min(end, now_local().date() + timedelta(days=1)))
    moved = await conn.fetch(
        """SELECT DISTINCT d FROM (
               SELECT paid_at::date AS d FROM payments WHERE paid_at >= $1 AND paid_at < $2 AND status IN ('paid', 'refunded')
               UNION SELECT refunded_at::date FROM payments WHERE refunded_at >= $1 AND refunded_at < $2
           ) x ORDER BY d""",
        s, e,
    )
    closed = {r["day"] for r in rows if r["reopened_at"] is None}
    return {
        "items": [_closing_out(r) for r in rows],
        "pending_days": [r["d"].isoformat() for r in moved if r["d"] not in closed and r["d"] <= now_local().date()],
    }


# ── Relatórios de locação ───────────────────────────────────────────────────

@router.get("/reports/rentals")
async def rentals(_: Admin, conn: Conn, start: date | None = None, end: date | None = None, court_id: int | None = None):
    start, end = _period(start, end)
    s, e = _bounds(start, end)
    base = f"FROM reservations r JOIN users u ON u.id = r.user_id JOIN courts c ON c.id = r.court_id WHERE lower(r.period) >= $1 AND lower(r.period) < $2 AND ($3::smallint IS NULL OR r.court_id = $3)"
    played = f" AND r.status IN {PLAYED}"
    args = (s, e, court_id)
    totals = await conn.fetchrow(
        f"""SELECT count(*) FILTER (WHERE r.status IN {PLAYED}) AS rentals,
                   coalesce(sum(r.duration_min) FILTER (WHERE r.status IN {PLAYED}), 0) AS minutes,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.status IN {PLAYED}), 0) AS gross_cents,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.status IN {PLAYED} AND r.payment_status = 'paid'), 0) AS paid_cents,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.status IN {PLAYED} AND r.payment_status = 'onsite'), 0) AS open_cents,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.payment_status = 'refunded'), 0) AS refunded_cents,
                   count(*) FILTER (WHERE r.status = 'cancelled') AS cancelled,
                   count(*) FILTER (WHERE r.status = 'expired') AS expired,
                   count(DISTINCT r.user_id) FILTER (WHERE r.status IN {PLAYED}) AS clients
            {base}""", *args)
    n_courts = 1 if court_id else await conn.fetchval("SELECT count(*) FROM courts WHERE active")
    open_minutes = sum(sum(_m(c_) - _m(o) for o, c_ in i.intervals) for i in await day_infos(conn, start, (end - start).days))
    capacity = open_minutes * n_courts

    async def group(expr: str, label: str, order: str = "1") -> list[dict]:
        rows = await conn.fetch(
            f"""SELECT {expr} AS key, {label} AS label, count(*) AS rentals, sum(r.duration_min) AS minutes,
                       sum(r.price_cents) AS gross_cents,
                       coalesce(sum(r.price_cents) FILTER (WHERE r.payment_status = 'paid'), 0) AS paid_cents
                {base}{played} GROUP BY 1, 2 ORDER BY {order}""", *args)
        return [{**dict(r), "key": r["key"].isoformat() if isinstance(r["key"], date) else r["key"]} for r in rows]

    return {
        "start": start.isoformat(), "end": end.isoformat(), "court_id": court_id,
        **dict(totals),
        "capacity_minutes": capacity,
        "occupancy": round(totals["minutes"] / capacity, 4) if capacity else 0,
        "avg_ticket_cents": totals["gross_cents"] // totals["rentals"] if totals["rentals"] else 0,
        "by_day": await group("lower(r.period)::date", "to_char(lower(r.period), 'DD/MM')"),
        "by_court": await group("c.number", "c.name"),
        "by_weekday": await group("extract(isodow FROM lower(r.period))::int", "extract(isodow FROM lower(r.period))::int"),
        "by_hour": await group("extract(hour FROM lower(r.period))::int", "to_char(lower(r.period), 'HH24') || 'h'"),
        "by_method": await group("r.payment_method", "r.payment_method"),
        "by_duration": await group("r.duration_min::int", "r.duration_min || ' min'"),
        "by_client": (await group("u.id::int", "u.name", "5 DESC, 3 DESC"))[:50],
    }


@router.get("/reports/rentals.csv")
async def rentals_csv(
    admin: Admin, conn: Conn, start: date | None = None, end: date | None = None, court_id: int | None = None,
    group: Literal["day", "court", "weekday", "hour", "method", "duration", "client"] = "day",
):
    data = await rentals(admin, conn, start, end, court_id)
    wd = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
    rows = [[wd[g["label"]] if group == "weekday" else g["label"], g["rentals"], f"{g['minutes'] / 60:.1f}".replace(".", ","),
             _brl(g["gross_cents"]), _brl(g["paid_cents"])] for g in data[f"by_{group}"]]
    return _csv(f"locacoes-{group}-{data['start']}-{data['end']}", [group, "locacoes", "horas", "faturamento", "recebido"], rows)


# ── Usuários (papéis: só o admin master altera) ─────────────────────────────

@router.get("/users")
async def users(_: Admin, conn: Conn, q: str = "", role: Literal["player", "admin"] | None = None, limit: int = Query(100, le=500)):
    rows = await conn.fetch(
        f"""SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at, u.level, u.side, u.city, u.last_login_at,
                   u.must_change_password,
                   count(r.id) FILTER (WHERE r.status IN {PLAYED}) AS rentals,
                   coalesce(sum(r.price_cents) FILTER (WHERE r.payment_status = 'paid'), 0) AS paid_cents,
                   max(lower(r.period)) FILTER (WHERE r.status IN {PLAYED}) AS last_rental
            FROM users u LEFT JOIN reservations r ON r.user_id = u.id
            WHERE u.deleted_at IS NULL AND ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%' OR coalesce(u.phone, '') ILIKE '%' || $1 || '%')
              AND ($2::text IS NULL OR u.role = $2)
            GROUP BY u.id ORDER BY (u.role = 'admin') DESC, u.name LIMIT $3""",
        q.strip(), role, limit,
    )
    tz = get_settings().tz
    return [{**dict(r), "email": str(r["email"]), "created_at": r["created_at"].astimezone(tz).isoformat(),
             "last_rental": r["last_rental"].astimezone(tz).isoformat() if r["last_rental"] else None,
             "last_login_at": r["last_login_at"].astimezone(tz).isoformat() if r["last_login_at"] else None,
             "is_master": get_settings().is_master(r["email"])} for r in rows]


class RoleIn(BaseModel):
    role: Literal["player", "admin"]


@router.put("/users/{user_id}/role")
async def set_role(user_id: int, body: RoleIn, _: Master, conn: Conn):
    u = await conn.fetchrow("SELECT id, email FROM users WHERE id = $1", user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
    if get_settings().is_master(u["email"]) and body.role != "admin":
        raise HTTPException(status.HTTP_409_CONFLICT, "O admin master não pode ser rebaixado.")
    await conn.execute("UPDATE users SET role = $2 WHERE id = $1", user_id, body.role)
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: int, admin: Admin, conn: Conn):
    """"Esqueci a senha" sem e-mail: a recepção gera uma senha temporária (mostrada uma vez) e o jogador
    é obrigado a trocá-la no próximo acesso. Senha de admin só o master redefine; a do master, ninguém por aqui."""
    u = await conn.fetchrow("SELECT id, email, role FROM users WHERE id = $1 AND deleted_at IS NULL", user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")
    settings = get_settings()
    if settings.is_master(u["email"]):
        raise HTTPException(status.HTTP_409_CONFLICT, "A senha do admin master só é trocada por ele mesmo, no perfil.")
    if u["role"] == "admin" and not settings.is_master(admin["email"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o admin master redefine a senha de outro administrador.")
    temp = "-".join(secrets.token_hex(2) for _ in range(3))  # ex.: 3f9a-0b1c-77de
    await conn.execute(
        """UPDATE users SET password_hash = $2, must_change_password = true, token_version = token_version + 1, updated_at = now()
           WHERE id = $1""",
        user_id, hash_password(temp),
    )
    return {"temporary_password": temp}


# ── Manutenção: limpar os dados de exemplo do seed (só o admin master) ─────

# Contas criadas por `seed.py` (demo): o jogador demo e os jogadores fictícios @exemplo.com.
DEMO_USERS = "(lower(email::text) = 'jogador@padellobby.com.br' OR lower(email::text) LIKE '%@exemplo.com') AND role = 'player'"


async def _demo_preview(conn: asyncpg.Connection) -> dict:
    row = await conn.fetchrow(
        f"""
        WITH du AS (SELECT id FROM users WHERE {DEMO_USERS}),
             dr AS (SELECT id FROM reservations WHERE user_id IN (SELECT id FROM du)),
             dp AS (SELECT * FROM payments WHERE reservation_id IN (SELECT id FROM dr))
        SELECT (SELECT count(*) FROM du) AS users,
               (SELECT count(*) FROM dr) AS reservations,
               (SELECT count(*) FROM dp) AS payments,
               (SELECT coalesce(sum(amount_cents) FILTER (WHERE status IN ('paid', 'refunded')), 0) FROM dp) AS payments_cents,
               (SELECT count(*) FROM reservation_players WHERE reservation_id IN (SELECT id FROM dr)) AS players,
               (SELECT count(*) FROM reservation_players WHERE user_id IN (SELECT id FROM du) AND reservation_id NOT IN (SELECT id FROM dr)) AS invited_elsewhere,
               (SELECT count(*) FROM notifications WHERE user_id IN (SELECT id FROM du)) AS notifications,
               (SELECT count(*) FROM daily_closings WHERE day IN (
                    SELECT paid_at::date FROM dp WHERE paid_at IS NOT NULL
                    UNION SELECT refunded_at::date FROM dp WHERE refunded_at IS NOT NULL)) AS closings,
               (SELECT count(*) FROM reservations WHERE user_id NOT IN (SELECT id FROM du)) AS kept_reservations,
               (SELECT count(*) FROM users WHERE id NOT IN (SELECT id FROM du) AND deleted_at IS NULL) AS kept_users
        """
    )
    sample = await conn.fetch(f"SELECT name, email::text AS email FROM users WHERE {DEMO_USERS} ORDER BY id LIMIT 10")
    return {**dict(row), "sample": [dict(r) for r in sample]}


@router.get("/maintenance/demo-data")
async def demo_data(_: Master, conn: Conn):
    """Prévia do que a limpeza apagaria — nada é alterado."""
    return await _demo_preview(conn)


class PurgeIn(BaseModel):
    confirm: str
    password: str = Field(max_length=128)


@router.post("/maintenance/purge-demo")
async def purge_demo(body: PurgeIn, master: Master, conn: Conn):
    """Apaga as contas de exemplo e tudo o que é delas, numa transação. Admins, configurações, preços,
    feriados, bloqueios e dados reais ficam. Fechamentos de dias com dinheiro de exemplo também saem
    (os totais deles deixariam de bater)."""
    if body.confirm.strip().upper() != "APAGAR":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, 'Digite APAGAR para confirmar.')
    if not verify_password(body.password, await conn.fetchval("SELECT password_hash FROM users WHERE id = $1", master["id"])):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Senha incorreta.")
    async with conn.transaction():
        before = await _demo_preview(conn)
        await conn.execute(
            f"""DELETE FROM daily_closings WHERE day IN (
                    SELECT p.paid_at::date FROM payments p JOIN reservations r ON r.id = p.reservation_id
                    WHERE p.paid_at IS NOT NULL AND r.user_id IN (SELECT id FROM users WHERE {DEMO_USERS})
                    UNION
                    SELECT p.refunded_at::date FROM payments p JOIN reservations r ON r.id = p.reservation_id
                    WHERE p.refunded_at IS NOT NULL AND r.user_id IN (SELECT id FROM users WHERE {DEMO_USERS}))"""
        )
        # jogador de exemplo convidado numa reserva real: o nome fica, o vínculo com a conta sai
        await conn.execute(f"UPDATE reservation_players SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE {DEMO_USERS})")
        # payments, reservation_players e reservation_events saem em cascata com a reserva
        await conn.execute(f"DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE {DEMO_USERS})")
        await conn.execute(f"DELETE FROM users WHERE {DEMO_USERS}")  # notifications em cascata
    log.warning("dados de exemplo apagados por %s: %s", master["email"],
                {k: v for k, v in before.items() if k != "sample"})
    return {"deleted": {k: before[k] for k in ("users", "reservations", "payments", "players", "notifications", "closings")},
            "remaining": await _demo_preview(conn)}


# ── Reserva feita pela recepção (aba Disponibilidade) ──────────────────────

class WalkInIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None


class AdminBookingIn(BaseModel):
    court_id: int
    date: date
    start: time
    duration: int = 60
    user_id: int | None = None          # cliente com conta
    client: WalkInIn | None = None      # ou cliente de balcão
    players: list[str] = Field(default_factory=list, max_length=7)
    receive: Channel | None = None      # recebe agora no balcão; None = fica "a receber"
    note: str | None = Field(default=None, max_length=200)


async def resolve_client(conn: asyncpg.Connection, user_id: int | None, client: "WalkInIn | None") -> asyncpg.Record:
    """Cliente com conta (user_id) ou cliente de balcão (conta sem acesso: e-mail interno e senha aleatória;
    se a recepção informar o e-mail, a pessoa pode entrar depois pedindo uma senha temporária)."""
    if (user_id is None) == (client is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha um cliente cadastrado ou informe o nome do cliente de balcão.")
    if user_id is not None:
        owner = await conn.fetchrow("SELECT id, name, email, phone, role FROM users WHERE id = $1 AND deleted_at IS NULL", user_id)
        if owner is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Cliente não encontrado.")
        return owner
    email = (client.email or "").strip().lower() or None
    if email and await conn.fetchval("SELECT 1 FROM users WHERE email = $1", email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com esse e-mail. Busque o cliente pelo nome ou e-mail.")
    return await conn.fetchrow(
        """INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, phone, role""",
        client.name.strip(), email or f"balcao-{secrets.token_hex(5)}@padellobby.invalid",
        (client.phone or "").strip() or None, hash_password(secrets.token_urlsafe(24)),
    )


@router.post("/reservations", status_code=201)
async def admin_book(body: AdminBookingIn, admin: Admin, conn: Conn):
    if (body.user_id is None) == (body.client is None):  # valida antes de abrir a transação
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha um cliente cadastrado ou informe o nome do cliente de balcão.")
    if body.receive in ("pix_online", "cartao_online"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha como o valor foi recebido no balcão.")
    # cliente novo + reserva na mesma transação: se o horário acabou de ser tomado, não sobra cliente órfão
    async with conn.transaction():
        owner = await resolve_client(conn, body.user_id, body.client)
        res = await svc.create(conn, owner, body.court_id, body.date, body.start, body.duration, "onsite", body.players, by_admin=True)
    # recebimento fora da transação: caixa fechado não desfaz a reserva, só deixa "a receber"
    warning = None
    if body.receive:
        try:
            await svc.mark_paid(conn, await svc.fetch(conn, res["code"]), channel=body.receive, admin_id=admin["id"], note=body.note)
        except HTTPException as e:
            warning = f"Reserva criada, mas o recebimento não foi lançado: {e.detail} Ela ficou como \"a receber\"."
    out = await svc.serialize(conn, await svc.fetch(conn, res["code"]), admin)
    return {**out, "warning": warning}
