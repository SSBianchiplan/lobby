import asyncio
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import db, jobs, preview
from .config import get_settings
from .routers import admin, auth, backoffice, bookings, classes, club, coach, logs

logging.basicConfig(level=logging.INFO)
mimetypes.add_type("application/manifest+json", ".webmanifest")
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if not s.dev_mode and (s.jwt_secret.startswith("dev-") or len(s.jwt_secret) < 32):
        raise RuntimeError("Defina PADEL_JWT_SECRET (32+ caracteres) para rodar com PADEL_DEV_MODE=false")
    pool = await db.connect()
    async with pool.acquire() as conn:
        await db.migrate(conn)
    task = asyncio.create_task(jobs.loop())
    yield
    task.cancel()
    await db.close()


app = FastAPI(title="Padel Lobby API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_methods=["*"], allow_headers=["*"])

for r in (auth.router, club.router, bookings.router, admin.router, backoffice.router, classes.router, coach.router, logs.router):
    app.include_router(r)


@app.get("/api/health")
async def health():
    async with db.pool().acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"ok": True}


# Em produção a API serve o build do frontend (SPA com fallback para index.html).
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str, request: Request):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # resolve() + is_relative_to: "%2e%2e/" chega decodificado e escaparia de dist/ (ex.: backend/.env)
        file = (DIST / path).resolve()
        if path and file.is_relative_to(DIST) and file.is_file():
            return FileResponse(file)
        # site estático em subpasta (ex.: /jogo/): serve o index.html dela, sem cache para pegar versão nova
        if path and file.is_relative_to(DIST) and (file / "index.html").is_file():
            if not path.endswith("/"):
                return RedirectResponse(f"/{path}/", status_code=308)
            return FileResponse(file / "index.html", headers={"Cache-Control": "no-cache"})
        meta = None
        if m := preview.INVITE.match(path):
            async with db.pool().acquire() as conn:
                meta = await preview.invite_meta(conn, m.group(1))
        page = preview.render((DIST / "index.html").read_text(), str(request.base_url), str(request.url), meta)
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})
