"""Aplica migrations e popula dados iniciais (idempotente para config; demo opcional).

    python seed.py            # config + admin + demo
    python seed.py --no-demo  # só config e admin
"""

import asyncio
import random
import sys
from datetime import time, timedelta

from app import db
from app.domain import DEFAULT_SETTINGS, Pricer, day_infos, local_dt, now_local
from app.reservations import new_code
from app.security import hash_password

HOURS = [  # ISO weekday, abre, fecha — conforme o design
    *[(wd, time(12), time(13)) for wd in range(1, 6)],
    *[(wd, time(14), time(23)) for wd in range(1, 6)],
    (6, time(9), time(21)),
]

PRICE_RULES = [  # valores de exemplo — ajuste no painel admin
    ("Horário promocional", [1, 2, 3, 4, 5], False, time(12), time(18), 10000, 0, True),
    ("Horário nobre", [1, 2, 3, 4, 5], False, time(18), time(23, 59, 59), 14000, 0, False),
    ("Promoção fim de semana e feriado", [6, 7], True, time(0), time(23, 59, 59), 10000, 10, True),
]

HOLIDAYS = [  # (mês, dia, nome, aberto)
    (11, 2, "Finados", True), (11, 15, "Proclamação da República", True), (11, 20, "Consciência Negra", True),
    (12, 25, "Natal", False), (1, 1, "Confraternização Universal", False), (2, 2, "N. Sra. dos Navegantes", True),
]

DEMO_PLAYERS = ["Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Rocha", "Elisa Prado", "Felipe Costa", "Gabi Nunes"]


