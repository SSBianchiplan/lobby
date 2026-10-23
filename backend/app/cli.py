"""Tarefas de servidor.

    python -m app.cli master   # garante as contas master (cria com senha aleatória, impressa uma única vez)
"""

import asyncio
import secrets
import sys

from . import db
from .config import get_settings
from .security import hash_password


async def ensure_masters() -> None:
    pool = await db.connect()
    async with pool.acquire() as conn:
        for email in get_settings().master_admins:
            u = await conn.fetchrow("SELECT id, role FROM users WHERE email = $1", email)
            if u is None:
                pw = secrets.token_urlsafe(14)
                await conn.execute(
                    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
                    "Admin master", email, hash_password(pw))
                print(f"  master criado: {email} / {pw}  (anote: não será mostrada de novo)")
            elif u["role"] != "admin":
                await conn.execute("UPDATE users SET role = 'admin' WHERE id = $1", u["id"])
                print(f"  master promovido a admin: {email}")
            else:
                print(f"  master ok: {email}")
    await db.close()


if __name__ == "__main__":
    if sys.argv[1:] != ["master"]:
        sys.exit(__doc__)
    asyncio.run(ensure_masters())
