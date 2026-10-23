"""Log de visitantes do site (registro anônimo de páginas) e consulta dos logs pela administração."""

import re
import time
import uuid
from collections import defaultdict, deque
from datetime import date, time as dtime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from ..audit import client_ip, ip_prefix, parse_ua
from ..config import get_settings
from ..deps import Admin, Conn, _user_from_request
from ..domain import local_dt, now_local

router = APIRouter(prefix="/api", tags=["logs"])

# tokens e códigos não vão para o log: /convite/<uuid> → /convite/:token
_TOKENS = [(re.compile(r"^/(convite|aluno|professor)/[0-9a-fA-F-]{8,}"), r"/\1/:token"),
           (re.compile(r"^/(checkin|reservas)/PL-[A-Z0-9]{5}", re.I), r"/\1/:codigo")]
_HITS: dict[str, deque[float]] = defaultdict(deque)


def _clean_path(path: str) -> str:
    p = "/" + path.split("?")[0].split("#")[0].lstrip("/")
    for rx, repl in _TOKENS:
        p = rx.sub(repl, p)
    return p[:200]


def _ref_host(ref: str | None, own: str) -> str | None:
    if not ref:
        return None
    m = re.match(r"^https?://([^/]+)", ref)
    host = m.group(1).lower() if m else None
    return None if not host or host == own else host[:120]


class TrackIn(BaseModel):
    path: str = Field(max_length=500)
    referrer: str | None = Field(default=None, max_length=500)
    visitor: uuid.UUID
    session: uuid.UUID


