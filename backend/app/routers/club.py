from datetime import date, time

from fastapi import APIRouter, Query

from .. import reservations as svc
from ..deps import Conn, MaybeUser
from ..domain import availability, calendar, load_settings, now_local

router = APIRouter(prefix="/api", tags=["agenda"])

PUBLIC_KEYS = ("club_name", "address", "district", "maps_url", "email", "whatsapp", "amenities", "promo_text",
               "durations", "booking_horizon_days", "cancel_free_hours", "pending_hold_minutes", "max_players")


@router.get("/club")
async def club(conn: Conn):
    s = await load_settings(conn)
    courts = await conn.fetch("SELECT id, number, name, description, surface FROM courts WHERE active ORDER BY number")
    hours = await conn.fetch("SELECT weekday, to_char(opens, 'HH24:MI') AS opens, to_char(closes, 'HH24:MI') AS closes FROM business_hours ORDER BY weekday, opens")
    prices = await conn.fetch(
        "SELECT label, weekdays, holidays, to_char(starts, 'HH24:MI') AS starts, to_char(ends, 'HH24:MI') AS ends, cents_per_hour, is_promo FROM price_rules ORDER BY priority DESC, starts"
    )
    return {
        **{k: s[k] for k in PUBLIC_KEYS},
        "courts": [dict(c) for c in courts],
        "hours": [dict(h) for h in hours],
        "prices": [dict(p) for p in prices],
        "today": now_local().date().isoformat(),
    }


@router.get("/calendar")
async def get_calendar(conn: Conn, start: date | None = None, days: int = Query(7, ge=1, le=31)):
    return await calendar(conn, start or now_local().date(), days)


@router.get("/availability")
async def get_availability(conn: Conn, user: MaybeUser, day: date = Query(alias="date"), duration: int = 60):
    return await availability(conn, day, duration, user["id"] if user else None)


@router.get("/quote")
async def get_quote(conn: Conn, court_id: int, day: date = Query(alias="date"), start: time = Query(), duration: int = 60):
    return await svc.quote(conn, court_id, day, start, duration)
