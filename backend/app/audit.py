"""Logs: acessos (segurança da conta) e visitantes do site (estatística, sem dado pessoal direto)."""

import re

import asyncpg
from fastapi import Request

BOT = re.compile(r"bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|httpx|headless|lighthouse|monitor", re.I)


def client_ip(request: Request | None) -> str | None:
    # uvicorn com --proxy-headers já troca pelo X-Forwarded-For do Caddy
    return request.client.host if request and request.client else None


def ip_prefix(ip: str | None) -> str | None:
    """IP truncado (LGPD): 189.4.12.77 → 189.4.12.x; IPv6 → primeiros 3 blocos."""
    if not ip:
        return None
    if ":" in ip:
        return ":".join(ip.split(":")[:3]) + ":x"
    parts = ip.split(".")
    return ".".join(parts[:3]) + ".x" if len(parts) == 4 else None


def parse_ua(ua: str) -> dict:
    u = ua or ""
    device = "tablet" if re.search(r"iPad|Tablet|(Android(?!.*Mobile))", u) else "mobile" if re.search(r"Mobi|iPhone|Android", u) else "desktop"
    browser = next((name for pat, name in [(r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"SamsungBrowser", "Samsung"),
                                            (r"Firefox/", "Firefox"), (r"CriOS|Chrome/", "Chrome"), (r"Safari/", "Safari")] if re.search(pat, u)), "Outro")
    os_ = next((name for pat, name in [(r"iPhone|iPad|iPod", "iOS"), (r"Android", "Android"), (r"Windows", "Windows"),
                                        (r"Mac OS X|Macintosh", "macOS"), (r"Linux", "Linux")] if re.search(pat, u)), "Outro")
    return {"device": device, "browser": browser, "os": os_, "is_bot": bool(BOT.search(u))}


async def log_access(conn: asyncpg.Connection, request: Request | None, event: str, *, user_id: int | None = None,
                     email: str | None = None, actor_id: int | None = None) -> None:
    ua = (request.headers.get("user-agent", "") if request else "")[:300]
    await conn.execute(
        "INSERT INTO access_log (event, user_id, email, actor_id, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)",
        event, user_id, (email or "")[:160] or None, actor_id, client_ip(request), ua or None)
