"""Conta do usuário: cadastro, login, perfil, segurança da sessão e direitos LGPD (exportar e excluir)."""

import json
import secrets
import time
from collections import defaultdict, deque
from typing import Literal

import asyncpg
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field

from ..config import get_settings
from ..deps import Conn, User
from ..domain import now_local
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api", tags=["auth"])

Level = Literal["iniciante", "6", "5", "4", "3", "2", "1"]
Side = Literal["direita", "esquerda", "ambos"]
Hand = Literal["destro", "canhoto"]
Password = Field(min_length=8, max_length=128)

USER_COLUMNS = """id, name, email, phone, role, city, level, side, hand, marketing_opt_in, must_change_password,
                  token_version, created_at"""


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=30)
    password: str = Password
    accept_terms: bool = False
    city: str | None = Field(default=None, max_length=60)
    level: Level | None = None
    side: Side | None = None
    hand: Hand | None = None
    marketing_opt_in: bool = False


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    city: str | None = Field(default=None, max_length=60)
    level: Level | None = None
    side: Side | None = None
    hand: Hand | None = None
    marketing_opt_in: bool | None = None


class PasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Password


class ConfirmIn(BaseModel):
    password: str = Field(max_length=128)


def _user_out(u) -> dict:
    return {
        "id": u["id"], "name": u["name"], "email": str(u["email"]), "phone": u["phone"], "role": u["role"],
        "is_master": get_settings().is_master(u["email"]),
        "city": u["city"], "level": u["level"], "side": u["side"], "hand": u["hand"],
        "marketing_opt_in": u["marketing_opt_in"], "must_change_password": u["must_change_password"],
        "member_since": u["created_at"].date().isoformat(),
    }


def _session(u) -> dict:
    return {"token": create_token(u["id"], u["role"], u["token_version"]), "user": _user_out(u)}


# ── Freio a força bruta: 5 erros por e-mail em 5 min (1 worker, memória do processo basta) ──
_FAILS: dict[str, deque[float]] = defaultdict(deque)
MAX_FAILS, WINDOW_S = 5, 300


def _recent_fails(key: str) -> deque[float]:
    q = _FAILS[key]
    while q and q[0] < time.monotonic() - WINDOW_S:
        q.popleft()
    return q


