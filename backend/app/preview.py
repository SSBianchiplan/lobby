"""Prévia de link (Open Graph) para WhatsApp/redes: o SPA é um index.html só, então o servidor injeta as tags
na resposta — genéricas em todas as páginas e com os dados do jogo nos links de convite."""

import html
import re

import asyncpg

from .config import get_settings
from .domain import WEEKDAY_SHORT, load_settings

INVITE = re.compile(r"^convite/([0-9a-fA-F-]{36})/?$")
DEFAULT_IMAGE = "/quadras/quadra-vidro-og.jpg"


def _money(cents: int) -> str:
    return f"R$ {cents / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


async def invite_meta(conn: asyncpg.Connection, token: str) -> dict | None:
    r = await conn.fetchrow(
        """SELECT r.status, lower(r.period) AS s, upper(r.period) AS e, r.price_cents, c.name AS court, c.photo,
                  (SELECT count(*) FROM reservation_players p WHERE p.reservation_id = r.id) AS players
           FROM reservations r JOIN courts c ON c.id = r.court_id WHERE r.invite_token::text = $1""", token.lower())
    if r is None or r["status"] not in ("pending", "confirmed"):
        return None
    tz = get_settings().tz
    s, e = r["s"].astimezone(tz), r["e"].astimezone(tz)
    max_players = int((await load_settings(conn))["max_players"])
    open_ = max(0, max_players - r["players"])
    spots = "Time completo" if open_ == 0 else "Falta só 1 vaga!" if open_ == 1 else f"Faltam {open_} vagas"
    when = f"{WEEKDAY_SHORT[s.weekday()].title()} {s:%d/%m} · {s:%H:%M}–{e:%H:%M}"
    return {
        "title": f"🎾 Bora jogar? {r['court']} · {when}",
        "description": f"{spots} · {_money(r['price_cents'] // max(1, max_players))} por jogador · Padel Lobby, Centro de Rio Grande. Toque para confirmar sua vaga.",
        "image": (r["photo"] or "").replace("-1600.webp", "-og.jpg") or DEFAULT_IMAGE,
    }


def render(index_html: str, base_url: str, url: str, meta: dict | None) -> str:
    m = meta or {
        "title": "Padel Lobby — Reservas",
        "description": "Reserve quadras de padel cobertas no Centro de Rio Grande (RS): horários livres na hora, Pix e convite para a galera.",
        "image": DEFAULT_IMAGE,
    }
    t, d = html.escape(m["title"]), html.escape(m["description"])
    img = html.escape(base_url.rstrip("/") + m["image"])
    tags = (
        f'<meta property="og:type" content="website">\n<meta property="og:site_name" content="Padel Lobby">\n'
        f'<meta property="og:title" content="{t}">\n<meta property="og:description" content="{d}">\n'
        f'<meta property="og:url" content="{html.escape(url)}">\n<meta property="og:image" content="{img}">\n'
        f'<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
        f'<meta property="og:locale" content="pt_BR">\n<meta name="twitter:card" content="summary_large_image">\n'
    )
    out = re.sub(r"<title>.*?</title>", f"<title>{t}</title>", index_html, count=1, flags=re.S)
    out = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{d}">', out, count=1)
    return out.replace("</head>", tags + "</head>", 1)
