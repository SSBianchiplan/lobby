import csv
import io
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from .. import reservations as svc
from ..deps import Admin, Conn
from ..domain import DEFAULT_SETTINGS, day_infos, load_settings, local_dt, now_local

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _range(start: date | None, end: date | None) -> tuple[date, date]:
    today = now_local().date()
    start = start or today.replace(day=1)
    end = end or (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    if end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Período inválido.")
    return start, end


@router.get("/dashboard")
async def dashboard(_: Admin, conn: Conn, start: date | None = None, end: date | None = None):
    start, end = _range(start, end)
    s, e = local_dt(start, time(0)), local_dt(end, time(0))
    totals = await conn.fetchrow(
        """
        SELECT count(*) FILTER (WHERE status IN ('confirmed', 'checked_in', 'completed')) AS bookings,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(*) FILTER (WHERE status = 'expired') AS expired,
               count(*) FILTER (WHERE status = 'pending') AS pending,
               coalesce(sum(price_cents) FILTER (WHERE payment_status = 'paid'), 0) AS revenue_cents,
               coalesce(sum(price_cents) FILTER (WHERE payment_status = 'onsite' AND status <> 'cancelled'), 0) AS receivable_cents,
               coalesce(sum(duration_min) FILTER (WHERE status IN ('confirmed', 'checked_in', 'completed')), 0) AS booked_minutes,
               count(DISTINCT user_id) FILTER (WHERE status IN ('confirmed', 'checked_in', 'completed')) AS players
        FROM reservations WHERE lower(period) >= $1 AND lower(period) < $2
        """,
        s, e,
    )
    n_courts = await conn.fetchval("SELECT count(*) FROM courts WHERE active")
    open_minutes = 0
    for info in await day_infos(conn, start, (end - start).days):
        open_minutes += sum((c.hour * 60 + c.minute) - (o.hour * 60 + o.minute) for o, c in info.intervals)
    capacity = open_minutes * n_courts
    by_court = await conn.fetch(
        """
        SELECT c.name, coalesce(sum(r.duration_min), 0) AS minutes, count(r.id) AS bookings,
               coalesce(sum(r.price_cents) FILTER (WHERE r.payment_status = 'paid'), 0) AS revenue_cents
        FROM courts c LEFT JOIN reservations r ON r.court_id = c.id
             AND r.status IN ('confirmed', 'checked_in', 'completed') AND lower(r.period) >= $1 AND lower(r.period) < $2
        WHERE c.active GROUP BY c.id ORDER BY c.number
        """,
        s, e,
    )
    heat = await conn.fetch(
        """
        SELECT extract(isodow FROM lower(period))::int AS weekday, extract(hour FROM lower(period))::int AS hour, count(*) AS n
        FROM reservations WHERE status IN ('confirmed', 'checked_in', 'completed') AND lower(period) >= $1 AND lower(period) < $2
        GROUP BY 1, 2
        """,
        s, e,
    )
    daily = await conn.fetch(
        """
        SELECT lower(period)::date AS day, count(*) AS bookings, coalesce(sum(price_cents) FILTER (WHERE payment_status = 'paid'), 0) AS revenue_cents
        FROM reservations WHERE status IN ('confirmed', 'checked_in', 'completed') AND lower(period) >= $1 AND lower(period) < $2
        GROUP BY 1 ORDER BY 1
        """,
        s, e,
    )
    top = await conn.fetch(
        """
        SELECT u.name, count(*) AS bookings, sum(r.duration_min) AS minutes
        FROM reservations r JOIN users u ON u.id = r.user_id
        WHERE r.status IN ('confirmed', 'checked_in', 'completed') AND lower(r.period) >= $1 AND lower(r.period) < $2
        GROUP BY u.id ORDER BY 2 DESC, 3 DESC LIMIT 5
        """,
        s, e,
    )
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        **dict(totals),
        "capacity_minutes": capacity,
        "occupancy": round(totals["booked_minutes"] / capacity, 4) if capacity else 0,
        "by_court": [{**dict(r), "occupancy": round(r["minutes"] / open_minutes, 4) if open_minutes else 0} for r in by_court],
        "heat": [dict(r) for r in heat],
        "daily": [{**dict(r), "day": r["day"].isoformat()} for r in daily],
        "top_players": [dict(r) for r in top],
    }


