from typing import Annotated

import asyncpg
import jwt
from fastapi import Depends, HTTPException, Request, status

from . import db
from .config import get_settings
from .security import decode_token


async def get_conn():
    async with db.pool().acquire() as conn:
        yield conn


Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


async def _user_from_request(request: Request, conn: asyncpg.Connection) -> asyncpg.Record | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    try:
        payload = decode_token(header[7:])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.")
    return await conn.fetchrow("SELECT id, name, email, phone, role FROM users WHERE id = $1", int(payload["sub"]))


async def optional_user(request: Request, conn: Conn) -> asyncpg.Record | None:
    return await _user_from_request(request, conn)


async def current_user(request: Request, conn: Conn) -> asyncpg.Record:
    user = await _user_from_request(request, conn)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Entre na sua conta para continuar.")
    return user


async def admin_user(user: Annotated[asyncpg.Record, Depends(current_user)]) -> asyncpg.Record:
    if user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso restrito à administração.")
    return user


async def master_user(user: Annotated[asyncpg.Record, Depends(admin_user)]) -> asyncpg.Record:
    if not get_settings().is_master(user["email"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o admin master pode fazer isso.")
    return user


User = Annotated[asyncpg.Record, Depends(current_user)]
MaybeUser = Annotated[asyncpg.Record | None, Depends(optional_user)]
Admin = Annotated[asyncpg.Record, Depends(admin_user)]
Master = Annotated[asyncpg.Record, Depends(master_user)]
