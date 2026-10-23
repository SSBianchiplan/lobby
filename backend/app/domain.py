"""Regras de negócio: configurações do clube, horário de funcionamento, preço e disponibilidade."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

import asyncpg

from .config import get_settings

ACTIVE_STATUSES = ("pending", "confirmed", "checked_in", "completed")
WEEKDAY_SHORT = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"]

DEFAULT_SETTINGS: dict = {
    "club_name": "Padel Lobby",
    "address": "Praça Sete de Setembro, 184",
    "district": "Centro · Rio Grande, RS · 96200-120",
    "maps_url": "https://maps.google.com/?q=Pra%C3%A7a+Sete+de+Setembro+184+Rio+Grande+RS",
    "email": "padellobby@gmail.com",
    "whatsapp": "",
    "amenities": ["Churrasqueira", "Bar", "Vestiário", "Wi-Fi", "TV a cabo"],
    "promo_text": "sábado, domingo e feriados valem para todos os horários.",
    "durations": [60, 90],
    "slot_step_minutes": 60,
    "booking_horizon_days": 14,
    "cancel_free_hours": 6,
    "pending_hold_minutes": 15,
    "max_players": 4,
    "max_active_per_user": 3,
    "default_cents_per_hour": 12000,
    "pix_key": "padellobby@gmail.com",
    "pix_merchant_name": "PADEL LOBBY",
    "pix_merchant_city": "RIO GRANDE",
}


async def load_settings(conn: asyncpg.Connection) -> dict:
    rows = await conn.fetch("SELECT key, value FROM settings")
    return {**DEFAULT_SETTINGS, **{r["key"]: r["value"] for r in rows}}


def now_local() -> datetime:
    return datetime.now(get_settings().tz)


def local_dt(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=get_settings().tz)


# ── Horário de funcionamento ────────────────────────────────────────────────

@dataclass
class DayInfo:
    day: date
    intervals: list[tuple[time, time]]
    holiday: str | None = None

    @property
    def open(self) -> bool:
        return bool(self.intervals)

    def fits(self, start: time, minutes: int) -> bool:
        s = start.hour * 60 + start.minute
        return any(_m(o) <= s and s + minutes <= _m(c) for o, c in self.intervals)

    def inside(self, start: time) -> bool:
        s = _m(start)
        return any(_m(o) <= s < _m(c) for o, c in self.intervals)


def _m(t: time) -> int:
    # 23:59:59 conta como fim do dia
    return 24 * 60 if (t.hour, t.minute, t.second) == (23, 59, 59) else t.hour * 60 + t.minute


async def day_infos(conn: asyncpg.Connection, start: date, days: int) -> list[DayInfo]:
    end = start + timedelta(days=days)
    hours = await conn.fetch("SELECT weekday, opens, closes FROM business_hours ORDER BY weekday, opens")
    by_wd: dict[int, list[tuple[time, time]]] = {}
    for h in hours:
        by_wd.setdefault(h["weekday"], []).append((h["opens"], h["closes"]))
    hols = {
        r["day"]: r
        for r in await conn.fetch("SELECT * FROM holidays WHERE day >= $1 AND day < $2", start, end)
    }
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        h = hols.get(d)
        if h is None:
            out.append(DayInfo(d, by_wd.get(d.isoweekday(), [])))
        elif not h["open"]:
            out.append(DayInfo(d, [], h["name"]))
        elif h["opens"] and h["closes"]:
            out.append(DayInfo(d, [(h["opens"], h["closes"])], h["name"]))
        else:
            out.append(DayInfo(d, by_wd.get(6, []), h["name"]))
    return out


async def day_info(conn: asyncpg.Connection, d: date) -> DayInfo:
    return (await day_infos(conn, d, 1))[0]


# ── Preço ───────────────────────────────────────────────────────────────────

@dataclass
class Quote:
    cents: int
    promo: bool
    lines: list[dict] = field(default_factory=list)


class Pricer:
    def __init__(self, rules: list[asyncpg.Record], default_cents: int):
        self.rules = sorted(rules, key=lambda r: -r["priority"])
        self.default = default_cents

    @classmethod
    async def load(cls, conn: asyncpg.Connection, settings: dict) -> Pricer:
        return cls(await conn.fetch("SELECT * FROM price_rules"), int(settings["default_cents_per_hour"]))

    def _rule(self, at: datetime, holiday: bool):
        t = at.time()
        for r in self.rules:
            day_ok = (holiday and r["holidays"]) or at.isoweekday() in (r["weekdays"] or [])
            if day_ok and r["starts"] <= t < r["ends"]:
                return r
        return None

    def quote(self, start: datetime, minutes: int, holiday: bool) -> Quote:
        """Avalia o preço em fatias de 30 min (uma reserva pode cruzar faixas)."""
        total, promo, lines = 0, False, {}
        for k in range(0, minutes, 30):
            r = self._rule(start + timedelta(minutes=k), holiday)
            per_hour = r["cents_per_hour"] if r else self.default
            label = r["label"] if r else "Locação"
            promo = promo or bool(r and r["is_promo"])
            line = lines.setdefault(label, {"label": label, "minutes": 0, "cents": 0, "cents_per_hour": per_hour})
            line["minutes"] += 30
            line["cents"] += per_hour // 2
            total += per_hour // 2
        return Quote(total, promo, list(lines.values()))


# ── Disponibilidade ─────────────────────────────────────────────────────────

async def busy_ranges(conn: asyncpg.Connection, start: datetime, end: datetime):
    """Reservas ativas (holds expirados não contam) e bloqueios num intervalo."""
    res = await conn.fetch(
        """
        SELECT court_id, lower(period) AS s, upper(period) AS e, user_id
        FROM reservations
        WHERE period && tstzrange($1, $2)
          AND status IN ('pending', 'confirmed', 'checked_in', 'completed')
          AND NOT (status = 'pending' AND hold_expires_at < now())
        """,
        start, end,
    )
    blocks = await conn.fetch(
        "SELECT court_id, lower(period) AS s, upper(period) AS e, reason FROM blocks WHERE period && tstzrange($1, $2)",
        start, end,
    )
    return res, blocks


async def availability(conn: asyncpg.Connection, d: date, duration: int, user_id: int | None = None) -> dict:
    settings = await load_settings(conn)
    info = await day_info(conn, d)
    courts = await conn.fetch("SELECT id, number, name, description FROM courts WHERE active ORDER BY number")
    base = {
        "date": d.isoformat(),
        "weekday": WEEKDAY_SHORT[d.weekday()],
        "duration": duration,
        "holiday": info.holiday,
        "open": info.open,
        "intervals": [[o.strftime("%H:%M"), c.strftime("%H:%M")] for o, c in info.intervals],
        "courts": [dict(c) for c in courts],
        "rows": [],
    }
    if not info.open:
        return base

    step = int(settings["slot_step_minutes"])
    now = now_local()
    horizon = now.date() + timedelta(days=int(settings["booking_horizon_days"]))
    pricer = await Pricer.load(conn, settings)
    day_start, day_end = local_dt(d, time(0)), local_dt(d, time(0)) + timedelta(days=1)
    res, blocks = await busy_ranges(conn, day_start, day_end)

    first = min(_m(o) for o, _ in info.intervals)
    last = max(_m(c) for _, c in info.intervals)
    for minute in range(first, last - step + 1, step):
        t = time(minute // 60, minute % 60)
        start = local_dt(d, t)
        end = start + timedelta(minutes=duration)
        row = {"time": t.strftime("%H:%M"), "break": not info.inside(t), "slots": []}
        if row["break"]:
            nxt = min((_m(o) for o, _ in info.intervals if _m(o) > minute), default=minute + step)
            row["until"] = f"{nxt // 60:02d}:{nxt % 60:02d}"
            base["rows"].append(row)
            continue
        quote = pricer.quote(start, duration, info.holiday is not None)
        for c in courts:
            st, mine = "free", False
            if start <= now:
                st = "past"
            elif d > horizon:
                st = "closed"
            elif not info.fits(t, duration):
                st = "nofit"
            else:
                for b in blocks:
                    if (b["court_id"] in (None, c["id"])) and b["s"] < end and start < b["e"]:
                        st = "blocked"
                        break
                if st == "free":
                    for r in res:
                        if r["court_id"] == c["id"] and r["s"] < end and start < r["e"]:
                            st, mine = "busy", (user_id is not None and r["user_id"] == user_id)
                            break
            row["slots"].append({"court_id": c["id"], "status": st, "mine": mine, "price_cents": quote.cents, "promo": quote.promo})
        base["rows"].append(row)
    return base


async def calendar(conn: asyncpg.Connection, start: date, days: int) -> list[dict]:
    """Resumo por dia para os seletores de data: aberto, feriado e quantos horários livres (60 min)."""
    out = []
    for info in await day_infos(conn, start, days):
        free = 0
        if info.open:
            av = await availability(conn, info.day, 60)
            free = sum(1 for r in av["rows"] for s in r["slots"] if s["status"] == "free")
        out.append({
            "date": info.day.isoformat(),
            "weekday": WEEKDAY_SHORT[info.day.weekday()],
            "day": info.day.day,
            "open": info.open,
            "holiday": info.holiday,
            "free": free,
        })
    return out