@router.get("/schedule")
async def schedule(admin: Admin, conn: Conn, day: date = Query(alias="date")):
    s = local_dt(day, time(0))
    rows = await conn.fetch(
        svc.SELECT_RESERVATION + " WHERE r.period && tstzrange($1, $2) AND r.status <> 'expired' ORDER BY lower(r.period), c.number",
        s, s + timedelta(days=1),
    )
    blocks = await conn.fetch(
        """SELECT b.id, b.court_id, to_char(lower(b.period), 'DD/MM HH24:MI') AS starts, to_char(upper(b.period), 'DD/MM HH24:MI') AS ends, b.reason
           FROM blocks b WHERE b.period && tstzrange($1, $2) ORDER BY lower(b.period)""",
        s, s + timedelta(days=1),
    )
    settings = await load_settings(conn)
    return {
        "date": day.isoformat(),
        "reservations": [await svc.serialize(conn, r, admin, settings) for r in rows],
        "blocks": [dict(b) for b in blocks],
    }


@router.get("/reservations")
async def search(admin: Admin, conn: Conn, q: str = "", status_: str | None = Query(None, alias="status"), limit: int = Query(50, le=200)):
    rows = await conn.fetch(
        svc.SELECT_RESERVATION
        + """ WHERE ($1 = '' OR r.code ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%')
               AND ($2::text IS NULL OR r.status = $2)
              ORDER BY lower(r.period) DESC LIMIT $3""",
        q.strip(), status_, limit,
    )
    settings = await load_settings(conn)
    return [await svc.serialize(conn, r, admin, settings) for r in rows]


class CheckinIn(BaseModel):
    code: str