@router.post("/auth/register", status_code=201)
async def register(body: RegisterIn, conn: Conn):
    if not body.accept_terms:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Para criar a conta, aceite os termos de uso e a política de privacidade.")
    if get_settings().is_master(body.email):
        # e-mail não é verificado no cadastro: a conta master só nasce pelo servidor (python -m app.cli master)
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com esse e-mail.")
    try:
        u = await conn.fetchrow(
            f"""INSERT INTO users (name, email, phone, password_hash, city, level, side, hand, marketing_opt_in, accepted_terms_at, last_login_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now()) RETURNING {USER_COLUMNS}""",
            body.name.strip(), body.email, (body.phone or "").strip() or None, hash_password(body.password),
            (body.city or "").strip() or None, body.level, body.side, body.hand, body.marketing_opt_in,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com esse e-mail.")
    return _session(u)


@router.post("/auth/login")
async def login(body: LoginIn, conn: Conn):
    key = body.email.lower()
    if len(_recent_fails(key)) >= MAX_FAILS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde alguns minutos e tente de novo.")
    u = await conn.fetchrow(f"SELECT {USER_COLUMNS}, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL", body.email)
    if u is None or not verify_password(body.password, u["password_hash"]):
        _FAILS[key].append(time.monotonic())
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    _FAILS.pop(key, None)
    await conn.execute("UPDATE users SET last_login_at = now() WHERE id = $1", u["id"])
    return _session(u)


@router.get("/me")
async def me(user: User, conn: Conn):
    u = await conn.fetchrow(f"SELECT {USER_COLUMNS} FROM users WHERE id = $1", user["id"])
    stats = await conn.fetchrow(
        """
        SELECT count(*) FILTER (WHERE status IN ('completed', 'checked_in')) AS played,
               coalesce(sum(duration_min) FILTER (WHERE status IN ('completed', 'checked_in')), 0) AS minutes,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(*) FILTER (WHERE status IN ('pending', 'confirmed') AND lower(period) > now()) AS upcoming,
               coalesce(sum(price_cents) FILTER (WHERE payment_status = 'paid'), 0) AS spent_cents
        FROM reservations WHERE user_id = $1
        """,
        user["id"],
    )
    favorite = await conn.fetchval(
        """SELECT c.name FROM reservations r JOIN courts c ON c.id = r.court_id
           WHERE r.user_id = $1 AND r.status IN ('confirmed', 'checked_in', 'completed')
           GROUP BY c.id ORDER BY count(*) DESC, c.number LIMIT 1""",
        user["id"],
    )
    # parceiros: quem esteve nas mesmas reservas (como dono ou convidado), sem contar o próprio usuário
    partners = await conn.fetch(
        """
        SELECT p.name, count(*) AS games FROM reservation_players p
        JOIN reservations r ON r.id = p.reservation_id
        WHERE r.status IN ('confirmed', 'checked_in', 'completed')
          AND p.user_id IS DISTINCT FROM $1
          AND (r.user_id = $1 OR EXISTS (SELECT 1 FROM reservation_players me WHERE me.reservation_id = r.id AND me.user_id = $1))
        GROUP BY p.name ORDER BY 2 DESC, 1 LIMIT 5
        """,
        user["id"],
    )
    return {**_user_out(u), "stats": {**dict(stats), "favorite_court": favorite}, "partners": [dict(p) for p in partners]}


@router.patch("/me")
async def update_me(body: ProfileIn, user: User, conn: Conn):
    fields = body.model_dump(exclude_unset=True)
    for k in ("phone", "city"):
        if k in fields:
            fields[k] = (fields[k] or "").strip() or None
    if "name" in fields:
        if fields["name"] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Informe seu nome.")
        fields["name"] = fields["name"].strip()
    if not fields:
        return await me(user, conn)
    sets = ", ".join(f"{k} = ${i}" for i, k in enumerate(fields, start=2))
    await conn.execute(f"UPDATE users SET {sets}, updated_at = now() WHERE id = $1", user["id"], *fields.values())
    return await me(user, conn)


async def _check_password(conn: asyncpg.Connection, user_id: int, password: str) -> None:
    h = await conn.fetchval("SELECT password_hash FROM users WHERE id = $1", user_id)
    if not verify_password(password, h):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Senha atual incorreta.")


@router.post("/me/password")
async def change_password(body: PasswordIn, user: User, conn: Conn):
    await _check_password(conn, user["id"], body.current_password)
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A nova senha precisa ser diferente da atual.")
    u = await conn.fetchrow(
        f"""UPDATE users SET password_hash = $2, must_change_password = false, token_version = token_version + 1, updated_at = now()
            WHERE id = $1 RETURNING {USER_COLUMNS}""",
        user["id"], hash_password(body.new_password),
    )
    return _session(u)  # este aparelho continua logado; os demais caem


@router.post("/me/logout-all")
async def logout_all(user: User, conn: Conn):
    u = await conn.fetchrow(
        f"UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING {USER_COLUMNS}", user["id"])
    return _session(u)


@router.get("/me/export")
async def export_data(user: User, conn: Conn):
    """LGPD art. 18: cópia dos dados pessoais e do histórico de reservas."""
    u = await conn.fetchrow(
        f"SELECT {USER_COLUMNS}, accepted_terms_at, last_login_at, updated_at FROM users WHERE id = $1", user["id"])
    res = await conn.fetch(
        """SELECT r.code, c.name AS quadra, lower(r.period) AS inicio, upper(r.period) AS fim, r.status, r.payment_method,
                  r.payment_status, r.price_cents, r.created_at, r.cancelled_at, r.cancel_reason, r.checked_in_at,
                  (SELECT json_agg(p.name ORDER BY p.is_owner DESC) FROM reservation_players p WHERE p.reservation_id = r.id) AS jogadores
           FROM reservations r JOIN courts c ON c.id = r.court_id WHERE r.user_id = $1 ORDER BY lower(r.period)""",
        user["id"],
    )
    notes = await conn.fetch("SELECT kind, title, body, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at", user["id"])
    data = {
        "exportado_em": now_local().isoformat(),
        "conta": {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in dict(u).items() if k != "token_version"} | {"email": str(u["email"])},
        "reservas": [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in dict(r).items()} for r in res],
        "notificacoes": [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in dict(n).items()} for n in notes],
    }
    return Response(json.dumps(data, ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="meus-dados-padel-lobby.json"'})


@router.delete("/me")
async def delete_me(body: ConfirmIn, user: User, conn: Conn):
    """Exclusão = anonimização. Reservas e pagamentos ficam (obrigação fiscal e caixa), sem dados pessoais."""
    if get_settings().is_master(user["email"]):
        raise HTTPException(status.HTTP_409_CONFLICT, "A conta do admin master não pode ser excluída.")
    await _check_password(conn, user["id"], body.password)
    active = await conn.fetchval(
        "SELECT count(*) FROM reservations WHERE user_id = $1 AND status IN ('pending', 'confirmed', 'checked_in') AND upper(period) > now()",
        user["id"],
    )
    if active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Você tem reservas futuras. Cancele-as (ou jogue!) antes de excluir a conta.")
    async with conn.transaction():
        await conn.execute(
            """UPDATE users SET name = 'Conta excluída', email = 'excluido-' || id || '@invalid', phone = NULL, city = NULL,
                   level = NULL, side = NULL, hand = NULL, marketing_opt_in = false, role = 'player',
                   password_hash = $2, token_version = token_version + 1, deleted_at = now(), updated_at = now()
               WHERE id = $1""",
            user["id"], hash_password(secrets.token_urlsafe(24)),
        )
        await conn.execute("UPDATE reservation_players SET name = 'Jogador' WHERE user_id = $1", user["id"])
        await conn.execute("DELETE FROM notifications WHERE user_id = $1", user["id"])
    return {"ok": True}