@router.post("/track", status_code=204)
async def track(body: TrackIn, request: Request, conn: Conn):
    """Visualização de página. Sem login obrigatório; 60 por minuto por IP."""
    ip = client_ip(request) or "?"
    hits = _HITS[ip]
    while hits and hits[0] < time.monotonic() - 60:
        hits.popleft()
    if len(hits) >= 60:
        return None
    hits.append(time.monotonic())
    try:
        user = await _user_from_request(request, conn)
    except HTTPException:
        user = None  # token vencido não impede o registro anônimo
    ua = parse_ua(request.headers.get("user-agent", ""))
    await conn.execute(
        """INSERT INTO page_views (visitor, session, user_id, path, referrer, ip_prefix, device, browser, os, is_bot)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
        body.visitor, body.session, user["id"] if user else None, _clean_path(body.path),
        _ref_host(body.referrer, request.headers.get("host", "").lower()), ip_prefix(ip if ip != "?" else None),
        ua["device"], ua["browser"], ua["os"], ua["is_bot"])
    return None


def _bounds(start: date | None, end: date | None) -> tuple[date, date]:
    today = now_local().date()
    start = start or today - timedelta(days=6)
    end = end or today + timedelta(days=1)
    if end <= start or (end - start).days > 366:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Período inválido.")
    return start, end


@router.get("/admin/logs/visitors")
async def visitors(_: Admin, conn: Conn, start: date | None = None, end: date | None = None, bots: bool = False):
    start, end = _bounds(start, end)
    s, e = local_dt(start, dtime(0)), local_dt(end, dtime(0))
    tz = get_settings().tz
    W = "at >= $1 AND at < $2 AND ($3 OR NOT is_bot)"
    tot = await conn.fetchrow(
        f"""SELECT count(*) AS views, count(DISTINCT visitor) AS visitors, count(DISTINCT session) AS sessions,
                   count(DISTINCT visitor) FILTER (WHERE user_id IS NOT NULL) AS logged,
                   (SELECT count(*) FROM page_views WHERE at >= $1 AND at < $2 AND is_bot) AS bot_views
            FROM page_views WHERE {W}""", s, e, bots)
    # visitante novo = primeira visita dentro do período (aproximação útil sem cookie de longo prazo)
    new = await conn.fetchval(
        f"""SELECT count(*) FROM (SELECT visitor, min(at) AS first FROM page_views GROUP BY visitor) f
            WHERE f.first >= $1 AND f.first < $2""", s, e)

    async def group(expr: str, order: str = "2 DESC", limit: int = 10):
        return [dict(r) for r in await conn.fetch(
            f"SELECT {expr} AS key, count(*) AS views, count(DISTINCT visitor) AS visitors FROM page_views WHERE {W} GROUP BY 1 ORDER BY {order} LIMIT {limit}",
            s, e, bots)]

    by_day = await conn.fetch(
        f"""SELECT (at AT TIME ZONE '{get_settings().timezone}')::date AS day, count(*) AS views, count(DISTINCT visitor) AS visitors
            FROM page_views WHERE {W} GROUP BY 1 ORDER BY 1""", s, e, bots)
    recent = await conn.fetch(
        f"""SELECT p.at, p.path, p.referrer, p.device, p.browser, p.os, p.ip_prefix, p.is_bot, left(p.visitor::text, 8) AS visitor, u.name AS user_name
            FROM page_views p LEFT JOIN users u ON u.id = p.user_id WHERE {W.replace('at ', 'p.at ').replace('is_bot', 'p.is_bot')}
            ORDER BY p.at DESC LIMIT 60""", s, e, bots)
    return {
        "start": start.isoformat(), "end": end.isoformat(), **dict(tot), "new_visitors": new,
        "pages_per_session": round(tot["views"] / tot["sessions"], 2) if tot["sessions"] else 0,
        "by_day": [{**dict(r), "day": r["day"].isoformat()} for r in by_day],
        "by_hour": await group(f"extract(hour FROM at AT TIME ZONE '{get_settings().timezone}')::int", "1", 24),
        "pages": await group("path"),
        "referrers": await group("coalesce(referrer, 'Direto / sem origem')"),
        "devices": await group("device"),
        "browsers": await group("browser"),
        "os": await group("os"),
        "recent": [{**dict(r), "at": r["at"].astimezone(tz).isoformat()} for r in recent],
    }


EVENTS = ["login_ok", "login_fail", "login_locked", "login_inactive", "register", "password_change", "logout_all",
          "password_reset", "account_disabled", "account_enabled", "account_deleted", "user_created"]


@router.get("/admin/logs/access")
async def access(_: Admin, conn: Conn, start: date | None = None, end: date | None = None,
                 event: str | None = None, q: str = "", limit: int = Query(200, ge=1, le=1000)):
    start, end = _bounds(start, end)
    s, e = local_dt(start, dtime(0)), local_dt(end, dtime(0))
    if event and event not in EVENTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Evento inválido.")
    tz = get_settings().tz
    rows = await conn.fetch(
        """SELECT l.id, l.at, l.event, l.email, l.ip, l.user_agent, u.name AS user_name, a.name AS actor_name
           FROM access_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
           WHERE l.at >= $1 AND l.at < $2 AND ($3::text IS NULL OR l.event = $3)
             AND ($4 = '' OR l.email ILIKE '%' || $4 || '%' OR l.ip ILIKE $4 || '%' OR u.name ILIKE '%' || $4 || '%')
           ORDER BY l.at DESC LIMIT $5""", s, e, event or None, q.strip(), limit)
    counts = await conn.fetch("SELECT event, count(*) AS n FROM access_log WHERE at >= $1 AND at < $2 GROUP BY 1", s, e)
    fails = await conn.fetch(
        """SELECT email, count(*) AS n, max(at) AS last FROM access_log
           WHERE at >= $1 AND at < $2 AND event IN ('login_fail', 'login_locked') GROUP BY email ORDER BY 2 DESC LIMIT 8""", s, e)
    ips = await conn.fetch(
        """SELECT ip, count(*) AS n FROM access_log WHERE at >= $1 AND at < $2 AND event IN ('login_fail', 'login_locked') AND ip IS NOT NULL
           GROUP BY ip ORDER BY 2 DESC LIMIT 8""", s, e)
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "counts": {r["event"]: r["n"] for r in counts},
        "top_failed_emails": [{**dict(r), "last": r["last"].astimezone(tz).isoformat()} for r in fails],
        "top_failed_ips": [dict(r) for r in ips],
        "items": [{**dict(r), "at": r["at"].astimezone(tz).isoformat(), **parse_ua(r["user_agent"] or "")} for r in rows],
    }