@router.post("/checkin")
async def checkin(body: CheckinIn, admin: Admin, conn: Conn):
    r = await svc.fetch(conn, body.code.strip())
    if r["status"] == "checked_in":
        raise HTTPException(status.HTTP_409_CONFLICT, "Check-in já realizado.")
    if r["status"] != "confirmed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Reserva com status '{r['status']}' não permite check-in.")
    now = now_local()
    opens = r["starts_at"] - timedelta(minutes=60)
    if now < opens:
        when = f"{opens:%H:%M}" if opens.date() == now.date() else f"{opens:%d/%m às %H:%M}"
        raise HTTPException(status.HTTP_409_CONFLICT, f"Cedo demais: o check-in abre {'às ' if opens.date() == now.date() else 'em '}{when} (1 h antes do jogo).")
    if now > r["ends_at"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Esse jogo terminou às {r['ends_at']:%H:%M}.")
    await conn.execute("UPDATE reservations SET status = 'checked_in', checked_in_at = now() WHERE id = $1", r["id"])
    return await svc.serialize(conn, await svc.fetch(conn, r["code"]), admin)


@router.post("/reservations/{code}/mark-paid")
async def mark_paid(code: str, admin: Admin, conn: Conn):
    await svc.mark_paid(conn, await svc.fetch(conn, code))
    return await svc.serialize(conn, await svc.fetch(conn, code), admin)


# ── Bloqueios ───────────────────────────────────────────────────────────────

class BlockIn(BaseModel):
    court_id: int | None = None
    date: date
    start: time
    end: time
    reason: str = Field(min_length=2, max_length=120)


@router.post("/blocks", status_code=201)
async def create_block(body: BlockIn, admin: Admin, conn: Conn):
    if body.end <= body.start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Fim deve ser depois do início.")
    s, e = local_dt(body.date, body.start), local_dt(body.date, body.end)
    clash = await conn.fetchval(
        """SELECT string_agg(code, ', ') FROM reservations
           WHERE ($1::smallint IS NULL OR court_id = $1) AND period && tstzrange($2, $3)
             AND status IN ('pending', 'confirmed', 'checked_in')""",
        body.court_id, s, e,
    )
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Há reservas nesse período: {clash}. Cancele-as antes de bloquear.")
    bid = await conn.fetchval(
        "INSERT INTO blocks (court_id, period, reason, created_by) VALUES ($1, tstzrange($2, $3, '[)'), $4, $5) RETURNING id",
        body.court_id, s, e, body.reason, admin["id"],
    )
    return {"id": bid}


@router.delete("/blocks/{block_id}")
async def delete_block(block_id: int, _: Admin, conn: Conn):
    await conn.execute("DELETE FROM blocks WHERE id = $1", block_id)
    return {"ok": True}


# ── Preços, feriados, configurações ────────────────────────────────────────

class PriceRuleIn(BaseModel):
    label: str = Field(min_length=2, max_length=60)
    weekdays: list[int] = Field(default_factory=list)
    holidays: bool = False
    starts: time
    ends: time
    cents_per_hour: int = Field(gt=0, le=10_000_00)
    priority: int = 0
    is_promo: bool = False


@router.get("/price-rules")
async def list_rules(_: Admin, conn: Conn):
    rows = await conn.fetch("SELECT * FROM price_rules ORDER BY priority DESC, starts")
    return [{**dict(r), "starts": r["starts"].strftime("%H:%M"), "ends": r["ends"].strftime("%H:%M:%S")} for r in rows]


@router.put("/price-rules")
async def replace_rules(rules: list[PriceRuleIn], _: Admin, conn: Conn):
    async with conn.transaction():
        await conn.execute("DELETE FROM price_rules")
        for r in rules:
            if any(w < 1 or w > 7 for w in r.weekdays) or r.ends <= r.starts:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Regra inválida: {r.label}")
            await conn.execute(
                "INSERT INTO price_rules (label, weekdays, holidays, starts, ends, cents_per_hour, priority, is_promo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                r.label, r.weekdays, r.holidays, r.starts, r.ends, r.cents_per_hour, r.priority, r.is_promo,
            )
    return await list_rules(_, conn)


class HolidayIn(BaseModel):
    day: date
    name: str = Field(min_length=2, max_length=80)
    open: bool = True


@router.get("/holidays")
async def list_holidays(_: Admin, conn: Conn):
    return [{**dict(r), "day": r["day"].isoformat()} for r in await conn.fetch(
        "SELECT day, name, open FROM holidays WHERE day >= current_date - 30 ORDER BY day")]


@router.post("/holidays", status_code=201)
async def upsert_holiday(body: HolidayIn, _: Admin, conn: Conn):
    await conn.execute(
        "INSERT INTO holidays (day, name, open) VALUES ($1, $2, $3) ON CONFLICT (day) DO UPDATE SET name = $2, open = $3",
        body.day, body.name, body.open,
    )
    return {"ok": True}


@router.delete("/holidays/{day}")
async def delete_holiday(day: date, _: Admin, conn: Conn):
    await conn.execute("DELETE FROM holidays WHERE day = $1", day)
    return {"ok": True}


@router.get("/settings")
async def get_all_settings(_: Admin, conn: Conn):
    return await load_settings(conn)


@router.put("/settings")
async def put_settings(body: dict, _: Admin, conn: Conn):
    unknown = set(body) - set(DEFAULT_SETTINGS)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Chaves desconhecidas: {', '.join(sorted(unknown))}")
    for k, v in body.items():
        if not isinstance(v, type(DEFAULT_SETTINGS[k])):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Tipo inválido para {k}")
    async with conn.transaction():
        for k, v in body.items():
            await conn.execute(
                "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", k, v)
    return await load_settings(conn)


@router.get("/reports/reservations.csv")
async def export_csv(_: Admin, conn: Conn, start: date | None = None, end: date | None = None):
    start, end = _range(start, end)
    rows = await conn.fetch(
        svc.SELECT_RESERVATION + " WHERE lower(r.period) >= $1 AND lower(r.period) < $2 ORDER BY lower(r.period)",
        local_dt(start, time(0)), local_dt(end, time(0)),
    )
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["codigo", "data", "inicio", "fim", "quadra", "cliente", "email", "status", "pagamento", "situacao_pagamento", "valor"])
    for r in map(svc.localize, rows):
        w.writerow([r["code"], r["starts_at"].strftime("%d/%m/%Y"), r["starts_at"].strftime("%H:%M"), r["ends_at"].strftime("%H:%M"),
                    r["court_name"], r["owner_name"], r["owner_email"], r["status"], r["payment_method"], r["payment_status"],
                    f"{r['price_cents'] / 100:.2f}".replace(".", ",")])
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="reservas-{start}-{end}.csv"'})


class CourtPhotoIn(BaseModel):
    photo: str | None


@router.put("/courts/{court_id}/photo")
async def set_court_photo(court_id: int, body: CourtPhotoIn, _: Admin, conn: Conn):
    from .club import GALLERY
    if body.photo is not None and body.photo not in {g["src"] for g in GALLERY}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escolha uma das fotos da galeria.")
    if await conn.execute("UPDATE courts SET photo = $2 WHERE id = $1", court_id, body.photo) == "UPDATE 0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quadra não encontrada.")
    return {"ok": True}