async def main(demo: bool) -> None:
    pool = await db.connect()
    async with pool.acquire() as conn:
        print("migrations:", await db.migrate(conn) or "nada novo")
        async with conn.transaction():
            for n in (1, 2, 3):
                await conn.execute(
                    "INSERT INTO courts (number, name) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING", n, f"Quadra {n}")
            if not await conn.fetchval("SELECT count(*) FROM business_hours"):
                await conn.executemany("INSERT INTO business_hours (weekday, opens, closes) VALUES ($1, $2, $3)", HOURS)
            if not await conn.fetchval("SELECT count(*) FROM price_rules"):
                await conn.executemany(
                    "INSERT INTO price_rules (label, weekdays, holidays, starts, ends, cents_per_hour, priority, is_promo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                    PRICE_RULES)
            for k, v in DEFAULT_SETTINGS.items():
                await conn.execute("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING", k, v)
            year = now_local().year
            for y in (year, year + 1):
                for m, d, name, open_ in HOLIDAYS:
                    await conn.execute(
                        "INSERT INTO holidays (day, name, open) VALUES (make_date($1, $2, $3), $4, $5) ON CONFLICT DO NOTHING",
                        y, m, d, name, open_)
            await conn.execute(
                """INSERT INTO users (name, email, password_hash, role) VALUES ('Administração', 'admin@padellobby.com.br', $1, 'admin')
                   ON CONFLICT (email) DO NOTHING""", hash_password("admin123"))

        if demo and not await conn.fetchval("SELECT count(*) FROM reservations"):
            await seed_demo(conn)
    await db.close()
    print("ok — admin: admin@padellobby.com.br / admin123 · jogador demo: jogador@padellobby.com.br / jogador123")


async def seed_demo(conn) -> None:
    rnd = random.Random(42)
    pw = hash_password("jogador123")
    me = await conn.fetchval(
        "INSERT INTO users (name, email, phone, password_hash) VALUES ('Você Jogador', 'jogador@padellobby.com.br', '(53) 99999-0000', $1) RETURNING id", pw)
    others = [
        await conn.fetchval("INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
                            n, n.lower().replace(" ", ".") + "@exemplo.com", pw)
        for n in DEMO_PLAYERS
    ]
    from app.domain import load_settings
    settings = await load_settings(conn)
    pricer = await Pricer.load(conn, settings)
    now = now_local()
    start = now.date() - timedelta(days=45)
    courts = [r["id"] for r in await conn.fetch("SELECT id FROM courts ORDER BY number")]
    # Jogador demo primeiro (como no design: próxima reserva confirmada, jogadas e uma cancelada).
    for days_ago, hh, court, dur, status in [(6, 10, 2, 90, "completed"), (9, 20, 1, 60, "completed"), (18, 18, 3, 60, "cancelled")]:
        d = now.date() - timedelta(days=days_ago)
        s = local_dt(d, time(hh))
        try:
            async with conn.transaction():
                rid = await conn.fetchval(
                    """INSERT INTO reservations (code, court_id, user_id, period, duration_min, status, payment_method, payment_status, price_cents)
                       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6, $7, 'pix', $8, $9) RETURNING id""",
                    new_code(), courts[court - 1], me, s, s + timedelta(minutes=dur), dur, status,
                    "paid" if status == "completed" else "void", pricer.quote(s, dur, False).cents)
                await conn.execute("INSERT INTO reservation_players (reservation_id, user_id, name, is_owner) VALUES ($1, $2, 'Você Jogador', true)", rid, me)
        except Exception:
            pass
    nxt = next(i for i in await day_infos(conn, now.date() + timedelta(days=1), 7) if i.open)
    s0 = local_dt(nxt.day, time(19) if nxt.day.isoweekday() <= 5 else time(10))
    rid = await conn.fetchval(
        """INSERT INTO reservations (code, court_id, user_id, period, duration_min, status, payment_method, payment_status, price_cents)
           VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), 60, 'confirmed', 'pix', 'paid', $6) RETURNING id""",
        new_code(), courts[0], me, s0, s0 + timedelta(minutes=60), pricer.quote(s0, 60, nxt.holiday is not None).cents)
    await conn.execute("INSERT INTO reservation_players (reservation_id, user_id, name, is_owner) VALUES ($1, $2, 'Você Jogador', true)", rid, me)
    await conn.execute("INSERT INTO reservation_players (reservation_id, user_id, name) VALUES ($1, $2, 'Bruno Lima')", rid, others[1])
    count = 0
    for info in await day_infos(conn, start, 45 + 5):
        future = info.day >= now.date()
        for o, c in info.intervals:
            h = o.hour
            while h + 1 <= c.hour:
                for court in courts:
                    peak = h >= 18 or info.day.isoweekday() == 6
                    if rnd.random() > (0.55 if peak else 0.3) * (0.7 if future else 1):
                        continue
                    dur = 90 if rnd.random() < 0.25 and h + 2 <= c.hour else 60
                    s = local_dt(info.day, time(h))
                    e = s + timedelta(minutes=dur)
                    if future and s <= now:
                        continue
                    if not future and e > now:
                        continue
                    owner = rnd.choice(others)
                    cancelled = not future and rnd.random() < 0.06
                    status = "cancelled" if cancelled else ("confirmed" if future else "completed")
                    method = rnd.choice(["pix", "pix", "card", "onsite"])
                    pay = "void" if cancelled else ("onsite" if method == "onsite" and future else "paid")
                    price = pricer.quote(s, dur, info.holiday is not None).cents
                    try:
                        async with conn.transaction():
                            rid = await conn.fetchval(
                                """INSERT INTO reservations (code, court_id, user_id, period, duration_min, status, payment_method, payment_status, price_cents, created_at)
                                   VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6, $7, $8, $9, $10, $4 - interval '2 days') RETURNING id""",
                                new_code(), court, owner, s, e, dur, status, method, pay, price)
                            name = await conn.fetchval("SELECT name FROM users WHERE id = $1", owner)
                            await conn.execute("INSERT INTO reservation_players (reservation_id, user_id, name, is_owner) VALUES ($1, $2, $3, true)", rid, owner, name)
                            count += 1
                    except Exception:
                        pass
                h += 1

    # Lançamentos financeiros das reservas pagas (o caixa e os relatórios leem payments).
    await conn.execute(
        """INSERT INTO payments (reservation_id, method, amount_cents, status, paid_at, refunded_at, channel)
           SELECT r.id, r.payment_method, r.price_cents, CASE r.payment_status WHEN 'refunded' THEN 'refunded' ELSE 'paid' END,
                  least(r.created_at, lower(r.period)), CASE WHEN r.payment_status = 'refunded' THEN r.cancelled_at END,
                  CASE r.payment_method WHEN 'pix' THEN 'pix_online' WHEN 'card' THEN 'cartao_online' ELSE 'dinheiro' END
           FROM reservations r
           WHERE r.payment_status IN ('paid', 'refunded')
             AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id = r.id AND p.status IN ('paid', 'refunded'))""")
    await conn.execute(
        "INSERT INTO notifications (user_id, kind, title, body, link) VALUES ($1, 'welcome', 'Bem-vindo ao Padel Lobby', 'Reserve sua quadra em segundos e convide a galera pelo WhatsApp.', '/agenda')", me)
    print(f"demo: {count} reservas geradas")


if __name__ == "__main__":
    asyncio.run(main(demo="--no-demo" not in sys.argv))
