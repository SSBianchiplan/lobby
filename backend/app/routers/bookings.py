from datetime import date, time
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from .. import reservations as svc
from ..config import get_settings
from ..deps import Conn, MaybeUser, User
from ..domain import load_settings
from ..notify import notify

router = APIRouter(prefix="/api", tags=["reservas"])


class ReservationIn(BaseModel):
    court_id: int
    date: date
    start: time
    duration: int = 60
    payment_method: Literal["pix", "card", "onsite"] = "pix"
    players: list[str] = Field(default_factory=list, max_length=7)


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


class PlayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PixWebhookIn(BaseModel):
    txid: str
    status: Literal["paid"]


@router.post("/reservations", status_code=201)
async def create_reservation(body: ReservationIn, user: User, conn: Conn):
    return await svc.create(conn, user, body.court_id, body.date, body.start, body.duration, body.payment_method, body.players)


@router.get("/reservations/mine")
async def my_reservations(user: User, conn: Conn, scope: Literal["all", "upcoming", "history", "cancelled"] = "all"):
    where = {
        "all": "TRUE",
        "upcoming": "r.status IN ('pending', 'confirmed', 'checked_in') AND upper(r.period) > now()",
        "history": "NOT (r.status IN ('pending', 'confirmed', 'checked_in') AND upper(r.period) > now())",
        "cancelled": "r.status IN ('cancelled', 'expired')",
    }[scope]
    order = "lower(r.period) ASC" if scope == "upcoming" else "lower(r.period) DESC"
    rows = await conn.fetch(
        svc.SELECT_RESERVATION
        + f""" WHERE (r.user_id = $1 OR EXISTS (SELECT 1 FROM reservation_players p WHERE p.reservation_id = r.id AND p.user_id = $1))
               AND {where} ORDER BY {order} LIMIT 100""",
        user["id"],
    )
    settings = await load_settings(conn)
    return [await svc.serialize(conn, r, user, settings) for r in rows]


@router.get("/reservations/{code}")
async def get_reservation(code: str, user: User, conn: Conn):
    r = await svc.fetch(conn, code)
    member = await conn.fetchval("SELECT 1 FROM reservation_players WHERE reservation_id = $1 AND user_id = $2", r["id"], user["id"])
    if r["user_id"] != user["id"] and not member and user["role"] != "admin":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reserva não encontrada.")
    return await svc.serialize(conn, r, user)


@router.post("/reservations/{code}/cancel")
async def cancel_reservation(code: str, body: CancelIn, user: User, conn: Conn):
    r = await svc.fetch(conn, code)
    result = await svc.cancel(conn, r, user, body.reason)
    return {**result, "reservation": await svc.serialize(conn, await svc.fetch(conn, code), user)}


@router.post("/reservations/{code}/players", status_code=201)
async def add_player(code: str, body: PlayerIn, user: User, conn: Conn):
    r = await svc.fetch(conn, code)
    if r["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só quem fez a reserva pode adicionar jogadores.")
    await svc.add_player(conn, r, body.name)
    return await svc.serialize(conn, r, user)


@router.delete("/reservations/{code}/players/{player_id}")
async def remove_player(code: str, player_id: int, user: User, conn: Conn):
    r = await svc.fetch(conn, code)
    p = await conn.fetchrow("SELECT * FROM reservation_players WHERE id = $1 AND reservation_id = $2", player_id, r["id"])
    if p is None or p["is_owner"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Jogador não encontrado.")
    if user["id"] not in (r["user_id"], p["user_id"]) and user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem permissão.")
    await conn.execute("DELETE FROM reservation_players WHERE id = $1", player_id)
    return await svc.serialize(conn, r, user)


@router.get("/reservations/{code}/calendar.ics")
async def reservation_ics(code: str, conn: Conn):
    # Código funciona como token de leitura do evento (sem dados pessoais no .ics).
    r = await svc.fetch(conn, code)
    return Response(svc.ics(r, await load_settings(conn)), media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="padel-{r["code"]}.ics"'})


@router.post("/reservations/{code}/pay/simulate")
async def simulate_payment(code: str, user: User, conn: Conn):
    """Só em modo dev: simula o PSP confirmando o Pix."""
    if not get_settings().dev_mode:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    r = await svc.fetch(conn, code)
    if r["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem permissão.")
    await svc.mark_paid(conn, r)
    return await svc.serialize(conn, await svc.fetch(conn, code), user)


@router.post("/payments/pix/webhook")
async def pix_webhook(body: PixWebhookIn, conn: Conn, x_webhook_secret: str = Header()):
    if x_webhook_secret != get_settings().pix_webhook_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    rid = await conn.fetchval("SELECT reservation_id FROM payments WHERE txid = $1", body.txid)
    if rid is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "txid desconhecido")
    code = await conn.fetchval("SELECT code FROM reservations WHERE id = $1", rid)
    r = await svc.fetch(conn, code)
    if r["payment_status"] == "paid":
        return {"ok": True, "idempotent": True}
    await svc.mark_paid(conn, r, body.txid)
    return {"ok": True}


# ── Convites ────────────────────────────────────────────────────────────────

async def _by_token(conn, token: str):
    code = await conn.fetchval("SELECT code FROM reservations WHERE invite_token::text = $1", token)
    if code is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite inválido.")
    return await svc.fetch(conn, code)


@router.get("/invites/{token}")
async def invite_info(token: str, conn: Conn, user: MaybeUser):
    r = await _by_token(conn, token)
    data = await svc.serialize(conn, r, None)
    joined = bool(user and await conn.fetchval(
        "SELECT 1 FROM reservation_players WHERE reservation_id = $1 AND user_id = $2", r["id"], user["id"]))
    return {
        "court": data["court"], "date": data["date"], "weekday": data["weekday"], "start": data["start"], "end": data["end"],
        "duration": data["duration"], "status": data["status"], "owner_name": data["owner_name"].split()[0],
        "players": [p["name"].split()[0] for p in data["players"]], "max_players": data["max_players"],
        "per_player_cents": r["price_cents"] // (len(data["players"]) + (0 if joined else 1)),
        "joined": joined, "code": data["code"] if joined else None,
    }


@router.post("/invites/{token}/join")
async def join_invite(token: str, user: User, conn: Conn):
    r = await _by_token(conn, token)
    if r["user_id"] == user["id"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Você é quem fez essa reserva.")
    await svc.add_player(conn, r, user["name"], user["id"])
    await notify(conn, r["user_id"], "joined", f"{user['name'].split()[0]} entrou no jogo",
                 f"{r['court_name']} · {r['starts_at']:%d/%m %H:%M}", "/reservas")
    return await svc.serialize(conn, r, user)


# ── Notificações ────────────────────────────────────────────────────────────

@router.get("/notifications")
async def notifications(user: User, conn: Conn, limit: int = Query(30, le=100)):
    rows = await conn.fetch(
        "SELECT id, kind, title, body, link, read_at IS NOT NULL AS read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        user["id"], limit,
    )
    unread = await conn.fetchval("SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL", user["id"])
    return {"unread": unread, "items": [dict(r) for r in rows]}


@router.post("/notifications/read")
async def read_notifications(user: User, conn: Conn):
    await conn.execute("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", user["id"])
    return {"ok": True}
