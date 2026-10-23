import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from ..config import get_settings
from ..deps import Conn, User
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api", tags=["auth"])


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=30)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    password: str | None = Field(default=None, min_length=6, max_length=128)


def _user_out(u) -> dict:
    return {"id": u["id"], "name": u["name"], "email": u["email"], "phone": u["phone"], "role": u["role"],
            "is_master": get_settings().is_master(u["email"])}


@router.post("/auth/register", status_code=201)
async def register(body: RegisterIn, conn: Conn):
    if get_settings().is_master(body.email):
        # e-mail não é verificado no cadastro: a conta master só nasce pelo servidor (python -m app.cli master)
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com esse e-mail.")
    try:
        u = await conn.fetchrow(
            "INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, role",
            body.name.strip(), body.email, body.phone, hash_password(body.password),
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma conta com esse e-mail.")
    return {"token": create_token(u["id"], u["role"]), "user": _user_out(u)}


@router.post("/auth/login")
async def login(body: LoginIn, conn: Conn):
    u = await conn.fetchrow("SELECT * FROM users WHERE email = $1", body.email)
    if u is None or not verify_password(body.password, u["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    return {"token": create_token(u["id"], u["role"]), "user": _user_out(u)}


@router.get("/me")
async def me(user: User, conn: Conn):
    stats = await conn.fetchrow(
        """
        SELECT count(*) FILTER (WHERE status IN ('completed', 'checked_in')) AS played,
               coalesce(sum(duration_min) FILTER (WHERE status IN ('completed', 'checked_in')), 0) AS minutes,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled
        FROM reservations WHERE user_id = $1
        """,
        user["id"],
    )
    return {**_user_out(user), "stats": dict(stats)}


@router.patch("/me")
async def update_me(body: ProfileIn, user: User, conn: Conn):
    u = await conn.fetchrow(
        """
        UPDATE users SET name = coalesce($2, name), phone = coalesce($3, phone),
                         password_hash = coalesce($4, password_hash)
        WHERE id = $1 RETURNING id, name, email, phone, role
        """,
        user["id"], body.name.strip() if body.name else None, body.phone,
        hash_password(body.password) if body.password else None,
    )
    return _user_out(u)
